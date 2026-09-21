<script lang="ts" module>
  let nextId = 0;
</script>

<script lang="ts">
  // atlas-3: ONE polite live region announces async results ("Species table loaded, 1,234 rows")
  // AND an inactive control's reason when it is activated (spec.md §5.2/§11). One instance of
  // this component lives in the shell; callers hold a reference (bind:this) and call `push()`.
  import Icon from "./Icon.svelte";
  import { dismissToast, enqueueToast, type ToastMessage } from "./toastQueue";

  const AUTO_DISMISS_MS = 5000;
  let queue = $state<ToastMessage[]>([]);

  /** queues a message; it disappears on its own after AUTO_DISMISS_MS or an explicit dismiss */
  export function push(text: string): void {
    const id = nextId++;
    queue = enqueueToast(queue, id, text);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }

  function dismiss(id: number) {
    queue = dismissToast(queue, id);
  }
</script>

<div class="toast-region" role="status" aria-live="polite">
  {#each queue as t (t.id)}
    <div class="toast">
      <span>{t.text}</span>
      <button
        type="button"
        class="toast-dismiss"
        aria-label="Dismiss"
        onclick={() => dismiss(t.id)}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-region {
    position: fixed;
    left: 50%;
    bottom: var(--space-5);
    transform: translateX(-50%);
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-size: var(--text-sm);
    box-shadow: var(--elev-3);
    pointer-events: auto;
  }

  .toast-dismiss {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .toast-dismiss:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  .toast-dismiss:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
