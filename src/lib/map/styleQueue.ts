// The `applyStyle` queue, pulled out of `map.ts` so the fix it embodies has a REGRESSION TEST that
// runs under vitest's Node environment (no real MapLibre map needed) — the same "fake the narrow
// interface" technique `style.ts`'s own `StyleTarget`/`applyStyle(map, style)` already uses.
//
// THE BUG THIS FIXES (fix round 1, atlas-5): MapLibre can only diff against a LOADED style — calling
// `setStyle(diff:true)` earlier logs "Unable to perform style diff … Rebuilding the style from
// scratch" and throws the diff away. So a style composed before the map's first style has finished
// loading must be QUEUED and flushed once it settles. The queue used to flush on `"style.load"` —
// which MapLibre fires exactly ONCE, ever, for the true initial style transition. A lens whose data
// arrives async (any lens with a fetch on the critical path — species is the first, not the last)
// calls `applyStyle` more than once before that first style is done loading its own sources; the
// SECOND queued style registers a SECOND `once("style.load", …)`, which never fires again — that
// style is stranded in the queue forever, its layer never appears, and nothing errors. `"idle"`
// fixes it: MapLibre fires that event every time the map settles (loaded style, no pending source
// loads, no easing), repeatedly, for the whole life of the map, so a listener registered here always
// eventually runs.
import type { StyleSpecification } from "./types";

/** the narrow slice of MapLibre's `Map` this queue needs. `isStyleLoaded()`'s own real return type
 * is `boolean | void` (a MapLibre typing quirk) — matched here, not narrowed, so the real `Map`
 * satisfies this structurally without a cast at the call site. */
export interface QueuedStyleTarget {
  isStyleLoaded(): boolean | void;
  once(event: "idle", cb: () => void): unknown;
}

/**
 * Build the `applyStyle` function `map.ts`'s `MapHandle` exposes: apply immediately when the style
 * is already loaded, else queue the LATEST style (an older queued one is simply overwritten — the
 * lens only ever wants "what should be on screen now") and flush it on the next `"idle"`.
 */
export function createStyleApplier(
  map: QueuedStyleTarget,
  apply: (style: StyleSpecification) => void,
): (style: StyleSpecification) => void {
  let queued: StyleSpecification | undefined;
  let queuedListener = false;

  return function applyQueued(style: StyleSpecification): void {
    if (map.isStyleLoaded()) {
      apply(style);
      return;
    }
    queued = style;
    if (!queuedListener) {
      queuedListener = true;
      map.once("idle", () => {
        queuedListener = false;
        const next = queued;
        queued = undefined;
        if (next) apply(next);
      });
    }
  };
}
