<script lang="ts">
  // atlas-3: focus trap and focus return, Esc closes the top layer -- all three come from the
  // native <dialog> element's showModal(), which the HTML spec requires browsers to implement
  // (top-layer focus containment, Escape fires 'cancel' then 'close', and closing restores focus
  // to whatever had it before showModal() was called). Hand-rolling any of that would only
  // reproduce what the platform already guarantees, less reliably.
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { uid } from "./uid";

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
  // per-INSTANCE, not per-title (SC 4.1.2) -- see HexButton.svelte's identical fix.
  const titleId = uid("modal-title");

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) dialogEl.showModal();
    if (!open && dialogEl.open) dialogEl.close();
  });

  const FOCUSABLE_SELECTOR =
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

  // Belt-and-suspenders on top of the platform's own containment: measured in Chromium, a
  // <dialog> with only a couple of focusable children can let a Tab cycle land outside it (focus
  // falls through to <body>) for one step instead of wrapping straight back inside. Trap Tab at
  // the dialog's own first/last focusable element explicitly, so the browser's default handling
  // for the boundary case never runs at all.
  function handleDialogKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      // the innermost open layer handles Esc first: if this modal is ever rendered nested inside
      // a Panel's DOM subtree, the raw keydown would otherwise keep bubbling past the dialog (the
      // browser's own Escape-closes-the-dialog default action does not stop propagation) and also
      // collapse the enclosing panel.
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab" || !dialogEl) return;
    const focusable = [...dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  aria-labelledby={titleId}
  onclose={() => onclose?.()}
  onkeydown={handleDialogKeydown}
>
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
