<script lang="ts">
  import Panel from "../../lib/ui/Panel.svelte";
</script>

<div class="stage">
  <Panel id="gallery-demo" title="Layers">
    <p>
      One-line summary first; detail in accordions (spec.md §"Panels"). Try the three controls in
      the upper right: collapse to a pill, half height, full height. Press <kbd>Esc</kbd> anywhere in
      here to collapse.
    </p>
    <p class="muted">
      Geometry (collapsed + half/full) is remembered per viewport size in
      <code>localStorage</code>, keyed by this panel's <code>id</code>.
    </p>
  </Panel>
</div>

<style>
  .stage {
    position: relative;
    min-height: 320px;
    padding: var(--space-4);
  }

  p {
    margin: 0 0 var(--space-3);
    font-size: var(--text-md);
  }

  .muted {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
