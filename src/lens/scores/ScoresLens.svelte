<script lang="ts">
  // atlas-4 — the Scores lens' orchestrator. Mounted by Shell.svelte only when `sel.lens ===
  // "scores"`; owns nothing about MapLibre itself. 0.10.21 fix 1: it no longer COMPUTES the
  // composeStyle inputs itself (that used to live in an `$effect` here, writing a `bind:mapExtra`
  // prop the panel body only ever ran while mounted — the exact bug this fix closes, see
  // `../scores/state.svelte.ts`'s own header) -- it reads them off the `lens` prop
  // (`createScoresLens()`, instantiated by Shell.svelte independent of this component ever
  // mounting) and renders whichever panel body the shell's active rail tool calls for. Step 1
  // landed layers/legend/controls; step 2 adds the map click -> selection wiring, the clicked
  // cell's engine-backed flower, and the species/zones/composition table. "places" and "report"
  // still fall back to the shell's own placeholder text — those tools belong to other phases.
  //
  // atlas-8 review round 2, item M1: the click -> selection -> popup path (this component's own
  // `$effect` registering `map.on("click", ...)`) moved to `../scores/state.svelte.ts`'s
  // `handleMapClick` -- the SAME class of bug 0.10.21 fixed for map inputs, one layer down: this
  // component is mounted only inside the panel body, so a click did nothing with the desktop panel
  // collapsed or the Places tool open. Shell.svelte now calls `lens.handleMapClick(...)` from its
  // ONE `map.on("click", ...)` listener, same as species. This component keeps only what needs the
  // PANEL to exist at all: the clicked cell's flower fetch, and the layers/table panels below.
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import type { MapHandle } from "../../lib/map/map";
  import type { ScoresLens } from "./state.svelte";
  import { gridFromBoot, tileOf } from "../../lib/grid/grid";
  import { componentMetricKeys } from "../../lib/analysis/queries";
  import { exclusive } from "../../lib/analysis/exclusive";
  import { cellFlowerComponents, type CellComponentRow, type DedupResult } from "./flower";
  import { getAnalysisSources } from "./engine";
  import ScoresLayersPanel from "./LayersPanel.svelte";
  // R3 (round-2 plan §5 U4): the lens-independent stack shell — `docs/map.md`'s "the Layers panel
  // IS the stack" (Ben's decision R3). `ScoresLayersPanel` above is now only its "Data" row's
  // content, passed in as the `dataControls` snippet below.
  import LibLayersPanel, { type LayersUnitToggle } from "../../lib/ui/LayersPanel.svelte";
  import { unitOptions } from "./boot";
  import FlowerPanel from "./FlowerPanel.svelte";
  import TablePanel from "./TablePanel.svelte";
  import type { LayerStackEntry } from "../../lib/state/types";

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    manifest: unknown;
    ver: string | null;
    mapHandle: MapHandle | undefined;
    activeTool: string;
    /** the shell's own placeholder text for `activeTool`, rendered for a tool this lens does not
     * (yet, or ever) own — "places" and "report" belong to other phases. */
    fallbackBody: string;
    /** 0.10.21 fix 1 -- the lens-level map-input store Shell.svelte instantiates whenever
     * `sel.lens === "scores"` (`state.svelte.ts#createScoresLens`), independent of this component.
     * `unit`/`lyr`/`manifestOverlays`/`selection`/`mapSelection`/`showOutsidePra`/`mapExtra` all
     * come from here now, not recomputed a second time. */
    lens: ScoresLens;
    /** R3: the resolved layer stack (`sel.layers ?? defaultLayerStackEntries()`) and its writer —
     * both computed once by Shell.svelte (the SAME object `composeStyleInput` reads), so the panel
     * and the map can never disagree about what the current stack is. */
    layerStack: readonly LayerStackEntry[];
    onLayerStackChange: (next: readonly LayerStackEntry[]) => void;
  }

  let {
    sel,
    selStore,
    boot,
    manifest,
    ver,
    mapHandle,
    activeTool,
    fallbackBody,
    lens,
    layerStack,
    onLayerStackChange,
  }: Props = $props();

  const unit = $derived(lens.unit);
  const lyr = $derived(lens.lyr);
  const manifestOverlays = $derived(lens.manifestOverlays);

  // P round deliverable 1: the Layers panel's own primary control (the shared `LibLayersPanel`'s
  // `unitToggle` prop) -- replaces the old "Spatial units" `<Select>` that used to live in
  // `ScoresLayersPanel` (`./LayersPanel.svelte`, still rendered below for the Data row's OTHER
  // controls). `onUnitChange` is the SAME body that Select's own `onchange` used to call.
  function onUnitChange(value: string) {
    selStore.set({ unit: value, sel: undefined });
  }
  const unitToggle = $derived<LayersUnitToggle>({
    options: unitOptions(boot),
    value: unit,
    onChange: onUnitChange,
  });

  // the selection AS THE FLOWER/SPECIES/TABLE PANELS SEE IT (`cell:<id>` keeps the raw cell id —
  // `flower.ts`/`species.ts` need it verbatim for titles and headers).
  const selection = $derived(lens.selection);

  // the SAME selection, reshaped into what `scoresMapInputs` needs for the map ring (a cell's
  // centre + half-extents rather than its bare id — pure arithmetic on the release's own grid, so
  // no engine call is needed just to draw the ring).
  const mapSelection = $derived(lens.mapSelection);

  // click -> selection -> popup lives in `../scores/state.svelte.ts#handleMapClick` now (item M1);
  // Shell.svelte calls it directly. This component only needs `selection`/`mapSelection` (above)
  // to render the flower/species/zones panels below.

  // --- a clicked cell's flower (step 2): the wide `cell` tile fetched through the engine
  // (`sql/cell_components.sql`), never `/cog/point` (plan D4 reserves that for species values
  // only). A token guard drops a stale response if the selection moves on before it resolves.
  // atlas-8 review round 2, item 3a: `cellTiles()` rebuilds the SAME shared `cell` view a place
  // analysis (or the click popup's own value fetch) builds, so this whole build-then-read
  // sequence now runs inside `exclusive(sources.db, ...)` too (usability B1's rule).
  let cellFlowerRows = $state<DedupResult | null | undefined>(undefined);
  // D3(b) (Opus 5.5 eyes-on, 2026-09-24): the catch below used to swallow ANY failure into the
  // SAME `null` a genuinely empty result produces, so FlowerPanel could never tell "the release has
  // nothing here" from "the fetch itself broke" apart -- both showed the (misleading) "no flower
  // data is published" text. Captured here, separately, so the panel can show a distinct message
  // that NAMES the failure.
  let cellFlowerError = $state<string | null>(null);
  let cellFlowerToken = 0;
  $effect(() => {
    const s = selection;
    const v = ver;
    if (s?.kind !== "cell") {
      cellFlowerRows = undefined;
      cellFlowerError = null;
      return;
    }
    const token = ++cellFlowerToken;
    cellFlowerRows = undefined;
    cellFlowerError = null;
    (async () => {
      if (!v) throw new Error("no release version yet");
      const bootObj = boot as Record<string, unknown>;
      const grid = gridFromBoot(bootObj);
      const tile = tileOf(s.cellId, grid);
      const sources = await getAnalysisSources(v, bootObj);
      return exclusive(sources.db, async () => {
        await sources.cellTiles([tile]);
        const { cellComponents } = await import("../../lib/analysis/queries");
        const rows = await cellComponents(sources.db, sources.templates, {
          cellId: s.cellId,
          metricKeys: componentMetricKeys(bootObj),
        });
        // `cellComponents()` is typed as `Promise<Record<string, unknown>[]>` (a generic engine
        // result); `sql/cell_components.sql`'s actual columns are exactly `CellComponentRow`'s.
        return rows as unknown as CellComponentRow[];
      });
    })()
      .then((rows) => {
        if (token === cellFlowerToken) cellFlowerRows = cellFlowerComponents(rows);
      })
      .catch((err: unknown) => {
        if (token !== cellFlowerToken) return;
        cellFlowerRows = null;
        cellFlowerError = err instanceof Error ? err.message : String(err);
      });
  });

  const cellCoords = $derived(
    mapSelection?.kind === "cell" ? { lon: mapSelection.lon, lat: mapSelection.lat } : undefined,
  );

  // NavigationControl/FullscreenControl/ScaleControl (parity doc §6.2 step 7) were tried here via
  // `mapHandle.map.addControl(...)` and REVERTED: MapLibre appends every control's real
  // `<button>` INTO `#map`, which Shell.svelte gives `role="img"` (spec.md/atlas-3) — axe's
  // `nested-interactive` rule correctly flags interactive controls inside an element role="img"
  // marks non-interactive to assistive tech (measured: `e2e/shell.a11y.spec.ts` went red). Fixing
  // it needs a decision this phase should not make alone (drop `role="img"` from `#map` now that
  // it holds real controls? give the controls their own non-`#map` DOM parent MapLibre does not
  // support?) — left for whoever adds map controls next; see the atlas-4 report's "could not
  // satisfy" list. The Nominatim geocoder was never attempted (a third-party dependency + a live
  // network call, also out of scope this phase).
</script>

{#if activeTool === "layers"}
  <LibLayersPanel stack={layerStack} onChange={onLayerStackChange} {unitToggle}>
    {#snippet dataControls()}
      <ScoresLayersPanel
        {sel}
        {selStore}
        {boot}
        {manifestOverlays}
        metricLabels={lens.metricLabels}
        {ver}
        {mapHandle}
        showOutsidePra={lens.showOutsidePra}
        onShowOutsidePraChange={(v) => lens.setShowOutsidePra(v)}
        {unit}
        {lyr}
      />
    {/snippet}
  </LibLayersPanel>
{:else if activeTool === "flower"}
  <FlowerPanel
    {boot}
    {manifest}
    {selection}
    cellComponents={cellFlowerRows}
    cellComponentsError={cellFlowerError}
    {cellCoords}
  />
{:else if activeTool === "table"}
  <TablePanel {sel} {selStore} {boot} {manifest} {ver} {unit} {lyr} {selection} />
{:else}
  <p>{fallbackBody}</p>
{/if}
