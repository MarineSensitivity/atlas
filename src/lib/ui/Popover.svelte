<script lang="ts">
  // atlas-3 spec.md "Panels": "an ⓘ opens a two-sentence popover whose 'More' opens a modal."
  // This component owns only the popover itself (trigger + floating content, dismiss on outside
  // click or Esc, focus returns to the trigger on close); composing its content with a "More"
  // button that opens a Modal is the caller's job (see the gallery section).
  import { onMount, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    /** the trigger's accessible name, e.g. "About the ER-score rule" */
    label: string;
    children: Snippet;
  }

  let { label, children }: Props = $props();
  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined;
  let popoverEl: HTMLDivElement | undefined = $state();
  const popoverId = $derived(`popover-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);

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

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  onMount(() => {
    document.addEventListener("pointerdown", handleDocumentPointerdown);
    document.addEventListener("keydown", handleDocumentKeydown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerdown);
      document.removeEventListener("keydown", handleDocumentKeydown);
    };
  });
</script>

<span class="popover-wrap">
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
  {#if open}
    <div class="popover" id={popoverId} bind:this={popoverEl}>
      {@render children()}
    </div>
  {/if}
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
