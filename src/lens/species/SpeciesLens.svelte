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
  import LibLayersPanel, { type LayersUnitToggle } from "../../lib/ui/LayersPanel.svelte";
  import type { LayerStackEntry, Representation } from "../../lib/state/types";
  // P round deliverable 1 (Ben, live-review 2026-09-24): "emphasize Raster Cells vs Program Areas
  // as a toggle similar to Scores vs Species at top, but this only applies to Scores (so grayed out
  // for Species)". `unitOptions` is a PURE boot reader (no scores-lens state) -- reused here rather
  // than duplicated so the disabled toggle's own option labels can never drift from what the scores
  // lens shows for the same release.
  import { unitOptions } from "../scores/boot";

  interface Props {
    lens: SpeciesLens;
    rep: Representation;
    layerStack: readonly LayerStackEntry[];
    onLayerStackChange: (next: readonly LayerStackEntry[]) => void;
    boot: unknown;
  }

  let { lens, rep, layerStack, onLayerStackChange, boot }: Props = $props();

  // species surfaces are rasters only -- there is no zone-fill CHOICE to make in this lens (unlike
  // the scores lens' zone choropleth), so the toggle renders disabled with a short reason rather
  // than a working control that would do nothing.
  const unitToggle = $derived<LayersUnitToggle>({
    options: unitOptions(boot),
    value: "cell",
    disabledReason: "Species surfaces are rasters only.",
  });
</script>

<LibLayersPanel stack={layerStack} onChange={onLayerStackChange} {unitToggle}>
  {#snippet dataControls()}
    <div class="species-panel" data-testid="species-panel">
      {#if lens.cardError}
        <p class="error" role="alert">Couldn't load this species ({lens.cardError.kind}).</p>
      {:else if lens.card}
        <SpeciesTitle sci={lens.card.sci} common={lens.card.common} />
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
