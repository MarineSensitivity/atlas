<script lang="ts">
  // atlas-3 spec.md §5.3/§10/§5.4: the phone bottom sheet -- peek / half / full, a wave top edge,
  // a grab handle, and the SAME three header controls as a desktop Panel (spec.md §5.3), sized for
  // touch. Unlike Panel, collapsing to peek does not swap the sheet for a different component: the
  // header (grab handle, title, the three controls) stays visible at every detent, so "collapse"
  // here is itself one of the three detents, not a disclosure to something else.
  import { onMount, tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import {
    DEFAULT_SHEET_DETENT,
    loadSheetDetent,
    saveSheetDetent,
    type SheetDetent,
  } from "./sheetGeometry";

  interface Props {
    /** used for the localStorage key and the body's element id */
    id: string;
    title: string;
    children: Snippet;
  }

  let { id, title, children }: Props = $props();

  const bodyId = $derived(`sheet-body-${id}`);
  const titleId = $derived(`sheet-title-${id}`);
  let detent = $state<SheetDetent>(DEFAULT_SHEET_DETENT);
  let rootEl: HTMLElement | undefined;

  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  onMount(() => {
    detent = loadSheetDetent(storage(), id);
    // Esc-inside-the-sheet-collapses-it is a keyboard shortcut for the whole sheet, wired
    // imperatively for the same reason Panel.svelte's identical handler is (a template
    // `onkeydown` on this non-interactive element trips svelte-check's a11y rule).
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && detent !== "peek") {
        event.preventDefault();
        collapseToPeek();
      }
    };
    rootEl?.addEventListener("keydown", handleKeydown);
    return () => rootEl?.removeEventListener("keydown", handleKeydown);
  });

  function setDetent(next: SheetDetent) {
    detent = next;
    saveSheetDetent(storage(), id, next);
  }

  // SC 2.4.3 (Focus Order): moves focus to the collapse control itself before/after the detent
  // changes -- without this, Esc left focus on whatever had it inside the now-hidden body (peek
  // hides .sheet-body via `display: none`), which strands it on an element no longer in the
  // accessibility tree, and the next Tab press starts from nowhere predictable. Mirrors
  // Panel.svelte's collapse() moving focus to its own control 1.
  async function collapseToPeek() {
    setDetent("peek");
    await tick();
    rootEl?.querySelector<HTMLButtonElement>('[data-sheet-control="collapse"]')?.focus();
  }
</script>

<section class="sheet detent-{detent}" aria-labelledby={titleId} bind:this={rootEl}>
  <div class="sheet-grab" role="separator" aria-label="Drag to resize the sheet"></div>
  <div class="sheet-head">
    <h2 class="sheet-title" id={titleId}>{title}</h2>
    <div class="panel-controls" role="group" aria-label="Sheet size">
      <button
        type="button"
        data-sheet-control="collapse"
        aria-expanded={detent !== "peek"}
        aria-controls={bodyId}
        aria-label="Collapse to a peek"
        onclick={collapseToPeek}
      >
        <Icon name="collapseDown" size={18} />
      </button>
      <button
        type="button"
        aria-pressed={detent === "half"}
        aria-label="Half height"
        onclick={() => setDetent("half")}
      >
        <Icon name="dockBottom" size={18} />
      </button>
      <button
        type="button"
        aria-pressed={detent === "full"}
        aria-label="Full height"
        onclick={() => setDetent("full")}
      >
        <Icon name="expand" size={18} />
      </button>
    </div>
  </div>
  <!-- tabindex="0": a scrollable region with no focusable child of its own must still be
       reachable by keyboard (axe scrollable-region-focusable); svelte-check's own a11y rule does
       not know that exception, hence the ignore below (spec.md §10 asks for exactly this). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="sheet-body" id={bodyId} role="region" aria-label="{title} details" tabindex="0">
    {@render children()}
  </div>
</section>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-control);
    border-radius: var(--radius-card) var(--radius-card) 0 0;
    background: color-mix(in srgb, var(--surface-panel) var(--glass-opacity), transparent);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--elev-3);
    overflow: hidden;
    position: relative;
    height: var(--size-sheet-half);
  }

  .sheet.detent-peek {
    height: var(--size-sheet-peek);
  }

  .sheet.detent-full {
    height: 92svh;
  }

  /* the sheet's upper edge is the wave (guide p. 10) */
  .sheet::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: var(--motif-wave-height);
    background: var(--motif-color);
    opacity: var(--motif-wave-opacity);
    -webkit-mask: url("../brand/motifs/wave.svg") repeat-x center / auto 100%;
    mask: url("../brand/motifs/wave.svg") repeat-x center / auto 100%;
    transform: scaleY(-1);
    pointer-events: none;
  }

  .sheet-grab {
    width: 44px;
    height: 4px;
    margin: var(--space-3) auto var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--border-control);
    flex: none;
  }

  .sheet-head {
    position: relative;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-2);
    flex: none;
  }

  .sheet-title {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-display);
    margin: 0;
  }

  .panel-controls {
    display: flex;
    gap: var(--space-1);
    margin-left: auto;
  }

  .panel-controls button {
    display: inline-grid;
    place-items: center;
    width: var(--size-touch);
    height: var(--size-touch);
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

  .panel-controls button[aria-pressed="true"],
  .panel-controls button[aria-expanded="true"] {
    color: var(--text-primary);
    border-color: var(--border-control);
    background: var(--fill-control);
  }

  .sheet-body {
    flex: 1;
    overflow: auto;
    padding: 0 var(--space-4) var(--space-4);
  }

  .sheet-body:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .detent-peek .sheet-body {
    display: none;
  }
</style>
