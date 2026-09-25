<script lang="ts">
  // atlas-3 spec.md "Panels": "an ⓘ opens a two-sentence popover whose 'More' opens a modal."
  // This component owns only the popover itself (trigger + floating content, dismiss on outside
  // click or Esc, focus returns to the trigger on close); composing its content with a "More"
  // button that opens a Modal is the caller's job (see the gallery section).
  import { onMount, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { uid } from "./uid";

  interface Props {
    /** the trigger's accessible name, e.g. "About the ER-score rule" */
    label: string;
    children: Snippet;
    /** R3 (Layers-pane redesign, 2026-09-25): the default trigger is a bare (i) icon in an 18px
     * round button -- fine for a "more info" aside, too small/opaque for a control that opens a
     * WORKING input (the per-row opacity slider, the color-ramp picker). When given, this renders
     * INSIDE the trigger button instead of the (i) icon; every other part of the trigger (the real
     * `<button>`, its `aria-expanded`/`aria-controls`/`aria-label`, open/close, outside-click, Esc)
     * is unchanged, so a caller only ever customizes what the button shows, never how it behaves. */
    trigger?: Snippet;
    /** an extra class on the trigger `<button>` -- the default 18px round shape is wrong for a
     * content-sized trigger like "gradient strip + palette name" or "icon + 62%". Ignored when
     * `trigger` is omitted (the default (i) button keeps its own fixed size regardless). */
    triggerClass?: string;
    /** which edge the popover opens from -- `"left"` (default, unchanged) or `"right"`, for a
     * trigger near the panel's own right edge where a left-opening popover would overflow it. */
    align?: "left" | "right";
    /** R3 (ramp picker, `lens/scores/LayersPanel.svelte`): `$bindable` so a caller can close the
     * popover itself after a selection (a listbox's own "pick an option" gesture, distinct from
     * Esc/outside-click, which this component already owned). Every existing caller omits it and
     * keeps the original self-contained open/close it always had. */
    open?: boolean;
    /** Fix round (orchestrator, 2026-09-25): "the popover as wide as the trigger" -- the default
     * popover is a fixed 240px (right for a short prose aside); a full-row trigger like the ramp
     * picker's own `Select`-shaped button wants its dropdown to match. `.popover-wrap` (the
     * positioned ancestor `width: 100%` resolves against) already stretches to the trigger's own
     * width when the caller's trigger itself is `width: 100%` of ITS OWN container (true for
     * `.ramp-trigger`) -- so this is just "opt into that," never a caller-supplied pixel value. */
    matchTriggerWidth?: boolean;
  }

  let {
    label,
    children,
    trigger,
    triggerClass,
    align = "left",
    open = $bindable(false),
    matchTriggerWidth = false,
  }: Props = $props();
  let wrapEl: HTMLSpanElement | undefined;
  let triggerEl: HTMLButtonElement | undefined;
  let popoverEl: HTMLDivElement | undefined = $state();
  // per-INSTANCE, not per-label (SC 4.1.2) -- see HexButton.svelte's identical fix.
  const popoverId = uid("popover");

  function close() {
    if (!open) return;
    open = false;
  }

  // "focus returns to the trigger on close" (this component's own header) -- tracked here, not
  // inline in `close()`, so a caller closing the (now bindable) `open` prop directly from OUTSIDE
  // (the ramp picker's own "select an option" click) gets the identical refocus, not just Esc/
  // outside-click. `wasOpen` starts false (matching `open`'s own default), so mount fires no focus.
  let wasOpen = false;
  $effect(() => {
    if (wasOpen && !open) triggerEl?.focus();
    wasOpen = open;
  });

  // Fix round (Opus 5.5 eyes-on review, D6): "on the phone, the palette popover runs under the
  // bottom nav" -- the popover always opened DOWNWARD with no bound on its own height. The first
  // pass here measured against `window.innerHeight`, which is WRONG for the phone sheet: the
  // fixed bottom tab rail (`.rail-region`) is not part of document flow, so it eats no height
  // `window.innerHeight` ever reports -- a popover that "fits the viewport" by that measure still
  // renders UNDER the rail, which paints over it (a later, higher-z-index sibling), the exact
  // "Magma hidden" symptom. `.sheet` (phone) and `.panel-body` (desktop) are BOTH already sized to
  // stop short of their own reserved chrome (`--size-rail-row` on the sheet; the panel's own
  // scroll/dock bounds) -- the real available space is THAT container's own edge, not the raw
  // viewport. Measured at OPEN time (not reactively tracked -- the trigger's own position does
  // not change while a popover is open in any caller today): flip to open UPWARD when there is
  // more room above the trigger than below, and cap the popover's own height to whatever room is
  // actually available in whichever direction it opens, with `overflow-y: auto` as the CSS-level
  // floor regardless (so a caller neither ancestor class matches -- the gallery demos -- still
  // falls back to the viewport and never renders content unreachably off-screen).
  let openUpward = $state(false);
  let maxHeightPx = $state<number | undefined>(undefined);
  const POPOVER_EDGE_MARGIN = 8;

  $effect(() => {
    if (!open || !triggerEl || !popoverEl) return;
    const triggerRect = triggerEl.getBoundingClientRect();
    const boundary = triggerEl.closest(".sheet, .panel-body");
    const boundaryRect = boundary?.getBoundingClientRect();
    const top = boundaryRect?.top ?? 0;
    const bottom = boundaryRect?.bottom ?? window.innerHeight;
    const spaceBelow = bottom - triggerRect.bottom - POPOVER_EDGE_MARGIN;
    const spaceAbove = triggerRect.top - top - POPOVER_EDGE_MARGIN;
    // the natural (uncapped) content height -- read BEFORE this effect's own max-height takes
    // effect on this render, so a re-open after a viewport resize re-measures the real content,
    // never a stale cap from the previous open.
    const naturalHeight = popoverEl.scrollHeight;
    const up = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
    openUpward = up;
    maxHeightPx = Math.max(80, up ? spaceAbove : spaceBelow);
  });

  function handleDocumentPointerdown(event: PointerEvent) {
    if (!open) return;
    const target = event.target as Node;
    if (popoverEl?.contains(target) || triggerEl?.contains(target)) return;
    open = false; // dismissed by clicking elsewhere -- focus was already elsewhere, no return needed
  }

  // LOCAL, not document-level: the innermost open layer handles Esc first. A listener on
  // `document` only ever runs once the keydown has already bubbled past every ancestor
  // (including an enclosing Panel's own Escape-collapses-it handler), so by the time this fired
  // the panel would already have collapsed too. Attached to the popover's own wrapper, this runs
  // WHILE the event is still bubbling through the popover's own subtree, before it ever reaches
  // an ancestor Panel -- stopPropagation() there keeps it from doing so.
  function handleLocalKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  onMount(() => {
    document.addEventListener("pointerdown", handleDocumentPointerdown);
    // imperative, not a template `onkeydown`, so svelte-check's a11y rule (rightly, for the usual
    // case of a fake button) does not flag a plain wrapper span for a keyboard shortcut that is
    // really about the whole popover, not a widget role this element should pretend to have.
    const el = wrapEl;
    el?.addEventListener("keydown", handleLocalKeydown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerdown);
      el?.removeEventListener("keydown", handleLocalKeydown);
    };
  });
</script>

<span class="popover-wrap" bind:this={wrapEl}>
  <button
    type="button"
    class="popover-trigger {triggerClass ?? ''}"
    class:popover-trigger--icon={!trigger}
    bind:this={triggerEl}
    aria-expanded={open}
    aria-controls={popoverId}
    aria-label={label}
    onclick={() => (open = !open)}
  >
    {#if trigger}
      {@render trigger()}
    {:else}
      <Icon name="info" size={16} />
    {/if}
  </button>
  <!-- always rendered (never {#if open}), toggled with `hidden` -- aria-controls (on the trigger
       above) must reference an element that actually EXISTS in the DOM (SC 4.1.2); see
       Accordion.svelte's identical fix for the same reason. -->
  <div
    class="popover"
    class:popover--right={align === "right"}
    class:popover--match-trigger={matchTriggerWidth}
    class:popover--up={openUpward}
    id={popoverId}
    bind:this={popoverEl}
    hidden={!open}
    style:max-height={maxHeightPx !== undefined ? `${maxHeightPx}px` : undefined}
  >
    {@render children()}
  </div>
</span>

<style>
  .popover-wrap {
    position: relative;
    display: inline-block;
  }

  /* Fix round (orchestrator, 2026-09-25, desktop-04/phone-04): the base rule used to carry the
     default (i)-icon button's own fixed 18x18 round `inline-grid; place-items: center` shape, and
     a `.popover-trigger--custom` modifier tried to override just width/height/display for a
     custom trigger (opacity %, ramp strip + name) -- but BOTH classes live in this SAME component,
     so Svelte's CSS scoping gives them equal specificity, and the two rules' properties fought
     (e.g. `.popover-trigger`'s `display: inline-grid` was never actually overridden, silently
     stacking a custom trigger's icon/text on top of each other in one grid cell). The fixed-icon
     shape now lives ENTIRELY on its own `--icon` modifier instead: the base carries only what
     EVERY trigger shares (border, cursor, color, focus/pressed state), so a custom trigger's own
     `triggerClass` (the caller's `:global(...)` rules, e.g. `.opacity-btn`/`.ramp-trigger`) is the
     ONLY thing ever setting layout/size for it -- no cross-component specificity fight possible. */
  .popover-trigger {
    border: 1px solid var(--border-control);
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
  }

  .popover-trigger--icon {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-pill);
  }

  .popover-trigger:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .popover-trigger[aria-expanded="true"] {
    color: var(--text-primary);
    border-color: var(--text-primary);
  }

  .popover {
    position: absolute;
    z-index: 20;
    top: calc(100% + var(--space-2));
    left: 0;
    width: 240px;
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-size: var(--text-sm);
    box-shadow: var(--elev-3);
    /* fix round (D6): a CSS-level floor regardless of the JS measurement above -- overflow
       scrolls rather than rendering content past the visible viewport (under the phone's fixed
       bottom rail) if that measurement is ever unavailable (e.g. a caller/test environment with
       no real layout). `max-height` itself is set inline, per-open, by the JS above. */
    overflow-y: auto;
  }

  .popover--right {
    left: auto;
    right: 0;
  }

  /* fix round (D6): flips the popover to open ABOVE the trigger instead of below, when the JS
     measurement above finds more room there -- the ramp picker sitting at the very bottom of a
     phone sheet's own "Data" row is the motivating case (its natural height ran under the fixed
     bottom tab rail when it always opened downward). */
  .popover--up {
    top: auto;
    bottom: calc(100% + var(--space-2));
  }

  /* Fix round (orchestrator, 2026-09-25): "the popover as wide as the trigger" -- `.popover-wrap`
     is a flex ITEM of the caller's own column-flex field, so it already stretches to the trigger's
     own full width (align-items: stretch, the flex default) when the trigger itself is width:
     100% of its container (true for `.ramp-trigger`); `width: 100%` here just opts THIS popover
     into matching that, instead of the default fixed 240px sized for a short prose aside. */
  .popover--match-trigger {
    width: 100%;
  }
</style>
