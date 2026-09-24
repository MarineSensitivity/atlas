<script lang="ts">
  // R1 (docs/usability.md §7, owner decision 2026-09-24): ONE dockable panel -- dock left / right /
  // bottom (a control in the header), drag-resize on the panel's map-facing edge (320-720 px),
  // maximize to the whole stage (backdrop, Esc restores, focus trapped while maximized, the map
  // stays mounted underneath) and collapse to the edge pill. Replaces the old three-button
  // "collapse / half / full" model (0.10.28 and earlier) -- "full" used to mean "content height
  // inside the same 380px-wide card"; maximize now means the whole stage, which is the usability
  // M6 fix ("panels do not resize, move or maximize... wide tables scroll inside 380px").
  //
  // Geometry (collapsed + dock + size + maximized) is chrome, remembered per viewport size in
  // localStorage (src/lib/ui/panelGeometry.ts), never the URL. Esc means "back off one level": it
  // restores from maximized, or (not maximized) collapses to the pill -- the innermost meaning for
  // whichever state the panel is actually in.
  import { onMount, tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import Pill from "./Pill.svelte";
  import {
    clampPanelSize,
    DEFAULT_PANEL_GEOMETRY,
    loadPanelGeometry,
    PANEL_RESIZE_STEP,
    PANEL_RESIZE_STEP_FAST,
    PANEL_SIZE_MAX,
    PANEL_SIZE_MIN,
    savePanelGeometry,
    viewportBucket,
    type Dock,
    type PanelGeometry,
  } from "./panelGeometry";

  interface Props {
    /** used for the localStorage key and the body's element id (the collapse control's
     * aria-controls target) -- must be unique among panels on the page */
    id: string;
    title: string;
    children: Snippet;
    /** R1: this component is the source of truth for its own dock/size/maximized geometry, but
     * shell.css positions `#panel-region` (this component never sets its own position -- see this
     * file's own header) -- so the shell needs to know what that geometry currently is. Called
     * once on mount (the loaded-from-storage value) and again on every change; never read back. */
    ongeometry?: (geometry: PanelGeometry) => void;
  }

  let { id, title, children, ongeometry }: Props = $props();

  const bodyId = $derived(`panel-body-${id}`);
  const titleId = $derived(`panel-title-${id}`);
  let rootEl: HTMLDivElement | undefined;
  let surfaceEl: HTMLElement | undefined = $state();
  let geometry = $state<PanelGeometry>(DEFAULT_PANEL_GEOMETRY);

  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null; // private mode / storage disabled: chrome, not correctness
    }
  }

  onMount(() => {
    geometry = loadPanelGeometry(storage(), id, viewportBucket(window.innerWidth));
    ongeometry?.(geometry);
    // Esc-inside-a-panel is a keyboard shortcut for the whole panel, not a per-element widget
    // interaction, so it is wired imperatively (not a template `onkeydown` on a non-interactive
    // element, which svelte-check's a11y rule flags -- rightly, for the usual case of a fake
    // button, but this really is a root-level shortcut).
    const el = rootEl;
    el?.addEventListener("keydown", handleKeydown);
    // `focusin` on `document`, not `rootEl` -- a WebKit-only escape (see `onFocusEscape`'s own
    // header) lands the NEW focus target OUTSIDE `rootEl` entirely, so listening on `rootEl` itself
    // would never see it bubble (a `focusin` only bubbles up the TARGET's own ancestor chain).
    document.addEventListener("focusin", onFocusEscape);
    return () => {
      el?.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("focusin", onFocusEscape);
    };
  });

  function persist(next: PanelGeometry) {
    geometry = next;
    savePanelGeometry(storage(), id, viewportBucket(window.innerWidth), next);
    ongeometry?.(next);
  }

  async function collapse() {
    persist({ ...geometry, collapsed: true, maximized: false });
    await tick();
    rootEl?.querySelector<HTMLButtonElement>(".panel-pill")?.focus();
  }

  // usability M3: a rail click on a collapsed desktop panel used to do nothing but change the
  // pill's own label -- Shell.svelte's `selectTool()` calls this so a tool switch always shows its
  // panel. No focus move (unlike `restore()`, called from the pill itself): the user's focus
  // stays on the rail button they just activated, matching `armRailFocusRestore`'s own intent.
  // Idempotent -- a no-op when the panel is already open.
  export function expand(): void {
    if (geometry.collapsed) persist({ ...geometry, collapsed: false });
  }

  async function restore() {
    persist({ ...geometry, collapsed: false });
    await tick();
    rootEl?.querySelector<HTMLButtonElement>('[data-panel-control="collapse"]')?.focus();
  }

  function setDock(dock: Dock) {
    persist({ ...geometry, dock, maximized: false });
  }

  async function toggleMaximize() {
    const next = !geometry.maximized;
    persist({ ...geometry, maximized: next });
    if (next) {
      await tick();
      // focus enters the maximized surface (SC 2.4.3) -- the title is the least surprising first
      // stop, matching how a native dialog's showModal() lands focus on the dialog itself when it
      // carries no autofocus control.
      surfaceEl?.focus();
    } else {
      await tick();
      rootEl?.querySelector<HTMLButtonElement>('[data-panel-control="maximize"]')?.focus();
    }
  }

  function setSize(size: number) {
    persist({ ...geometry, size: clampPanelSize(size) });
  }

  // --- resize: drag on the map-facing edge, or arrow keys on the same handle (APG "window
  // splitter" pattern: role="separator", tabindex, aria-value*, arrow-key operable). -------------
  let dragStartPos = 0;
  let dragStartSize = 0;
  let dragging = false;

  function pointerPos(e: PointerEvent): number {
    return geometry.dock === "bottom" ? e.clientY : e.clientX;
  }

  // the sign a drag delta must be multiplied by so that dragging the handle TOWARD the map always
  // grows the panel, regardless of which edge it sits on (left dock: right edge, growing size as
  // the pointer moves right = "+1"; right dock: left edge, growing size as the pointer moves left
  // = "-1"; bottom dock: top edge, growing size as the pointer moves up = "-1").
  function dragSign(): 1 | -1 {
    return geometry.dock === "left" ? 1 : -1;
  }

  function onHandlePointerDown(e: PointerEvent) {
    if (geometry.maximized) return;
    dragging = true;
    dragStartPos = pointerPos(e);
    dragStartSize = geometry.size;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onHandlePointerMove);
    window.addEventListener("pointerup", onHandlePointerUp);
  }

  function onHandlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    const delta = (pointerPos(e) - dragStartPos) * dragSign();
    setSize(dragStartSize + delta);
  }

  function onHandlePointerUp() {
    dragging = false;
    window.removeEventListener("pointermove", onHandlePointerMove);
    window.removeEventListener("pointerup", onHandlePointerUp);
  }

  onMount(() => () => {
    window.removeEventListener("pointermove", onHandlePointerMove);
    window.removeEventListener("pointerup", onHandlePointerUp);
  });

  function onHandleKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? PANEL_RESIZE_STEP_FAST : PANEL_RESIZE_STEP;
    // ArrowRight/ArrowLeft resize a left/right-docked panel; ArrowUp/ArrowDown resize a
    // bottom-docked one -- whichever pair matches this handle's own orientation is a no-op, so
    // both are always wired (a keyboard user need not first learn the dock to guess the pair).
    let delta = 0;
    if (geometry.dock === "bottom") {
      if (e.key === "ArrowUp") delta = step;
      else if (e.key === "ArrowDown") delta = -step;
    } else if (geometry.dock === "left") {
      if (e.key === "ArrowRight") delta = step;
      else if (e.key === "ArrowLeft") delta = -step;
    } else {
      if (e.key === "ArrowLeft") delta = step;
      else if (e.key === "ArrowRight") delta = -step;
    }
    if (delta === 0) return;
    e.preventDefault();
    setSize(geometry.size + delta);
  }

  // R1 "focus trapped in the panel while maximized": the same Tab-cycle trap Modal.svelte's native
  // dialog element gets for free -- a plain section, even one that fills the stage, has no such
  // platform behaviour, so it is hand-rolled here, scoped to `geometry.maximized`.
  const FOCUSABLE_SELECTOR =
    "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), " +
    "textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

  function isVisible(el: HTMLElement): boolean {
    return typeof el.checkVisibility === "function"
      ? el.checkVisibility()
      : el.offsetParent !== null;
  }

  function trapTab(event: KeyboardEvent) {
    if (!geometry.maximized || !surfaceEl) return;
    const focusable = [...surfaceEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
      isVisible,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    // focus starting OUTSIDE the surface (e.g. still on the rail button that opened it) is pulled
    // back in rather than left to escape on the very next Tab.
    const insideSurface = active instanceof Node && surfaceEl.contains(active);
    if (!insideSurface) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    // `active === surfaceEl` itself -- the programmatic focus target on maximize (SC 2.4.3's "the
    // title is the least surprising first stop"), `tabindex="-1"` so it never appears in
    // `focusable` above. `surfaceEl.contains(surfaceEl)` is true (a node contains itself), so this
    // fell through `insideSurface` uncaught -- neither boundary check below ever matches it (it is
    // not `last` NOR `first`), so a Shift+Tab from the very first keypress after maximizing hit no
    // branch at all and fell through to the browser's OWN native focus move, which (WebKit only --
    // Chromium/Firefox happened not to expose this on the same DOM) escaped straight to the rail
    // button that opened the panel. Treat it as its own boundary: always intercepted, wrapping to
    // `last` on Shift+Tab (mirroring "arrived at the end, moving backward") or `first` on Tab.
    if (active === surfaceEl) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }

  // safety net for a WebKit-only quirk `trapTab`'s keydown interception cannot see coming: this
  // panel's own scrollable BODY region is a `tabindex="0"` container (`.panel-body` below, the
  // "scrollable-region-focusable" a11y fix) that also holds many real focusable descendants (a
  // long table's row/sort/filter controls). Chromium/Firefox visit that container in plain DOM
  // order -- BEFORE its descendants, same as `querySelectorAll` -- so it is never `focusable`'s
  // own `last` element and the ordinary boundary check above is enough. WebKit's native forward-
  // tab order instead revisits the SAME container AFTER exhausting its descendants (its own
  // "leaving a scrollable region" stop), which is a real element `trapTab` never predicts as a
  // boundary because it is not array-last -- so a plain Tab from it fell through untouched and
  // native WebKit then moved focus straight out of `surfaceEl` entirely, with no `keydown` this
  // component ever sees again (proven by direct instrumentation: 15 forward Tabs from a real
  // ~50-control maximized table repeated the escape every ~5 presses). Reacting to `focusin`
  // rather than guessing every engine's own boundary geometry ahead of time is the standard
  // focus-trap correction for exactly this class of quirk: whatever focus lands on, if it ends up
  // outside `surfaceEl` while still maximized, snap it back -- to `last` if the escape happened on
  // a backward (Shift+Tab) press, `first` otherwise, mirroring `trapTab`'s own wrap direction.
  function onFocusEscape() {
    if (!geometry.maximized || !surfaceEl) return;
    const active = document.activeElement;
    if (active instanceof Node && surfaceEl.contains(active)) return; // still inside -- nothing to do
    const focusable = [...surfaceEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
      isVisible,
    );
    if (focusable.length === 0) return;
    (lastTabShiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
  }

  // the innermost open layer handles Esc first: if some other open layer (a Select, a Popover)
  // already handled this SAME keydown and called preventDefault() on it, this panel must not
  // ALSO react to it. Esc means "back off one level": restore from maximized, else collapse.
  // last Tab keydown's direction, read by `onFocusEscape` below (a `focusin` fires with no
  // shiftKey of its own to consult).
  let lastTabShiftKey = false;

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Tab") {
      lastTabShiftKey = event.shiftKey;
      trapTab(event);
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented || geometry.collapsed) return;
    event.preventDefault();
    if (geometry.maximized) toggleMaximize();
    else collapse();
  }
</script>

<div
  class="panel"
  class:panel--collapsed={geometry.collapsed}
  class:panel--maximized={geometry.maximized}
  data-dock={geometry.dock}
  bind:this={rootEl}
>
  {#if geometry.collapsed}
    <Pill label={title} expanded={false} controls={bodyId} onclick={restore} class="panel-pill" />
  {:else}
    <section
      class="panel-surface"
      class:panel-surface--maximized={geometry.maximized}
      data-dock={geometry.dock}
      aria-labelledby={titleId}
      bind:this={surfaceEl}
      tabindex="-1"
    >
      {#if !geometry.maximized}
        <!-- the APG "window splitter" pattern: role=separator, tabindex, aria-value*, arrow-key
             operable -- a legitimate custom widget, not a plain div a11y's rule assumes it is. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="resize-handle"
          role="separator"
          aria-label="Resize panel"
          aria-orientation={geometry.dock === "bottom" ? "horizontal" : "vertical"}
          aria-valuenow={geometry.size}
          aria-valuemin={PANEL_SIZE_MIN}
          aria-valuemax={PANEL_SIZE_MAX}
          aria-controls={bodyId}
          tabindex="0"
          onpointerdown={onHandlePointerDown}
          onkeydown={onHandleKeydown}
        ></div>
      {/if}
      <div class="panel-head">
        <h2 class="panel-title" id={titleId}>{title}</h2>
        <div class="panel-controls" role="group" aria-label="Panel position and size">
          <button
            type="button"
            aria-pressed={geometry.dock === "left"}
            aria-label="Dock left"
            disabled={geometry.maximized}
            onclick={() => setDock("left")}
          >
            <Icon name="dockLeft" size={18} />
          </button>
          <button
            type="button"
            aria-pressed={geometry.dock === "bottom"}
            aria-label="Dock bottom"
            disabled={geometry.maximized}
            onclick={() => setDock("bottom")}
          >
            <Icon name="dockBottom" size={18} />
          </button>
          <button
            type="button"
            aria-pressed={geometry.dock === "right"}
            aria-label="Dock right"
            disabled={geometry.maximized}
            onclick={() => setDock("right")}
          >
            <Icon name="dockRight" size={18} />
          </button>
          <button
            type="button"
            data-panel-control="maximize"
            aria-pressed={geometry.maximized}
            aria-label={geometry.maximized ? "Restore" : "Full screen"}
            onclick={toggleMaximize}
          >
            <Icon name={geometry.maximized ? "restore" : "maximize"} size={18} />
          </button>
          <button
            type="button"
            data-panel-control="collapse"
            aria-expanded="true"
            aria-controls={bodyId}
            aria-label="Collapse to a pill"
            onclick={collapse}
          >
            <Icon name="collapseSide" size={18} />
          </button>
        </div>
      </div>
      <!-- atlas-8 fix: this used to ALSO be given the region landmark role plus its own aria-label
           -- a second landmark nested directly inside the section element above, which is already
           the panel's ONE region (named by the h2 via aria-labelledby). Two nested regions with
           near-duplicate names ("Layers" / "Layers details") is worse for a screen-reader user
           than one, so this is a plain `group` (NOT a landmark role -- `group` is never one),
           still reachable by keyboard (tabindex, the scrollable-region-focusable fix Sheet.svelte's
           own body carries; svelte-check's a11y rule does not know that exception).

           fix list #7 (SC 4.1.2): that earlier fix dropped the name along with the landmark --
           `tabindex="0"` with no role and no accessible name at all, a tab stop a screen reader
           announces as nothing (KNOWN_UNNAMED_STOPS in e2e/keyboard-walk.spec.ts, finding A11Y-7).
           `role="group"` + `aria-label` restores a name WITHOUT reintroducing the landmark this
           file's own atlas-8 fix removed -- exactly Sheet.svelte's `.sheet-body` pattern
           (`region "{title} details"`), just with `group` in place of `region`. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="panel-body"
        id={bodyId}
        role="group"
        aria-label={`${title} details`}
        class:panel-body--maximized={geometry.maximized}
        tabindex="0"
      >
        {@render children()}
      </div>
    </section>
  {/if}
</div>
{#if geometry.maximized}
  <!-- backdrop only, for a clear affordance that the stage is temporarily all-panel; the map stays
       mounted underneath (docs/map.md: a lens' composeStyle inputs are a lens-level store, never
       gated on whether the panel/sheet happens to be mounted) -- clicking it restores, same as Esc. -->
  <div class="panel-backdrop" onclick={toggleMaximize} aria-hidden="true"></div>
{/if}

<style>
  .panel {
    /* SC 1.4.10 (Reflow): --size-panel (380px) as a fixed width overflowed the viewport at 320px
       CSS width -- max plus 100% lets it shrink on a narrower viewport instead of forcing
       horizontal scroll. 720px (not --size-panel/380): R1's widest dock, PANEL_SIZE_MAX
       (panelGeometry.ts) -- this component is also used with NO `#panel-region` ancestor at all
       (the gallery, src/gallery/sections/Panel.svelte), where `height: 100%` below resolves to
       `auto` (percentage heights never resolve against an auto-height containing block, and the
       gallery's own `.stage` is exactly that) -- so this ceiling is what keeps a resized/dragged
       demo panel from growing unbounded there, the same job --size-panel's ceiling used to do. */
    width: 100%;
    max-width: 720px;
    /* the real app shell's `#panel-region` has a DEFINITE height (top+bottom, both set -- shell.
       css) so this resolves there; the gallery's ancestor does not, so this is simply `auto` there
       (see above) -- either way `.panel-surface`'s own `height: 100%` needs SOMETHING definite to
       resolve against, which is what this supplies when one exists. */
    height: 100%;
  }

  /* V1 fix (Opus eyes-on review, 2026-09-24): "desktop Full screen panel is capped at 720px" --
     `#panel-region[data-maximized="true"]` (shell.css) already spans the whole stage edge to edge,
     but THIS element's own 720px ceiling (above, R1's docked-width cap) still applied on top of
     it, so a maximized panel's content box stayed 720px wide inside a full-stage frame. Lifting
     the cap only while maximized keeps the 720px docked/half-width ceiling intact (this rule does
     not touch `.panel--collapsed`, which sets its own `width: fit-content`). */
  .panel--maximized {
    max-width: none;
  }

  /* usability M3: collapsed, `.panel` held its FULL width basis (`.panel-region`'s own width,
     shell.css) with the pill left-aligned inside it -- since `.panel-region` is docked at the
     STAGE's right edge, the pill floated near the LEFT edge of that reserved width, mid-top
     (observed: x≈888 of a 1280px viewport), not at the panel's own edge. Shrinking to the pill's
     own content width and pushing it flush right (the side `.panel-region` docks to) puts it where
     a "collapsed to an edge pill" affordance should read: right at the stage's edge. `height:
     fit-content` (not the 100% above): a collapsed panel is a small pill, not a tall invisible box
     that would otherwise sit over the map for the panel's full docked height and steal its clicks. */
  .panel--collapsed {
    width: fit-content;
    height: fit-content;
    margin-left: auto;
  }

  /* dock=left: `.panel-region` is anchored to the STAGE's left edge, so the pill flushes left
     instead (mirrors the default's flush-right, above -- the `margin-left: auto` on dock=right/
     bottom pushes the pill to whichever side the region's own outer edge is on). */
  .panel--collapsed[data-dock="left"] {
    margin-left: 0;
    margin-right: auto;
  }

  .panel-surface {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: color-mix(in srgb, var(--surface-panel) var(--glass-opacity), transparent);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--elev-3);
    overflow: hidden;
  }

  .panel-surface:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* R1 maximize: the panel fills the whole stage. shell.css positions `.panel-region` itself
     (dock/size); this rule only needs to override the CONTENT box, since `.panel-region` already
     switches to `inset: 0` at this state (see shell.css's own `[data-maximized]` rule).
     `z-index: 31` (U1 fix round, CI run 35956406448 on 0.10.39): shell.css's `#panel-region
     [data-maximized="true"]` z-index (40) only orders `#panel-region` against ITS OWN SIBLINGS
     (the rail region, the legend-chip region) -- it does nothing for the stacking order BETWEEN
     `.panel-surface` and `.panel-backdrop` below, which are both `#panel-region`'s own CHILDREN,
     compared in their OWN local stacking context. `.panel-backdrop` carries an explicit z-index
     (30); `.panel-surface` did not, so its effective z-index was `auto` -- and an explicit
     z-index beats `auto` regardless of DOM order, so the backdrop painted (and intercepted
     clicks) OVER the panel's own header controls the whole time this comment claimed the
     opposite. Caught by e2e/shell.url-state.spec.ts's interaction walk: `locator.click` on
     "Restore" timed out with "panel-backdrop intercepts pointer events", on three engines. */
  .panel-surface--maximized {
    border-radius: 0;
    z-index: 31;
  }

  .panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    background: var(--scrim);
    opacity: 0.4;
  }

  /* the resize handle sits ON the panel's map-facing edge -- shell.css decides WHICH edge (`[data-
     dock]` on `.panel-region`) by placing this element via `inset`; here it only sizes/cursors
     itself, per this file's own "components size only themselves" convention. */
  .resize-handle {
    position: absolute;
    z-index: 2;
    /* SC 2.5.5: a coarse-pointer target is widened by shell.css's own media query below; this
       base size is the desktop (fine-pointer) one. */
    touch-action: none;
  }

  .resize-handle:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  [data-dock="left"] .resize-handle,
  [data-dock="right"] .resize-handle {
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  [data-dock="left"] .resize-handle {
    right: -3px;
  }
  [data-dock="right"] .resize-handle {
    left: -3px;
  }
  [data-dock="bottom"] .resize-handle {
    left: 0;
    right: 0;
    top: -3px;
    height: 6px;
    cursor: ns-resize;
  }

  @media (pointer: coarse) {
    [data-dock="left"] .resize-handle,
    [data-dock="right"] .resize-handle {
      width: var(--size-touch);
    }
    [data-dock="left"] .resize-handle {
      right: calc(var(--size-touch) / -2);
    }
    [data-dock="right"] .resize-handle {
      left: calc(var(--size-touch) / -2);
    }
    [data-dock="bottom"] .resize-handle {
      height: var(--size-touch);
      top: calc(var(--size-touch) / -2);
    }
  }

  .panel-head {
    position: relative;
    /* 188px: 5 controls (32px + var(--space-1)/4px gap each = 176px) plus the group's own `right:
       var(--space-2)`/8px offset, plus a small buffer -- the same margin the old 3-control 116px
       reservation kept (112px used, +4px buffer). index.html/shell.css's `.sk-panel-head` mirrors
       this number for the CLS gate. */
    padding: var(--space-3) 188px var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--divider);
    flex: none;
  }

  .panel-head::before {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--motif-color);
    opacity: var(--motif-hex-opacity);
    -webkit-mask: url("../brand/motifs/hex.svg") repeat center / var(--motif-hex-size);
    mask: url("../brand/motifs/hex.svg") repeat center / var(--motif-hex-size);
    pointer-events: none;
  }

  .panel-title {
    position: relative;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-display);
    margin: 0;
  }

  .panel-controls {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    gap: var(--space-1);
  }

  .panel-controls button {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .panel-controls button:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  .panel-controls button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .panel-controls button:disabled {
    color: var(--icon-inactive);
    cursor: not-allowed;
  }

  /* SC 1.4.1: aria-expanded="true" is NOT in this selector -- the collapse control (Panel.svelte's
     own header button, above) is always expanded whenever these controls are visible at all, so
     matching on it here painted collapse as if it were the currently-selected dock/maximize state
     permanently, with no relation to which is actually active (atlas-3 closing review, item 1). */
  .panel-controls button[aria-pressed="true"] {
    color: var(--text-primary);
    border-color: var(--border-control);
    background: var(--fill-control);
  }

  @media (pointer: coarse) {
    .panel-controls button {
      width: var(--size-touch);
      height: var(--size-touch);
    }
  }

  .panel-body {
    flex: 1;
    overflow: auto;
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  /* usability M6: "wide content (the zones table) must be usable at the widest dock and in
     maximize" -- the body scrolls the full height of whatever the surface actually is (the
     `max-height: 60vh` the old "half" detent needed no longer applies at all: height now comes
     from the dock/size shell.css sets on `.panel-region`, and `.panel-surface` is `height: 100%`
     of that). Kept as its own class (rather than deleting the rule entirely) so a future detent
     mode has somewhere to hang a height override again without re-deriving this. */
  .panel-body--maximized {
    max-height: none;
  }
</style>
