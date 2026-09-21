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
  }

  let { label, children }: Props = $props();
  let open = $state(false);
  let wrapEl: HTMLSpanElement | undefined;
  let triggerEl: HTMLButtonElement | undefined;
  let popoverEl: HTMLDivElement | undefined = $state();
  // per-INSTANCE, not per-label (SC 4.1.2) -- see HexButton.svelte's identical fix.
  const popoverId = uid("popover");

  function close() {
    if (!open) return;
    open = false;
    triggerEl?.focus();
  }

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
    class="popover-trigger"
    bind:this={triggerEl}
    aria-expanded={open}
    aria-controls={popoverId}
    aria-label={label}
    onclick={() => (open = !open)}
  >
    <Icon name="info" size={16} />
  </button>
  <!-- always rendered (never {#if open}), toggled with `hidden` -- aria-controls (on the trigger
       above) must reference an element that actually EXISTS in the DOM (SC 4.1.2); see
       Accordion.svelte's identical fix for the same reason. -->
  <div class="popover" id={popoverId} bind:this={popoverEl} hidden={!open}>
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
</style>
