<script lang="ts">
  import Honeycomb from "../../lib/ui/Honeycomb.svelte";
</script>

<div class="stage">
  <Honeycomb label="Loading species table…" />
</div>
<p class="note">
  Emulate <code>prefers-reduced-motion: reduce</code> in devtools to see the static variant -- the status
  text is always present either way.
</p>

<style>
  .stage {
    padding: var(--space-4);
  }

  .note {
    margin: 0 var(--space-4);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
