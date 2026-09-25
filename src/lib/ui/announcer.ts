// atlas-3 step 4 fix round 1 (SC 4.1.3, spec.md §11's "ONE polite live region"): a plain,
// framework-agnostic pub-sub so any component can announce a message without rendering a
// role="status"/aria-live region of its own. Before this, the gallery had six concurrent live
// regions at once (DataTable x2, the Rail/HexButton gallery demos x2, Honeycomb, Toast) --
// screen readers do not merge or de-duplicate simultaneous regions, so the SAME async event could
// be announced several times, or an unrelated region's stale text could be read instead.
//
// Exactly ONE <Announcer /> renders the actual region (mount it once, near the app root); every
// other component calls `announce(text)` and renders no region of its own.
//
// UI-1 (round 3, Opus 5.5 eyes-on review): "About 60 announce() messages go only to a
// screen-reader live region. A sighted user sees nothing happen" (Share's own copy confirmation,
// pick-mode on/off, draw hints, every 'couldn't...' error). `notify()` is the fix: it calls
// `announce()` (unchanged -- screen readers still hear it) AND enqueues a VISIBLE toast
// (`toastQueue.ts#pushToast`, read by whichever `<Toast>` is mounted -- Shell.svelte's, or
// report.html's own). Every USER-INITIATED action's result/error goes through `notify()` now;
// `announce()` alone stays for chatty status (a live row count as a filter changes, say) that
// would be noisy as a popping toast on every keystroke.
import { pushToast, type ToastTone } from "./toastQueue";

type Listener = (text: string) => void;

let listeners: Listener[] = [];
let lastMessage = "";
// a trailing zero-width space (U+200B, by code point -- never a literal invisible character in
// this file's own source) toggled on alternate calls, so two consecutive, character-identical
// announcements ("Filtered to 0 rows" twice in a row) still change the region's text content --
// most screen readers do not re-announce a live region whose text did not actually change.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
let zeroWidthToggle = false;

/** Announces `text` through the one shared live region. */
export function announce(text: string): void {
  zeroWidthToggle = !zeroWidthToggle;
  lastMessage = text + (zeroWidthToggle ? ZERO_WIDTH_SPACE : "");
  for (const listener of listeners) listener(lastMessage);
}

/** Announces `text` (same as `announce()`) AND enqueues a visible toast -- the fix for a
 * user-initiated action whose result/error must be seen, not just heard. `opts.tone` marks an
 * error toast (a subtle visual difference only; the SCREEN-READER text is identical either way,
 * `announce()` carries no tone concept and never will). */
export function notify(text: string, opts?: { tone?: ToastTone }): void {
  announce(text);
  pushToast(text, opts?.tone);
}

/** Subscribes to every future announcement; returns an unsubscribe function. Called by
 * Announcer.svelte, not by an ordinary component (call `announce()` instead). */
export function subscribeAnnouncer(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** The most recent announcement (with its zero-width-space toggle applied), for a newly-mounted
 * Announcer to show immediately rather than starting blank. */
export function getLastAnnouncerMessage(): string {
  return lastMessage;
}
