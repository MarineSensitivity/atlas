<script lang="ts">
  // atlas-3 spec.md §5.4 ("Layer pill") and §5.3 (a collapsed panel becomes "a labelled pill on
  // the nearest edge"): one small control that is either a SELECTABLE toggle (`pressed`, e.g. a
  // layer filter), a DISCLOSURE (`expanded` + `controls`, e.g. Panel's collapsed state), or
  // disabled with a reason (spec.md: "…feeds the merged model, but v7 publishes no surface for
  // it"). Exactly one of `pressed`/`expanded` applies to a given instance -- never both.
  import { uid } from "./uid";

  interface Props {
    label: string;
    pressed?: boolean;
    /** disclosure mode: pairs with `controls` (the id of the region this pill reveals) */
    expanded?: boolean;
    controls?: string;
    disabled?: boolean;
    /** required in practice whenever `disabled` is true -- spec.md: "a dashed border,
     * strike-through, aria-disabled, and a tooltip that says WHY" */
    disabledReason?: string;
    onclick?: () => void;
    class?: string;
  }

  let {
    label,
    pressed = false,
    expanded,
    controls,
    disabled = false,
    disabledReason,
    onclick,
    class: className = "",
  }: Props = $props();

  let showTooltip = $state(false);
  // per-INSTANCE, not per-label (SC 4.1.2) -- see HexButton.svelte's identical fix.
  const tooltipId = uid("pill-tip");

  // SC 1.4.13: hoverable (a short close delay covers the gap the pointer crosses to reach the
  // tooltip) and Esc-dismissible without moving focus -- see HexButton.svelte's identical fix.
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function showNow() {
    clearTimeout(closeTimer);
    showTooltip = true;
  }

  function scheduleHide() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => (showTooltip = false), 150);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && showTooltip) {
      event.stopPropagation();
      clearTimeout(closeTimer);
      showTooltip = false;
    }
  }
</script>

<span class="pill-wrap">
  <button
    type="button"
    class="pill {className}"
    class:pill--disabled={disabled}
    aria-pressed={expanded === undefined ? pressed : undefined}
    aria-expanded={expanded}
    aria-controls={controls}
    aria-disabled={disabled ? "true" : undefined}
    aria-describedby={disabled && disabledReason ? tooltipId : undefined}
    {onclick}
    onkeydown={handleKeydown}
    onfocus={showNow}
    onblur={scheduleHide}
    onmouseenter={showNow}
    onmouseleave={scheduleHide}
  >
    {label}
  </button>
  {#if disabled && disabledReason}
    <span
      class="tooltip"
      id={tooltipId}
      role="tooltip"
      hidden={!showTooltip}
      onmouseenter={showNow}
      onmouseleave={scheduleHide}
    >
      {disabledReason}
    </span>
  {/if}
</span>

<style>
  .pill-wrap {
    position: relative;
    display: inline-block;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  .pill:hover {
    border-color: var(--text-secondary);
  }

  .pill:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .pill[aria-pressed="true"],
  .pill[aria-expanded="true"] {
    background: var(--fill-accent);
    border-color: var(--fill-accent);
    color: var(--text-on-accent);
    font-weight: 700;
  }

  .pill--disabled {
    border-style: dashed;
    color: var(--text-secondary);
    text-decoration: line-through;
    cursor: not-allowed;
  }

  .tooltip {
    position: absolute;
    left: 50%;
    top: calc(100% + var(--space-1));
    transform: translateX(-50%);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-size: var(--text-sm);
    white-space: nowrap;
    box-shadow: var(--elev-2);
    /* hoverable (SC 1.4.13): the pointer must be able to reach and rest on the tooltip itself */
    z-index: 10;
  }
</style>
