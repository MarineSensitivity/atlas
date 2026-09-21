<script lang="ts">
  // atlas-3 spec.md §5.4 ("Chip / version chip") and §5.5 (the protection chips): one small tag,
  // plain or interactive (a `version` chip like `v7 ▾` opens the release picker), optionally
  // dismissible. The protection chips (spec.md §5.5) are plain instances of this component --
  // src/lib/ui/protectionChip.ts already computed the exact "MMPA · floor 20" / "MMPA · not
  // applicable" text; this component has no "not applicable" state of its own to render.
  import Icon from "./Icon.svelte";

  interface Props {
    label: string;
    variant?: "default" | "accent";
    /** renders as a <button> (e.g. the version chip, which opens the release picker) instead of
     * a plain <span> (e.g. a protection or category chip, which is not interactive) */
    onclick?: () => void;
    /** adds a dismiss (×) control; fires with nothing else happening to the chip itself -- the
     * caller removes it */
    onDismiss?: () => void;
    class?: string;
  }

  let { label, variant = "default", onclick, onDismiss, class: className = "" }: Props = $props();
</script>

{#if onclick}
  <button type="button" class="chip chip--{variant} {className}" {onclick}>
    {label}
  </button>
{:else}
  <span class="chip chip--{variant} {className}">
    {label}
    {#if onDismiss}
      <button type="button" class="chip-dismiss" aria-label="Remove {label}" onclick={onDismiss}>
        <Icon name="close" size={12} />
      </button>
    {/if}
  </span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  button.chip {
    cursor: pointer;
  }

  button.chip:hover {
    border-color: var(--text-secondary);
  }

  button.chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .chip--accent {
    background: var(--fill-accent);
    border-color: var(--fill-accent);
    color: var(--text-on-accent);
  }

  .chip-dismiss {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-left: var(--space-1);
    border: 0;
    border-radius: 50%;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  .chip-dismiss:hover {
    background: color-mix(in srgb, currentColor 20%, transparent);
  }

  .chip-dismiss:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* SC 1.4.1/1.4.11: forced-colors mode leaves the default and accent chip backgrounds
     indistinguishable (both fall back to Canvas); Highlight/HighlightText restores the
     accent/active state, and an explicit border keeps a plain chip's shape visible. */
  @media (forced-colors: active) {
    .chip {
      border-color: ButtonText;
    }
    .chip--accent {
      background: Highlight;
      border-color: Highlight;
      color: HighlightText;
    }
  }
</style>
