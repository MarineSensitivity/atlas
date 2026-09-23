// The `applyStyle` queue, pulled out of `map.ts` so the fix it embodies has a REGRESSION TEST that
// runs under vitest's Node environment (no real MapLibre map needed) — the same "fake the narrow
// interface" technique `style.ts`'s own `StyleTarget`/`applyStyle(map, style)` already uses.
//
// THE BUG FIX ROUND 1 FIXED: MapLibre can only diff against a LOADED style — calling
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
//
// FIX ROUND 3 #4: "idle" itself is not enough. A HUNG tile request (routed to a handler that never
// responds, or a genuinely dead network path) means the map never finishes loading that source, so
// `isStyleLoaded()` stays false and `"idle"` never fires — the queued style is stranded again, this
// time silently, with no error anywhere. A bounded FALLBACK timer flushes the queue anyway after
// `fallbackMs` (default 4000): `setStyle(diff:true)` on a partly-loaded style is safe (MapLibre
// diffs and applies the new layers/sources regardless of whether some OTHER source's tiles are
// still in flight), and a hung tile must never be allowed to block a lens forever.
import type { StyleSpecification } from "./types";

/** the narrow slice of MapLibre's `Map` this queue needs. `isStyleLoaded()`'s own real return type
 * is `boolean | void` (a MapLibre typing quirk) — matched here, not narrowed, so the real `Map`
 * satisfies this structurally without a cast at the call site. */
export interface QueuedStyleTarget {
  isStyleLoaded(): boolean | void;
  once(event: "idle", cb: () => void): unknown;
}

/** how long to wait for `"idle"` before applying a queued style anyway (fix round 3 #4). */
export const DEFAULT_STYLE_FALLBACK_MS = 4_000;

export interface CreateStyleApplierOptions {
  /** ms to wait for `"idle"` before flushing the queue regardless — a hung tile request must
   * never block a lens forever. */
  fallbackMs?: number;
  /** injected so a test drives the fallback with fake timers rather than sleeping — the same seam
   * `map/camera.ts`'s `createCameraWriter` and `data/picker.ts`'s `createSearchLogger` already use. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Build the `applyStyle` function `map.ts`'s `MapHandle` exposes: apply immediately when the style
 * is already loaded, else queue the LATEST style (an older queued one is simply overwritten — the
 * lens only ever wants "what should be on screen now") and flush it on the next `"idle"` — or after
 * `fallbackMs`, whichever comes first (fix round 3 #4). Flushing is idempotent: whichever of
 * `"idle"`/the timer fires first clears the queue and cancels the other; a stale listener firing
 * later (MapLibre's `once` has no cancel this narrow interface exposes) finds nothing left to
 * apply and is a safe no-op.
 */
export function createStyleApplier(
  map: QueuedStyleTarget,
  apply: (style: StyleSpecification) => void,
  opts: CreateStyleApplierOptions = {},
): (style: StyleSpecification) => void {
  const fallbackMs = opts.fallbackMs ?? DEFAULT_STYLE_FALLBACK_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  let queued: StyleSpecification | undefined;
  let queuedListener = false;
  let fallbackHandle: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    queuedListener = false;
    if (fallbackHandle !== undefined) {
      clearTimer(fallbackHandle);
      fallbackHandle = undefined;
    }
    const next = queued;
    queued = undefined;
    if (next) apply(next);
  }

  return function applyQueued(style: StyleSpecification): void {
    if (map.isStyleLoaded()) {
      // FIX ROUND 2 (atlas-8): a call that arrives once the map is loaded applies immediately --
      // but if an EARLIER call is still sitting in the queue (registered while the map was not
      // yet loaded, waiting on its own "idle"/fallback), that entry is now STALE and, left alone,
      // would flush over this one the moment its listener/timer fires. Measured on Firefox: the
      // map transitions to `isStyleLoaded()===true` BETWEEN two `applyStyle` calls in the same
      // reactive tick (e.g. a lens' zones-only call, then its raster-including one) -- the second
      // call's raster layer got added here, then silently REMOVED again 100-4000ms later when the
      // first call's queued, raster-less style finally flushed. Clearing the queue here extends
      // the "an older queued one is simply overwritten" rule (already true BETWEEN two queued
      // calls) to a queued call followed by a direct one: whichever call is temporally last always
      // wins. The stale `once("idle", flush)` registration itself cannot be un-registered through
      // this narrow interface, but `flush()` is already written to no-op safely when `queued` is
      // undefined (see its own comment) -- clearing `queued` here is what makes that no-op fire.
      queued = undefined;
      queuedListener = false;
      if (fallbackHandle !== undefined) {
        clearTimer(fallbackHandle);
        fallbackHandle = undefined;
      }
      apply(style);
      return;
    }
    queued = style;
    if (!queuedListener) {
      queuedListener = true;
      map.once("idle", flush);
      fallbackHandle = setTimer(flush, fallbackMs);
    }
  };
}
