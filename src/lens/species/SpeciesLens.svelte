<script lang="ts">
  // The species lens' PANEL body — mounted by the shell into the "layers" tool's reserved panel
  // region when `sel.lens === "species"` (docs/map.md / shell contract: the shell owns WHERE a
  // lens mounts, never what it renders). Composes the pure view models `state.svelte.ts` already
  // computed: title + copy buttons (§7.1), the layer bar + representation toggle (§7.2), the
  // sidebar card (§7.3). The legend and the picker mount elsewhere (over the map, and in the
  // topbar's shared search field) — see Shell.svelte.
  import type { SpeciesLens } from "./state.svelte";
  import SpeciesTitle from "./SpeciesTitle.svelte";
  import LayerBarView from "./LayerBarView.svelte";
  import SpeciesCardView from "./SpeciesCardView.svelte";
  import type { Representation } from "../../lib/state/types";

  interface Props {
    lens: SpeciesLens;
    rep: Representation;
  }

  let { lens, rep }: Props = $props();
</script>

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
