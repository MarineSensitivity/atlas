<script lang="ts">
  import Chip from "../../lib/ui/Chip.svelte";
  import { protectionChipLabel } from "../../lib/ui/protectionChip";

  let dismissed = $state(false);
</script>

<div class="row">
  <Chip label="Program Area · GEO" />
  <Chip label="v7" variant="accent" onclick={() => {}} />
  {#if !dismissed}
    <Chip label="Bathymetry" onDismiss={() => (dismissed = true)} />
  {/if}
</div>

<p class="label">Protection chips (spec.md §5.5) -- ALWAYS both statutes, never one alone:</p>
<div class="row">
  <span class="sp-label">Blue whale (mammal):</span>
  <Chip label={protectionChipLabel("MMPA", "mammal")} />
  <Chip label={protectionChipLabel("MBTA", "mammal")} />
</div>
<div class="row">
  <span class="sp-label">Black-footed albatross (bird):</span>
  <Chip label={protectionChipLabel("MMPA", "bird")} />
  <Chip label={protectionChipLabel("MBTA", "bird")} />
</div>
<div class="row">
  <span class="sp-label">Leatherback turtle (turtle):</span>
  <Chip label={protectionChipLabel("MMPA", "turtle")} />
  <Chip label={protectionChipLabel("MBTA", "turtle")} />
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
  }

  .label {
    margin: var(--space-2) var(--space-4) 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .sp-label {
    min-width: 14em;
    font-size: var(--text-sm);
  }
</style>
