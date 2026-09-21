<script lang="ts">
  // atlas-3: focus trap and focus return, Esc closes the top layer -- all three come from the
  // native <dialog> element's showModal(), which the HTML spec requires browsers to implement
  // (top-layer focus containment, Escape fires 'cancel' then 'close', and closing restores focus
  // to whatever had it before showModal() was called). Hand-rolling any of that would only
  // reproduce what the platform already guarantees, less reliably.
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    open: boolean;
    title: string;
    children: Snippet;
    /** fired when the dialog closes for ANY reason (the close button, Esc, or a caller-driven
     * `open = false`) -- the caller is expected to set its own `open` state to false here, so a
     * `<dialog>` closed by the platform (Esc) and one closed by the caller stay in sync. */
    onclose?: () => void;
  }

  let { open, title, children, onclose }: Props = $props();
  let dialogEl: HTMLDialogElement | undefined;
  const titleId = $derived(`modal-title-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) dialogEl.showModal();
    if (!open && dialogEl.open) dialogEl.close();
  });
</script>

<dialog bind:this={dialogEl} aria-labelledby={titleId} onclose={() => onclose?.()}>
  <div class="modal-head">
    <h2 id={titleId}>{title}</h2>
    <button type="button" class="modal-close" aria-label="Close" onclick={() => dialogEl?.close()}>
      <Icon name="close" size={18} />
    </button>
  </div>
  <div class="modal-body">
    {@render children()}
  </div>
</dialog>

<style>
  dialog {
    max-width: min(560px, calc(100vw - var(--space-6)));
    max-height: calc(100vh - var(--space-6));
    padding: 0;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    color: var(--text-primary);
    box-shadow: var(--elev-3);
  }

  dialog::backdrop {
    background: var(--scrim);
    opacity: 0.6;
  }

  .modal-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    border-bottom: 1px solid var(--divider);
  }

  .modal-head h2 {
    flex: 1;
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    letter-spacing: var(--tracking-display);
  }

  .modal-close {
    display: inline-grid;
    place-items: center;
    width: var(--size-touch);
    height: var(--size-touch);
    flex: none;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .modal-close:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  .modal-close:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .modal-body {
    padding: var(--space-4);
    overflow: auto;
    font-size: var(--text-md);
    line-height: var(--leading-normal);
  }
</style>
