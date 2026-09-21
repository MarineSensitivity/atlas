<script lang="ts">
  // atlas-3 spec.md §5.1/§5.2/§5.4: the tool rail's hexagon button, and the one control that
  // demonstrates "inactive fades in place, never removed." No words on the control itself -- the
  // tooltip carries them, so `label` is both the accessible name AND the tooltip text.
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icon-paths";
  import { uid } from "./uid";

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
  // per-INSTANCE, not per-label (SC 4.1.2): two HexButtons both labelled "Layers" must not share a
  // tooltip id, or the second one's aria-describedby resolves to the first's tooltip content.
  const tooltipId = uid("hexbtn-tip");

  // SC 1.4.13 (Content on Hover or Focus): a tooltip a pointer reveals must stay up long enough
  // for the pointer to reach IT, even across the gap between the button and the absolutely
  // positioned tooltip (the button's own mouseleave fires before the pointer arrives there) --
  // hence the short close delay, cancelled if either element reports the pointer is still over
  // it. Esc dismisses without moving focus (does not blur the button), and stops the keydown from
  // also being read as "collapse the enclosing panel" (the innermost open layer handles Esc first).
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
    onkeydown={handleKeydown}
    onfocus={showNow}
    onblur={scheduleHide}
    onmouseenter={showNow}
    onmouseleave={scheduleHide}
  >
    <Icon name={icon} size={20} class={inactive ? "hexbtn-icon-inactive" : ""} />
  </button>
  <span
    class="tooltip"
    id={tooltipId}
    role="tooltip"
    hidden={!showTooltip}
    onmouseenter={showNow}
    onmouseleave={scheduleHide}>{tooltipText}</span
  >
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
    /* hoverable (SC 1.4.13): the pointer must be able to reach and rest on the tooltip itself
       across the gap left of it -- pointer-events was none before, which made that impossible */
    z-index: 10;
  }

  /* SC 1.4.1/1.4.11: forced-colors mode (Windows High Contrast) strips backgrounds and non-text
     colors down to a handful of system keywords -- without an explicit fallback, the idle,
     pressed and inactive FACES all render identically (ButtonFace), erasing which tool is active
     and which is disabled. System colors here, not the brand tokens (which forced-colors ignores
     anyway): ButtonFace/ButtonText/ButtonBorder for the idle face+glyph+edge, Highlight/
     HighlightText for the pressed state (the same pair the OS itself uses for a selected control),
     GrayText for the inactive glyph. */
  @media (forced-colors: active) {
    .hexbtn::before {
      background: ButtonBorder;
    }
    .hexbtn::after {
      background: ButtonFace;
    }
    .hexbtn {
      color: ButtonText;
    }
    .hexbtn[aria-pressed="true"]::after {
      background: Highlight;
    }
    .hexbtn[aria-pressed="true"] :global(.icon) {
      color: HighlightText;
    }
    .hexbtn :global(.hexbtn-icon-inactive) {
      color: GrayText;
    }
  }
</style>
