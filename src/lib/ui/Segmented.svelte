<script lang="ts" module>
  export interface SegmentedOption {
    value: string;
    label: string;
  }
</script>

<script lang="ts">
  // atlas-3 spec.md §5.4 ("Segmented (lens)"): the top bar's Scores | Species switch. Plain Tab
  // order (not roving tabindex) -- spec.md §5.3 makes the same call for the panel-size group:
  // two or three targets do not justify it.
  interface Props {
    options: SegmentedOption[];
    value: string;
    ariaLabel: string;
    onchange?: (value: string) => void;
  }

  let { options, value, ariaLabel, onchange }: Props = $props();
</script>

<div class="seg" role="group" aria-label={ariaLabel}>
  {#each options as opt (opt.value)}
    <button type="button" aria-pressed={value === opt.value} onclick={() => onchange?.(opt.value)}>
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .seg button {
    height: 30px;
    padding: 0 var(--space-4);
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .seg button:hover {
    color: var(--text-primary);
  }

  .seg button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .seg button[aria-pressed="true"] {
    background: var(--fill-accent);
    color: var(--text-on-accent);
    font-weight: 700;
  }
</style>
