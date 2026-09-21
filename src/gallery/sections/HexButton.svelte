<script lang="ts">
  import HexButton from "../../lib/ui/HexButton.svelte";

  let announced = $state("");
</script>

<div class="row">
  <figure>
    <HexButton icon="layers" label="Layers" />
    <figcaption>idle</figcaption>
  </figure>
  <figure>
    <HexButton icon="layers" label="Layers" pressed />
    <figcaption>pressed (active)</figcaption>
  </figure>
  <figure>
    <HexButton
      icon="flower"
      label="Flower plot"
      inactive
      inactiveReason="Flower plot — Scores only"
      onAnnounce={(text) => (announced = text)}
    />
    <figcaption>inactive (hover/focus to see the tooltip; click to hear it announced)</figcaption>
  </figure>
</div>

<p class="live" role="status" aria-live="polite">{announced}</p>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    padding: var(--space-4);
  }

  figure {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }

  figcaption {
    max-width: 12em;
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .live {
    margin: var(--space-2) 0 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    min-height: 1.2em;
  }
</style>
