<script lang="ts">
  // The species lens' PANEL body — mounted by the shell into the "layers" tool's reserved panel
  // region when `sel.lens === "species"` (docs/map.md / shell contract: the shell owns WHERE a
  // lens mounts, never what it renders). Composes the pure view models `state.svelte.ts` already
  // computed: title + copy buttons (§7.1), the layer bar + representation toggle (§7.2), the
  // sidebar card (§7.3). The legend and the picker mount elsewhere (over the map, and in the
  // topbar's shared search field) — see Shell.svelte.
  //
  // R3 (round-2 plan §5 U4, Deliverable 4: "the species raster and its range are stack rows too"):
  // this whole body is now the shared stack's "Data" row content (`src/lib/ui/LayersPanel.svelte`'s
  // `dataControls` snippet) — the species raster/range paint through the SAME `data-raster` group
  // the scores lens' raster does, so switching lenses keeps whatever visible/opacity/order choice
  // the viewer already made (`sel.layers` is lens-independent view state).
  import type { SpeciesLens } from "./state.svelte";
  import SpeciesTitle from "./SpeciesTitle.svelte";
  import LayerBarView from "./LayerBarView.svelte";
  import SpeciesCardView from "./SpeciesCardView.svelte";
  import LibLayersPanel, {
    type LayersOutlineChoice,
    type LayersProjectionControl,
    type LayersRowState,
  } from "../../lib/ui/LayersPanel.svelte";
  import type { LayerStackEntry, Outline, Representation, Sel } from "../../lib/state/types";
  import { isPlacesSelectionEmpty } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import type { MapHandle } from "../../lib/map/map";
  import type { LayerGroupId } from "../../lib/map/layerStack";

  interface Props {
    lens: SpeciesLens;
    rep: Representation;
    layerStack: readonly LayerStackEntry[];
    onLayerStackChange: (next: readonly LayerStackEntry[]) => void;
    boot: unknown;
    /** R3 deliverable 6/7: the shared panel's "Outlines" outline choice and "Sphere" row are
     * lens-independent (`Sel.out`/`Sel.proj`) -- new here (this component previously took no `sel`/
     * `selStore`/`mapHandle` at all, since the old panel body had no such controls of its own). */
    sel: Sel;
    selStore: SelStore;
    mapHandle: MapHandle | undefined;
  }

  // `boot` stays a declared prop (Shell.svelte always passes it, and a lens prop this narrow is
  // not worth a second Shell.svelte branch to drop) but is no longer destructured -- this
  // component reads nothing from it now the toggle it used to feed is gone (below).
  let { lens, rep, layerStack, onLayerStackChange, sel, selStore, mapHandle }: Props = $props();

  // Orchestrator hand-off (Opus UI review of main, 2026-09-25): "in the Species lens HIDE the
  // 'Raster cells | Program areas' toggle instead of showing it disabled with a reason." Species
  // surfaces are rasters only -- there is no zone-fill CHOICE to make in this lens at all (unlike
  // the scores lens' zone choropleth), so the toggle is simply omitted (`LibLayersPanel`'s own
  // `unitToggle` prop is optional, and its whole block does not render without it) rather than
  // shown disabled with a reason nobody asked for.
  function onOutlineChange(value: "programarea" | "ecoregion") {
    selStore.set({ out: value as Outline });
  }
  const outline = $derived<LayersOutlineChoice>({ value: sel.out, onChange: onOutlineChange });

  function onProjChange(checked: boolean) {
    const proj = checked ? "globe" : "mercator";
    selStore.set({ proj });
    mapHandle?.setProjection(proj);
  }
  const projection = $derived<LayersProjectionControl>({
    checked: sel.proj === "globe",
    onChange: onProjChange,
  });

  // Fix round (Ben, 2026-09-25) -- same rule as the scores lens, see that component's own header
  // on `rowState`/`isPlacesSelectionEmpty`.
  const rowState = $derived<Partial<Record<LayerGroupId, LayersRowState>>>({
    "data-places": { empty: isPlacesSelectionEmpty(sel.sel), hint: "— nothing selected" },
  });
</script>

<LibLayersPanel stack={layerStack} onChange={onLayerStackChange} {outline} {projection} {rowState}>
  {#snippet dataControls()}
    <div class="species-panel" data-testid="species-panel">
      {#if lens.cardError}
        <p class="error" role="alert">Couldn't load this species ({lens.cardError.kind}).</p>
      {:else if lens.card}
        <SpeciesTitle
          sci={lens.card.sci}
          common={lens.card.common}
          wideRange={lens.wideRange}
          onSetZoomTarget={(target) => lens.setZoomTarget(target)}
        />
        {#if lens.bar}
          <LayerBarView
            bar={lens.bar}
            {rep}
            onSelectLayer={(key) => lens.selectLayer(key)}
            onSetRepresentation={(r) => lens.setRepresentation(r)}
          />
        {/if}
        {#if lens.mapInputs.notice}
          <p class="notice" role="status">{lens.mapInputs.notice}</p>
        {/if}
        {#if lens.info}
          <SpeciesCardView
            info={lens.info}
            asset={lens.mapInputs.asset}
            onSelect={(key) => lens.selectLayer(key)}
          />
        {/if}
      {:else if lens.loading}
        <p>Loading…</p>
      {/if}
    </div>
  {/snippet}
</LibLayersPanel>

<style>
  .species-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .error,
  .notice {
    color: var(--text-secondary);
  }
</style>
