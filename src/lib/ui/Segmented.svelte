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
    /** P round deliverable 1 (Ben, live-review 2026-09-24): the Layers panel's new "Raster cells |
     * Program Areas" toggle renders disabled in the Species lens (species surfaces are rasters
     * only -- there is no spatial-unit CHOICE to make there). Every other caller (the top bar's
     * Scores|Species switch, the feedback-kind picker, the table sub-tab) omits this -- default
     * `false`, unchanged. A disabled segment shows neither segment as "pressed" in accent (native
     * `disabled` also drops it from the Tab order, same convention as `Switch.svelte`'s `disabled`). */
    disabled?: boolean;
  }

  let { options, value, ariaLabel, onchange, disabled = false }: Props = $props();
</script>

<div class="seg" role="group" aria-label={ariaLabel}>
  {#each options as opt (opt.value)}
    <button
      type="button"
      aria-pressed={value === opt.value}
      {disabled}
      onclick={() => onchange?.(opt.value)}
    >
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
    /* R5 y1: --fill-accent alone is 1.49:1 on paper (exempt) -- an inset ring (no layout impact,
       unlike a real border) carries the pressed state at >= 3:1, per WCAG 1.4.11. */
    box-shadow: inset 0 0 0 2px var(--border-accent);
  }

  /* P round deliverable 1: a disabled segment never shows the accent "pressed" look (the Species
     lens has no real spatial-unit CHOICE, so nothing is genuinely "selected" among these two) --
     `--fill-track`, the SAME neutral/off token `Switch.svelte` uses for its own off state. */
  .seg button:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .seg button:disabled[aria-pressed="true"] {
    background: var(--fill-track);
    color: var(--text-secondary);
    font-weight: 400;
    box-shadow: none;
  }

  /* SC 1.4.1/1.4.11: forced-colors mode leaves every segment's background at Canvas, erasing
     which lens is selected; Highlight/HighlightText restores that distinction. */
  @media (forced-colors: active) {
    .seg {
      border-color: ButtonText;
    }
    .seg button[aria-pressed="true"] {
      background: Highlight;
      color: HighlightText;
    }
    .seg button:disabled {
      color: GrayText;
    }
    .seg button:disabled[aria-pressed="true"] {
      background: ButtonFace;
      color: GrayText;
    }
  }
</style>
