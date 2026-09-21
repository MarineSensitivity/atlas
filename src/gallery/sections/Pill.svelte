<script lang="ts">
  import Pill from "../../lib/ui/Pill.svelte";

  let bathymetryOn = $state(true);
  let expanded = $state(false);
</script>

<div class="row">
  <figure>
    <Pill label="Zone outlines" />
    <figcaption>idle</figcaption>
  </figure>
  <figure>
    <Pill
      label="Bathymetry"
      pressed={bathymetryOn}
      onclick={() => (bathymetryOn = !bathymetryOn)}
    />
    <figcaption>toggle (click to flip)</figcaption>
  </figure>
  <figure>
    <Pill
      label="Merged model layer"
      disabled
      disabledReason="feeds the merged model, but v7 publishes no surface for it"
    />
    <figcaption>disabled, with a reason (hover/focus)</figcaption>
  </figure>
  <figure>
    <Pill
      label="Layers panel"
      {expanded}
      controls="pill-demo-body"
      onclick={() => (expanded = !expanded)}
    />
    <figcaption>disclosure (spec.md §5.3: a collapsed panel becomes a labelled pill)</figcaption>
  </figure>
</div>

{#if expanded}
  <div id="pill-demo-body" class="disclosure-body">The panel's body, revealed.</div>
{/if}

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-5);
    padding: var(--space-4);
  }

  figure {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
  }

  figcaption {
    max-width: 16em;
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .disclosure-body {
    margin: 0 var(--space-4) var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
</style>
