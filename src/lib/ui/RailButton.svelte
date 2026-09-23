<script lang="ts">
  // R4 (docs/usability.md §7): the tool rail's own button, replacing HexButton.svelte in this
  // role (HexButton stays -- the gallery still shows it, and its own hexagon shape is now reused
  // by the LOGO and by this component's active marker instead of the button's own face). A
  // labelled vertical stack: icon above a visible short label, not an icon-only hex needing a
  // hover to learn (docs/usability.md's own finding: "they read as decoration ... a first-timer
  // has to hover each"). The active tool is marked by a small hexagon PIP beside the button
  // (`--fill-accent`), the same shape and position the reviewed mockup uses
  // (docs/design/mockups/r2/r2.css's `.rail-stack button.is-on::before`) -- not the button's own
  // face, which is now a plain rounded rect.
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icon-paths";
  import { uid } from "./uid";
  import type { Orientation } from "./roving";

  interface Props {
    icon: IconName;
    /** the visible label AND the accessible name (no more hover-to-learn) */
    label: string;
    pressed?: boolean;
    /** spec.md §5.2: NOT the `disabled` attribute -- stays focusable and explains itself */
    inactive?: boolean;
    /** why the control is inactive; shown in a tooltip and re-announced on activation */
    inactiveReason?: string;
    onAnnounce?: (text: string) => void;
    onclick?: () => void;
    tabindex?: number;
    orientation?: Orientation;
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
    orientation = "vertical",
  }: Props = $props();

  // per-INSTANCE tooltip id (SC 4.1.2) -- only rendered/wired while `inactive`, since an active
  // control's name is now the visible label and needs no tooltip of its own.
  const tooltipId = uid("railitem-tip");
  let showTooltip = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function showNow() {
    if (!inactive) return;
    clearTimeout(closeTimer);
    showTooltip = true;
  }

  function scheduleHide() {
    if (!inactive) return;
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
      onAnnounce?.(inactiveReason ?? label);
      return;
    }
    onclick?.();
  }
</script>

<span class="railitem-wrap">
  <button
    type="button"
    class="railitem"
    class:is-on={pressed}
    class:railitem--horizontal={orientation === "horizontal"}
    aria-label={label}
    aria-current={pressed ? "true" : undefined}
    aria-disabled={inactive ? "true" : undefined}
    aria-describedby={inactive ? tooltipId : undefined}
    {tabindex}
    onclick={handleClick}
    onkeydown={handleKeydown}
    onfocus={showNow}
    onblur={scheduleHide}
    onmouseenter={showNow}
    onmouseleave={scheduleHide}
  >
    <Icon name={icon} size={20} class="railitem-icon {inactive ? 'railitem-icon-inactive' : ''}" />
    <span class="railitem-label">{label}</span>
  </button>
  {#if inactive}
    <span
      class="tooltip"
      id={tooltipId}
      role="tooltip"
      hidden={!showTooltip}
      onmouseenter={showNow}
      onmouseleave={scheduleHide}>{inactiveReason ?? label}</span
    >
  {/if}
</span>

<style>
  .railitem-wrap {
    position: relative;
    display: inline-block;
  }

  .railitem {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 60px;
    min-height: var(--size-touch);
    padding: 8px 2px 6px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
    line-height: 1.1;
    cursor: pointer;
    transition:
      background var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out);
  }

  .railitem:hover {
    background: var(--fill-control);
  }

  /* the very narrow phone (320px, the smallest viewport scripts/verify.mjs covers -- the same
     breakpoint shell.css's `.topbar` squeeze already uses): five 60px items + gaps + the rail's
     own padding sum to 336px, wider than the viewport, and overflow horizontally
     (e2e/shell.a11y.spec.ts's assertLayout caught this). Narrower items fit five in 320px with
     room to spare; the label still truncates to an ellipsis rather than wrapping or disappearing,
     and the full name stays on aria-label regardless of what is visually legible. */
  @media (max-width: 380px) {
    .railitem {
      width: 44px;
    }
  }

  .railitem-label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .railitem :global(.railitem-icon) {
    color: var(--text-primary);
  }

  /* the active marker: a small brand hexagon PIP beside the button (R4 -- "the hexagon moves to
     the logo and the active marker"), not the button's own face. Vertical stack: to its left;
     phone tab bar (horizontal): above it -- either way, outside the touch target, never resized
     by it. Candidate y1: --border-accent rings it too, so the pip stays legible against
     --fill-accent's own 1.49:1-on-paper fill (WCAG 1.4.11). */
  .railitem.is-on::before {
    content: "";
    position: absolute;
    width: 7px;
    height: 8px;
    background: var(--fill-accent);
    box-shadow: 0 0 0 1px var(--border-accent);
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  }

  .railitem.is-on:not(.railitem--horizontal)::before {
    left: -9px;
    top: 50%;
    margin-top: -4px;
  }

  .railitem.is-on.railitem--horizontal::before {
    top: -7px;
    left: 50%;
    margin-left: -3.5px;
  }

  .railitem.is-on {
    background: var(--fill-accent);
    color: var(--text-on-accent);
    font-weight: 700;
    /* candidate y1: --fill-accent alone is 1.49:1 on paper (exempt) -- this ring (paint only, no
       layout impact) is the boundary that carries the active state at >= 3:1, per WCAG 1.4.11. */
    box-shadow: 0 0 0 2px var(--border-accent);
  }

  .railitem.is-on :global(.railitem-icon) {
    color: var(--text-on-accent);
  }

  .railitem[aria-disabled="true"] {
    cursor: not-allowed;
  }

  .railitem :global(.railitem-icon-inactive) {
    color: var(--icon-inactive);
    transition: color var(--motion-panel) var(--ease-out);
  }

  .railitem.is-on .railitem-label,
  .railitem:not(.is-on) .railitem-label {
    color: inherit;
  }

  .railitem:focus-visible {
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
    z-index: 10;
  }

  /* SC 1.4.1/1.4.11: forced-colors mode strips backgrounds/non-text colors to a handful of system
     keywords -- without an explicit fallback the idle/pressed/inactive faces read identically. */
  @media (forced-colors: active) {
    .railitem {
      color: ButtonText;
    }
    .railitem.is-on {
      background: Highlight;
      color: HighlightText;
    }
    .railitem.is-on :global(.railitem-icon) {
      color: HighlightText;
    }
    .railitem.is-on::before {
      background: Highlight;
      box-shadow: 0 0 0 1px ButtonText;
    }
    .railitem :global(.railitem-icon-inactive) {
      color: GrayText;
    }
  }
</style>
