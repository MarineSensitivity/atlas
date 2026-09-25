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
  //
  // UI-1 (round 3): this instance now ALSO subscribes to `toastQueue.ts#subscribeToastPush` on
  // mount, so `announcer.ts#notify()` reaches it without any caller needing a `bind:this` handle
  // (the gallery's own demo, `sections/Toast.svelte`, keeps using `bind:this` + `push()` directly
  // -- both paths funnel through the SAME internal `pushInternal()`).
  import { onMount } from "svelte";
  import { announce } from "./announcer";
  import Icon from "./Icon.svelte";
  import {
    dismissToast,
    enqueueToast,
    remainingMs,
    subscribeToastPush,
    type ToastMessage,
    type ToastTone,
  } from "./toastQueue";

  interface Props {
    /** UI-1 (round 3): the phone bottom offset the mounting page wants (Shell.svelte -- "the
     * toast must never cover the phone sheet's buttons or the legend chip") -- set as an inline
     * style directly on THIS component's own root (never a wrapping `<div>`: an extra static block
     * element ahead of the top bar, even one whose own child is `position: fixed`, intercepted
     * pointer events across the WHOLE page in testing -- Playwright's `elementFromPoint` resolved
     * to `#shell.app` itself at coordinates nowhere near any toast). `undefined` (the default,
     * every mount besides Shell.svelte's phone case) leaves the plain `--space-5` CSS fallback. */
    phoneBottomOffsetPx?: number;
  }

  let { phoneBottomOffsetPx }: Props = $props();

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

  /** enqueues the bubble + schedules its auto-dismiss -- never announces (the caller already did,
   * or is about to): `push()` below announces for its own direct callers (the gallery's
   * `bind:this`); the bus subscription (onMount, below) does not, because `notify()`
   * (announcer.ts) already called `announce()` itself before `pushToast()` ever reaches here --
   * calling it again here would double-announce every app-wide `notify()`. */
  function pushInternal(text: string, tone?: ToastTone): void {
    const id = nextId++;
    queue = enqueueToast(queue, id, text, tone);
    scheduleDismiss(id, AUTO_DISMISS_MS);
  }

  /** queues a message (announced through the shared live region); it disappears on its own
   * after AUTO_DISMISS_MS -- paused while hovered or focused -- or an explicit dismiss. Kept for
   * the gallery's own `bind:this` demo; an app-wide caller should use `announcer.ts#notify()`
   * instead (it reaches this instance without needing a component reference at all). */
  export function push(text: string): void {
    pushInternal(text);
    announce(text);
  }

  onMount(() => subscribeToastPush((text, tone) => pushInternal(text, tone)));

  function dismiss(id: number) {
    const t = timers.get(id);
    if (t?.handle !== null) clearTimeout(t?.handle);
    timers.delete(id);
    queue = dismissToast(queue, id);
  }
</script>

<div
  class="toast-region"
  style={phoneBottomOffsetPx !== undefined
    ? `--toast-bottom-offset: ${phoneBottomOffsetPx}px`
    : undefined}
>
  {#each queue as t (t.id)}
    <div
      class="toast"
      class:toast--error={t.tone === "error"}
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

  /* UI-1 (round 3): "the toast must never cover the phone sheet's buttons or the legend chip" --
     on the phone, the sheet (and, at "peek"/"half", the floating legend chip above it) sits at the
     SAME bottom-center the toast's flat `--space-5` offset used to assume was always clear.
     `--toast-bottom-offset` is set by whoever mounts this component (Shell.svelte, above the
     rail-row + sheet + chip band it already tracks for `.legend-chip-region`/`.map-attribution`)
     -- desktop and any mount that never sets it (report.html has no sheet at all) keep the plain
     `--space-5` fallback unchanged. Phone-scoped: on desktop the rail floats at the SIDE, not the
     bottom-center this toast occupies, so the flat offset was never actually at risk there. */
  @media (max-width: 899px) {
    .toast-region {
      bottom: var(--toast-bottom-offset, var(--space-5));
    }
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

  /* UI-1 (round 3): an error toast reads distinctly -- the SAME `--text-danger` border-only
     treatment `Switch.svelte`'s own contrast comments favour over a full-danger fill (a filled
     danger background at this size, for every "couldn't..." error, would be more alarming than
     informative). */
  .toast--error {
    border-color: var(--text-danger);
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
