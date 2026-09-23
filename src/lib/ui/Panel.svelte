<script lang="ts">
  // atlas-3 spec.md §5.3: every floating panel carries collapse · half · full in its upper right,
  // in that order, role="group" aria-label="Panel size". Collapsing swaps the whole panel for a
  // labelled Pill (a disclosure: aria-expanded="false" + aria-controls, never removed from the
  // DOM's semantic reach); Esc inside a panel is the same action as pressing control 1. Geometry
  // (collapsed + half/full) is chrome, remembered per viewport size in localStorage
  // (src/lib/ui/panelGeometry.ts), never the URL.
  import { onMount, tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import Pill from "./Pill.svelte";
  import {
    DEFAULT_PANEL_GEOMETRY,
    loadPanelGeometry,
    savePanelGeometry,
    viewportBucket,
    type Detent,
    type PanelGeometry,
  } from "./panelGeometry";

  interface Props {
    /** used for the localStorage key and the body's element id (the collapse control's
     * aria-controls target) -- must be unique among panels on the page */
    id: string;
    title: string;
    children: Snippet;
  }

  let { id, title, children }: Props = $props();

  const bodyId = $derived(`panel-body-${id}`);
  const titleId = $derived(`panel-title-${id}`);
  let rootEl: HTMLDivElement | undefined;
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
    // Esc-inside-a-panel-collapses-it is a keyboard shortcut for the whole panel, not a
    // per-element widget interaction, so it is wired imperatively (not a template `onkeydown`
    // on a non-interactive element, which svelte-check's a11y rule flags -- rightly, for the
    // usual case of a fake button, but this really is a root-level shortcut).
    const el = rootEl;
    el?.addEventListener("keydown", handleKeydown);
    return () => el?.removeEventListener("keydown", handleKeydown);
  });

  function persist(next: PanelGeometry) {
    geometry = next;
    savePanelGeometry(storage(), id, viewportBucket(window.innerWidth), next);
  }

  async function collapse() {
    persist({ ...geometry, collapsed: true });
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

  function setDetent(detent: Detent) {
    persist({ ...geometry, detent });
  }

  // the innermost open layer handles Esc first: if some other open layer (a Select, a Popover)
  // already handled this SAME keydown and called preventDefault() on it, this panel must not
  // ALSO react to it and collapse underneath whatever the user actually meant to close.
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && !event.defaultPrevented && !geometry.collapsed) {
      event.preventDefault();
      collapse();
    }
  }
</script>

<div class="panel" class:panel--collapsed={geometry.collapsed} bind:this={rootEl}>
  {#if geometry.collapsed}
    <Pill label={title} expanded={false} controls={bodyId} onclick={restore} class="panel-pill" />
  {:else}
    <section class="panel-surface" aria-labelledby={titleId}>
      <div class="panel-head">
        <h2 class="panel-title" id={titleId}>{title}</h2>
        <div class="panel-controls" role="group" aria-label="Panel size">
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
          <button
            type="button"
            aria-pressed={geometry.detent === "half"}
            aria-label="Half height"
            onclick={() => setDetent("half")}
          >
            <Icon name="dockRight" size={18} />
          </button>
          <button
            type="button"
            aria-pressed={geometry.detent === "full"}
            aria-label="Full height"
            onclick={() => setDetent("full")}
          >
            <Icon name="expand" size={18} />
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
        class:panel-body--full={geometry.detent === "full"}
        tabindex="0"
      >
        {@render children()}
      </div>
    </section>
  {/if}
</div>

<style>
  .panel {
    /* SC 1.4.10 (Reflow): --size-panel (380px) as a fixed width overflowed the viewport at 320px
       CSS width -- max plus 100% lets it shrink on a narrow viewport instead of forcing
       horizontal scroll. */
    width: 100%;
    max-width: var(--size-panel);
  }

  /* usability M3: collapsed, `.panel` held its FULL 380px basis (`.panel-region`'s own width,
     shell.css) with the pill left-aligned inside it -- since `.panel-region` is docked at the
     STAGE's right edge, the pill floated near the LEFT edge of that reserved width, mid-top
     (observed: x≈888 of a 1280px viewport), not at the panel's own edge. Shrinking to the pill's
     own content width and pushing it flush right (the side `.panel-region` docks to) puts it where
     a "collapsed to an edge pill" affordance should read: right at the stage's edge. */
  .panel--collapsed {
    width: fit-content;
    margin-left: auto;
  }

  .panel-surface {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: color-mix(in srgb, var(--surface-panel) var(--glass-opacity), transparent);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--elev-3);
    overflow: hidden;
  }

  .panel-head {
    position: relative;
    padding: var(--space-3) 116px var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--divider);
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

  /* SC 1.4.1: aria-expanded="true" is NOT in this selector -- the collapse control (Panel.svelte's
     own header button, above) is always expanded whenever these controls are visible at all, so
     matching on it here painted collapse as if it were the currently-selected detent permanently,
     with no relation to which of Half/Full is actually active (atlas-3 closing review, item 1). */
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
    max-height: 60vh;
  }

  .panel-body--full {
    max-height: none;
  }
</style>
