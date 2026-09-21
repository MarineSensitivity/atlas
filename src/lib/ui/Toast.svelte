<script lang="ts" module>
  let nextId = 0;
</script>

<script lang="ts">
  // atlas-3 step 4 fix round 1 (SC 4.1.3 / 2.2.1): renders the VISIBLE toast bubbles only -- the
  // actual screen-reader announcement goes through the ONE shared live region
  // (src/lib/ui/announcer.ts's announce(), see Announcer.svelte), not a role="status" here. An
  // auto-dismiss timer pauses on hover OR focus (of any element inside it, via focusin/focusout,
  // which bubble) and resumes with whatever time was actually left -- a user reading a toast when
  // it would otherwise vanish must not lose it to a fixed 5s clock they cannot stop.
  import { announce } from "./announcer";
  import Icon from "./Icon.svelte";
  import { dismissToast, enqueueToast, remainingMs, type ToastMessage } from "./toastQueue";

  const AUTO_DISMISS_MS = 5000;
  let queue = $state<ToastMessage[]>([]);

  interface Timer {
    remaining: number;
    startedAt: number;
    handle: ReturnType<typeof setTimeout> | null;
  }

  // a plain Map, not SvelteMap: this is internal timer bookkeeping only, never read from the
  // template or a $derived -- `queue` (a real $state) is what drives every re-render.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const timers = new Map<number, Timer>();

  function scheduleDismiss(id: number, ms: number) {
    const handle = setTimeout(() => dismiss(id), ms);
    timers.set(id, { remaining: ms, startedAt: Date.now(), handle });
  }

  function pause(id: number) {
    const t = timers.get(id);
    if (!t || t.handle === null) return;
    clearTimeout(t.handle);
    timers.set(id, {
      remaining: remainingMs(t.remaining, Date.now() - t.startedAt),
      startedAt: 0,
      handle: null,
    });
  }

  function resume(id: number) {
    const t = timers.get(id);
    if (!t || t.handle !== null) return;
    scheduleDismiss(id, t.remaining);
  }

  /** queues a message (announced through the shared live region); it disappears on its own
   * after AUTO_DISMISS_MS -- paused while hovered or focused -- or an explicit dismiss. */
  export function push(text: string): void {
    const id = nextId++;
    queue = enqueueToast(queue, id, text);
    announce(text);
    scheduleDismiss(id, AUTO_DISMISS_MS);
  }

  function dismiss(id: number) {
    const t = timers.get(id);
    if (t?.handle !== null) clearTimeout(t?.handle);
    timers.delete(id);
    queue = dismissToast(queue, id);
  }
</script>

<div class="toast-region">
  {#each queue as t (t.id)}
    <div
      class="toast"
      role="group"
      aria-label={t.text}
      onmouseenter={() => pause(t.id)}
      onmouseleave={() => resume(t.id)}
      onfocusin={() => pause(t.id)}
      onfocusout={() => resume(t.id)}
    >
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
