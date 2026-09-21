// atlas-3 step 4 fix round 1 (SC 4.1.3, spec.md §11's "ONE polite live region"): a plain,
// framework-agnostic pub-sub so any component can announce a message without rendering a
// role="status"/aria-live region of its own. Before this, the gallery had six concurrent live
// regions at once (DataTable x2, the Rail/HexButton gallery demos x2, Honeycomb, Toast) --
// screen readers do not merge or de-duplicate simultaneous regions, so the SAME async event could
// be announced several times, or an unrelated region's stale text could be read instead.
//
// Exactly ONE <Announcer /> renders the actual region (mount it once, near the app root); every
// other component calls `announce(text)` and renders no region of its own.
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
