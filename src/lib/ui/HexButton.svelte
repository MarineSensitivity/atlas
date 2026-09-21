<script lang="ts">
  // atlas-3 spec.md §5.1/§5.2/§5.4: the tool rail's hexagon button, and the one control that
  // demonstrates "inactive fades in place, never removed." No words on the control itself -- the
  // tooltip carries them, so `label` is both the accessible name AND the tooltip text.
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icon-paths";

  interface Props {
    icon: IconName;
    /** the accessible name; also the tooltip text unless `inactive` supplies its own reason */
    label: string;
    pressed?: boolean;
    /** spec.md §5.2: NOT the `disabled` attribute -- stays focusable and explains itself */
    inactive?: boolean;
    /** why the control is inactive; shown in the tooltip and re-announced on activation. Required
     * in practice whenever `inactive` is true (spec.md §5.2's "Flower plot — Scores only") */
    inactiveReason?: string;
    /** spec.md §5.2: "activation is a no-op that re-announces the tooltip text in the live
     * region" -- the rail (or whatever hosts the live region) supplies this */
    onAnnounce?: (text: string) => void;
    onclick?: () => void;
    tabindex?: number;
  }

  let {
    icon,
    label,
    pressed = false,
    inactive = false,
    inactiveReason,
    onAnnounce,
    onclick,
    tabindex = 0,
  }: Props = $props();

  let showTooltip = $state(false);
  const tooltipText = $derived(inactive && inactiveReason ? inactiveReason : label);
  const tooltipId = $derived(`hexbtn-tip-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);

  function handleClick() {
    if (inactive) {
      onAnnounce?.(tooltipText);
      return;
    }
    onclick?.();
  }
</script>

<span class="hexbtn-wrap">
  <button
    type="button"
    class="hexbtn"
    aria-label={label}
    aria-pressed={pressed}
    aria-disabled={inactive ? "true" : undefined}
    aria-describedby={tooltipId}
    {tabindex}
    onclick={handleClick}
    onfocus={() => (showTooltip = true)}
    onblur={() => (showTooltip = false)}
    onmouseenter={() => (showTooltip = true)}
    onmouseleave={() => (showTooltip = false)}
  >
    <Icon name={icon} size={20} class={inactive ? "hexbtn-icon-inactive" : ""} />
  </button>
  <span class="tooltip" id={tooltipId} role="tooltip" hidden={!showTooltip}>{tooltipText}</span>
</span>

<style>
  .hexbtn-wrap {
    position: relative;
    display: inline-block;
  }

  .hexbtn {
    position: relative;
    width: var(--size-touch);
    height: var(--size-touch);
    display: grid;
    place-items: center;
    color: var(--text-primary);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  .hexbtn::before,
  .hexbtn::after {
    content: "";
    position: absolute;
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    transition: background var(--motion-fast) var(--ease-out);
  }

  .hexbtn::before {
    inset: 0;
    background: var(--border-control);
  }

  .hexbtn::after {
    inset: 2px;
    background: var(--fill-control);
  }

  .hexbtn:hover::after {
    background: var(--fill-track);
  }

  .hexbtn :global(.icon) {
    position: relative;
    z-index: 1;
  }

  .hexbtn[aria-pressed="true"]::after {
    background: var(--fill-accent);
  }

  .hexbtn[aria-pressed="true"] :global(.icon) {
    color: var(--text-on-accent);
  }

  .hexbtn[aria-disabled="true"] {
    cursor: not-allowed;
  }

  .hexbtn :global(.hexbtn-icon-inactive) {
    color: var(--icon-inactive);
    transition: color var(--motion-panel) var(--ease-out);
  }

  .hexbtn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .tooltip {
    position: absolute;
    left: calc(100% + var(--space-2));
    top: 50%;
    transform: translateY(-50%);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-size: var(--text-sm);
    white-space: nowrap;
    box-shadow: var(--elev-2);
    pointer-events: none;
    z-index: 10;
  }
</style>
