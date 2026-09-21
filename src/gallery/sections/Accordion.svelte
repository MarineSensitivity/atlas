<script lang="ts">
  import Accordion from "../../lib/ui/Accordion.svelte";
</script>

<div class="stage">
  <Accordion title="The ER-score rule">
    <p>The extinction-risk score floors MMPA at 20 and MBTA at 10 (spec.md §5.5).</p>
  </Accordion>
  <Accordion title="Table columns" defaultOpen>
    <p>Species, scientific name, category, component scores, protection statutes.</p>
  </Accordion>
</div>

<style>
  .stage {
    max-width: 28em;
    padding: var(--space-4);
  }

  p {
    margin: 0;
  }
</style>
