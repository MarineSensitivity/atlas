<script lang="ts">
  // atlas-4 — the Scores lens' orchestrator. Mounted by Shell.svelte only when `sel.lens ===
  // "scores"`; owns nothing about MapLibre itself (it computes composeStyle inputs and hands them
  // back to the shell via `bind:mapExtra`, per docs/map.md) and renders whichever panel body the
  // shell's active rail tool calls for. Step 1 landed layers/legend/controls; step 2 adds the map
  // click -> selection wiring, the clicked cell's engine-backed flower, and the species/zones/
  // composition table. "places" and "report" still fall back to the shell's own placeholder text
  // — those tools belong to other phases.
  import type { MapHandle } from "../../lib/map/map";
  import { mapClick, type QueryableMap } from "../../lib/map/interaction";
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import type { ScoresMapInputs } from "./mapInputs";
  import { scoresMapInputs } from "./mapInputs";
  import { effectiveLyr, effectiveUnit } from "./fallback";
  import { cellRing, formatCellToken, formatZoneToken, parseScoresSelection } from "./selection";
  import { gridFromBoot, tileOf } from "../../lib/grid/grid";
  import { componentMetricKeys } from "../../lib/analysis/queries";
  import { cellFlowerComponents, type CellComponentRow } from "./flower";
  import { getAnalysisSources } from "./engine";
  import LayersPanel from "./LayersPanel.svelte";
  import FlowerPanel from "./FlowerPanel.svelte";
  import TablePanel from "./TablePanel.svelte";
  import type { ManifestOverlayRow } from "./raster";
  import type { FlowerComponentInput } from "../../lib/ui/flowerGeometry";

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
    /** the shell's shared "active lens' map contribution" bucket (Shell.svelte) — every field
     * optional, so a lens that has not populated it yet (or the OTHER lens, when this one is
     * inactive) never overrides the shell's own base view with an empty one. */
    mapExtra: Partial<ScoresMapInputs>;
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
    mapExtra = $bindable({}),
  }: Props = $props();

  const manifestOverlays = $derived(
    (manifest as { overlays?: ManifestOverlayRow[] } | null)?.overlays ?? null,
  );

  const unit = $derived(effectiveUnit(sel.unit, boot));
  const lyr = $derived(effectiveLyr(sel.lyr, boot));

  let showOutsidePra = $state(false);

  // the selection AS THE FLOWER/SPECIES/TABLE PANELS SEE IT (`cell:<id>` keeps the raw cell id —
  // `flower.ts`/`species.ts` need it verbatim for titles and headers).
  const selection = $derived(parseScoresSelection(sel.sel));

  // the SAME selection, reshaped into what `scoresMapInputs` needs for the map ring (a cell's
  // centre + half-extents rather than its bare id — pure arithmetic on the release's own grid, so
  // no engine call is needed just to draw the ring).
  const mapSelection = $derived.by(() => {
    if (!selection) return null;
    if (selection.kind === "zone") return selection;
    try {
      return { kind: "cell" as const, ...cellRing(selection.cellId, gridFromBoot(boot)) };
    } catch {
      return null; // no boot.grid yet (Tier 0 hasn't loaded) — draw no ring rather than throw
    }
  });

  $effect(() => {
    mapExtra = scoresMapInputs({
      boot,
      overlays: manifestOverlays,
      unit,
      lyr,
      palette: sel.pal,
      showOutsidePra,
      selection: mapSelection,
    });
  });

  // --- click -> selection (atlas-4 §6.6): a cell id is arithmetic on the release's grid via
  // `mapClick` (never `/cog/point`, never `cellid.tif`); which half of the result matters depends
  // on the CURRENT branch — the cell branch always resolves to a cell (even one that also grazes a
  // zone outline), the zone-choropleth branch only reacts to an actual zone hit and otherwise does
  // nothing (matching the ported app's separate `map_click`/`map_feature_click` events).
  $effect(() => {
    const handle = mapHandle;
    if (!handle) return;
    function onClick(e: { lngLat: { lng: number; lat: number }; point: { x: number; y: number } }) {
      // re-checked (TS does not carry the outer narrowing into a nested function declaration,
      // even over a `const`) — `handle` cannot actually change, this is a type-only guard.
      if (!handle) return;
      let grid;
      try {
        grid = gridFromBoot(boot);
      } catch {
        return; // no boot.grid yet
      }
      // maplibre-gl's own .d.ts wants a `Point` class instance where `QueryableMap` (interaction.ts,
      // deliberately narrow for testability) accepts a plain `{x,y}` — a real Map satisfies it at
      // runtime (this IS how `queryRenderedFeatures` is documented to be called), so this is a type
      // -shape cast, not a behaviour change.
      const queryable = handle.map as unknown as QueryableMap;
      const result = mapClick(queryable, e.lngLat, e.point, { grid, units: mapExtra.zones ?? [] });
      if (unit === "cell") {
        if (result.cellId !== null) selStore.set({ sel: formatCellToken(result.cellId) });
      } else if (result.zone) {
        selStore.set({ sel: formatZoneToken(result.zone.unit, result.zone.key) });
      }
    }
    handle.map.on("click", onClick);
    return () => handle.map.off("click", onClick);
  });

  // --- a clicked cell's flower (step 2): the wide `cell` tile fetched through the engine
  // (`sql/cell_components.sql`), never `/cog/point` (plan D4 reserves that for species values
  // only). A token guard drops a stale response if the selection moves on before it resolves.
  let cellFlowerRows = $state<FlowerComponentInput[] | null | undefined>(undefined);
  let cellFlowerToken = 0;
  $effect(() => {
    const s = selection;
    const v = ver;
    if (s?.kind !== "cell") {
      cellFlowerRows = undefined;
      return;
    }
    const token = ++cellFlowerToken;
    cellFlowerRows = undefined;
    (async () => {
      if (!v) throw new Error("no release version yet");
      const bootObj = boot as Record<string, unknown>;
      const grid = gridFromBoot(bootObj);
      const tile = tileOf(s.cellId, grid);
      const sources = await getAnalysisSources(v, bootObj);
      await sources.cellTiles([tile]);
      const { cellComponents } = await import("../../lib/analysis/queries");
      const rows = await cellComponents(sources.db, sources.templates, {
        cellId: s.cellId,
        metricKeys: componentMetricKeys(bootObj),
      });
      // `cellComponents()` is typed as `Promise<Record<string, unknown>[]>` (a generic engine
      // result); `sql/cell_components.sql`'s actual columns are exactly `CellComponentRow`'s.
      return rows as unknown as CellComponentRow[];
    })()
      .then((rows) => {
        if (token === cellFlowerToken) cellFlowerRows = cellFlowerComponents(rows);
      })
      .catch(() => {
        if (token === cellFlowerToken) cellFlowerRows = null;
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
  <LayersPanel
    {sel}
    {selStore}
    {boot}
    {manifestOverlays}
    {ver}
    {mapHandle}
    {showOutsidePra}
    onShowOutsidePraChange={(v) => (showOutsidePra = v)}
    {unit}
    {lyr}
  />
{:else if activeTool === "flower"}
  <FlowerPanel {boot} {selection} cellComponents={cellFlowerRows} {cellCoords} />
{:else if activeTool === "table"}
  <TablePanel {sel} {selStore} {boot} {manifest} {ver} {unit} {lyr} {selection} />
{:else}
  <p>{fallbackBody}</p>
{/if}
