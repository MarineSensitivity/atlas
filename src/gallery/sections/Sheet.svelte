<script lang="ts">
  import Sheet from "../../lib/ui/Sheet.svelte";
</script>

<div class="stage">
  <Sheet id="gallery-demo" title="St. George Basin">
    <p class="kicker"><span class="chip">Program Area · GEO</span> <span>v7</span></p>
    <p>
      Peek / half / full, a wave top edge, a grab handle. The scroll region below is reachable by
      keyboard even with no focusable child of its own (axe <code>scrollable-region-focusable</code
      >).
    </p>
    <p class="muted">
      This block repeats a few times so the sheet body actually scrolls at "half" -- try Tab into
      it, then arrow/Page Down.
    </p>
    <p class="muted">More content, more content, more content, more content, more content.</p>
    <p class="muted">More content, more content, more content, more content, more content.</p>
  </Sheet>
</div>

<style>
  .stage {
    position: relative;
    max-width: 390px;
    padding: var(--space-4);
  }

  .kicker {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin: 0 0 var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    text-transform: none;
    letter-spacing: normal;
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
