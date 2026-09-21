// atlas-3: Toast is ONE polite live region (spec.md "one polite live region announces async
// results"), so the component needs a small ordered queue rather than one-message-at-a-time
// state. The queue transitions are pure array operations, unit-tested without a DOM; the
// component wraps them in a rune ($state) and adds the timers.
export interface ToastMessage {
  id: number;
  text: string;
}

/** appends a toast to the end of the queue (read top-to-bottom = oldest-first, newest at the end) */
export function enqueueToast(queue: ToastMessage[], id: number, text: string): ToastMessage[] {
  return [...queue, { id, text }];
}

/** removes one toast by id, wherever it is in the queue (a user can dismiss out of order) */
export function dismissToast(queue: ToastMessage[], id: number): ToastMessage[] {
  return queue.filter((t) => t.id !== id);
}
