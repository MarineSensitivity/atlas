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
  }

  let {
    label,
    children,
    trigger,
    triggerClass,
    align = "left",
    open = $bindable(false),
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
    class:popover-trigger--custom={!!trigger}
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
    id={popoverId}
    bind:this={popoverEl}
    hidden={!open}
  >
    {@render children()}
  </div>
</span>

<style>
  .popover-wrap {
    position: relative;
    display: inline-block;
  }

  .popover-trigger {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
  }

  .popover-trigger:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .popover-trigger[aria-expanded="true"] {
    color: var(--text-primary);
    border-color: var(--text-primary);
  }

  /* a custom trigger (opacity %, ramp strip + name) is content-sized, not the default 18px round
     icon button -- the caller's own `triggerClass` sets width/height/padding; this only drops the
     fixed circle so those rules aren't fighting a 18x18 box. */
  .popover-trigger--custom {
    width: auto;
    height: auto;
    border-radius: var(--radius-control);
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
  }

  .popover--right {
    left: auto;
    right: 0;
  }
</style>
