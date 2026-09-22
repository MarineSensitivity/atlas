<script lang="ts">
  // atlas-4 — the Scores lens' orchestrator. Mounted by Shell.svelte only when `sel.lens ===
  // "scores"`; owns nothing about MapLibre itself (it computes composeStyle inputs and hands them
  // back to the shell via `bind:mapExtra`, per docs/map.md) and renders whichever panel body the
  // shell's active rail tool calls for. Step 1: layers/legend/controls only — the "flower"/"table"
  // tools still show the shell's placeholder text until step 2 lands.
  import type { MapHandle } from "../../lib/map/map";
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import type { ScoresMapInputs } from "./mapInputs";
  import { scoresMapInputs } from "./mapInputs";
  import { effectiveLyr, effectiveUnit } from "./fallback";
  import { cellRing, parseScoresSelection } from "./selection";
  import { gridFromBoot } from "../../lib/grid/grid";
  import LayersPanel from "./LayersPanel.svelte";
  import FlowerPanel from "./FlowerPanel.svelte";
  import type { ManifestOverlayRow } from "./raster";

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
    // eslint's `no-useless-assignment` cannot see that a `$bindable` prop is read by the PARENT
    // through Svelte's binding machinery (`bind:mapExtra` on Shell.svelte's `<ScoresLens>`) -- at
    // the plain-TS level this default assignment looks like a local variable set and never read
    // again in this scope. It genuinely is read, one component up.
    // eslint-disable-next-line no-useless-assignment
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
  <FlowerPanel {boot} {selection} />
{:else}
  <p>{fallbackBody}</p>
{/if}
