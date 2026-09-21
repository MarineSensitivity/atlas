<script lang="ts">
  import Modal from "../../lib/ui/Modal.svelte";

  let open = $state(false);
</script>

<button type="button" class="btn" onclick={() => (open = true)}>Open a modal</button>

<Modal {open} title="The ER-score rule" onclose={() => (open = false)}>
  <p>
    A modal traps focus inside itself (Tab cycles only through its own controls) and returns focus
    to whatever opened it when it closes -- both come from the native
    <code>&lt;dialog&gt;</code> element's <code>showModal()</code>, not hand-rolled JS.
  </p>
  <p>
    Press <kbd>Esc</kbd>, or use the close button, to see the opening button get focus back.
  </p>
  <button type="button" class="btn" onclick={() => (open = false)}>Also closes it</button>
</Modal>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    height: var(--size-touch);
    padding: 0 var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  p {
    margin: 0 0 var(--space-3);
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  kbd {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: 0 var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }
</style>
