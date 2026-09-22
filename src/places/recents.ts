// places/recents.ts -- the "Recent" accordion's storage (Deliverable 1): the last ten place TOKENS
// (`g1.name.bytes` / `z.set.keys` / `u.name.sha`, `placeCodec.encodePlace()`), never the only copy
// of anything -- the live places always come from `#pl=`; this is a convenience log a person can
// reopen a place FROM, and nothing on load reads it automatically. Every call is wrapped in
// try/catch (private mode / storage disabled is chrome, not a crash -- the same convention
// `src/lib/ui/Panel.svelte`'s own `storage()` helper follows), and the caller supplies the
// `Storage` object (dependency injection, like that same helper) so this stays Node-testable.
import { decodePlace, type Place } from "../lib/geo/placeCodec";

export const RECENTS_KEY = "atlas.places.recent";
export const MAX_RECENTS = 10;

/** every stored token, oldest last; a corrupt or missing entry reads as "no recents", never throws. */
export function loadRecents(storage: Storage | null): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Push one token to the front, de-duplicated, capped at {@link MAX_RECENTS}. Never throws (private
 * mode / quota exceeded degrades to "the push silently didn't happen" -- there is no other copy of
 * a recent to lose, unlike a live place, which only ever lives in `#pl=`).
 */
export function pushRecent(storage: Storage | null, token: string): string[] {
  const next = [token, ...loadRecents(storage).filter((t) => t !== token)].slice(0, MAX_RECENTS);
  try {
    storage?.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota exceeded: chrome, not correctness */
  }
  return next;
}

export function clearRecents(storage: Storage | null): void {
  try {
    storage?.removeItem(RECENTS_KEY);
  } catch {
    /* ditto */
  }
}

/** a recent token, decoded for display -- `null` for a token this build can no longer parse (a
 * codec version bump, or corrupted storage), which the caller drops rather than rendering broken. */
export function recentPlace(token: string): Place | null {
  try {
    return decodePlace(token);
  } catch {
    return null;
  }
}
