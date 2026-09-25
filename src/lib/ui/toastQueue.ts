// atlas-3: Toast is ONE polite live region (spec.md "one polite live region announces async
// results"), so the component needs a small ordered queue rather than one-message-at-a-time
// state. The queue transitions are pure array operations, unit-tested without a DOM; the
// component wraps them in a rune ($state) and adds the timers.
//
// UI-1 (round 3, Opus 5.5 eyes-on review): "about 60 announce() messages go only to a screen-
// reader live region... `lib/ui` has a visible toast component, but the app never mounts it."
// `tone` distinguishes an error from an ordinary confirmation (both still funnel through the SAME
// one region -- never a second, differently-styled surface); `pushToast`/`subscribeToastPush`
// below is the bus that lets `announcer.ts#notify()` reach WHICHEVER `<Toast>` is mounted on the
// current page (Shell.svelte's, or report.html's own) without either needing a `bind:this` handle
// to it -- the same "any component calls announce(), exactly one region renders it" shape
// `announcer.ts` itself already uses, just for the visible half.
export type ToastTone = "info" | "error";

export interface ToastMessage {
  id: number;
  text: string;
  tone?: ToastTone;
}

/** appends a toast to the end of the queue (read top-to-bottom = oldest-first, newest at the end) */
export function enqueueToast(
  queue: ToastMessage[],
  id: number,
  text: string,
  tone?: ToastTone,
): ToastMessage[] {
  return [...queue, { id, text, tone }];
}

type ToastPushListener = (text: string, tone?: ToastTone) => void;

let toastListeners: ToastPushListener[] = [];

/** Enqueues `text` on every currently-mounted `<Toast>` (normally exactly one per page). A no-op
 * (never a throw) if nothing is mounted yet -- the same "fire and forget" contract `announce()`
 * itself already has for a not-yet-mounted `<Announcer>`. */
export function pushToast(text: string, tone?: ToastTone): void {
  for (const listener of toastListeners) listener(text, tone);
}

/** Subscribes to every future `pushToast()` call; returns an unsubscribe function. Called by
 * Toast.svelte's own `onMount`, not by an ordinary component (call `notify()` instead). */
export function subscribeToastPush(listener: ToastPushListener): () => void {
  toastListeners.push(listener);
  return () => {
    toastListeners = toastListeners.filter((l) => l !== listener);
  };
}

/** removes one toast by id, wherever it is in the queue (a user can dismiss out of order) */
export function dismissToast(queue: ToastMessage[], id: number): ToastMessage[] {
  return queue.filter((t) => t.id !== id);
}

/**
 * PURE: the time left on an auto-dismiss timer of `totalMs` after `elapsedMs` have passed,
 * clamped to 0 (never negative). SC 2.2.1 (Timing Adjustable): a toast pausing on hover/focus
 * needs to resume with whatever time was actually left, not restart the full duration nor keep
 * counting down while paused -- this is the arithmetic Toast.svelte's pause()/resume() apply.
 */
export function remainingMs(totalMs: number, elapsedMs: number): number {
  return Math.max(0, totalMs - elapsedMs);
}
