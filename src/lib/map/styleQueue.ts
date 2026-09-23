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
//
// 0.10.20 — THE SETTLE CYCLE. Everything above only queued while `!isStyleLoaded()`. That left one
// real hole: the map's blank first style (and any style whose sources have finished) is trivially
// "loaded", so two `applyStyle` calls arriving close together could both take the direct branch and
// hand MapLibre two back-to-back `setStyle(diff:true)` calls with nothing between them. That is the
// "real MapLibre-level mis-ordering" `layers/basemap.ts`'s own header describes as measured, and
// the reason the basemap fix deliberately never forced a recompose when its fetch resolved — which
// in turn is what made the basemap silently NEVER paint on a slow load (see `warmBasemapStyles()`).
// So the invariant is now stronger and stated once, here: **at most one `setStyle` is in flight at
// a time.** An apply is issued only when nothing is settling; otherwise the LATEST style is queued
// and issued when the in-flight one settles (`"idle"`, or the same bounded fallback). Callers may
// therefore recompose as often as they like, from a promise or from a reactive effect, without
// having to reason about MapLibre's internal timing — an extra recompose costs at most one more
// cycle, never a mis-ordered pair of diffs.
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
 * Build the `applyStyle` function `map.ts`'s `MapHandle` exposes.
 *
 * One rule: **at most one `setStyle` in flight**. A call that arrives while nothing is settling and
 * the style is loaded is applied immediately; any other call parks the LATEST style (an older
 * parked one is simply overwritten — the caller only ever wants "what should be on screen now") and
 * it is issued when the current cycle settles, on `"idle"` or after `fallbackMs`, whichever comes
 * first.
 *
 * Every armed listener/timer carries the cycle it belongs to, so a stale one — MapLibre's `once`
 * has no cancel this narrow interface exposes, and a `once("idle")` registered for a superseded
 * cycle still fires — compares unequal and is a no-op rather than an early, out-of-turn flush.
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
  /** true between issuing a `setStyle` and that style settling — the "in flight" flag. */
  let settling = false;
  /** bumped on every state change, so listeners/timers armed for an older cycle no-op. */
  let cycle = 0;
  /** the cycle a listener + timer are currently armed for, or `-1` when nothing is armed. */
  let armedCycle = -1;
  let fallbackHandle: ReturnType<typeof setTimeout> | undefined;

  function clearFallback(): void {
    if (fallbackHandle !== undefined) {
      clearTimer(fallbackHandle);
      fallbackHandle = undefined;
    }
  }

  function arm(): void {
    if (armedCycle === cycle) return; // already waiting on this cycle
    armedCycle = cycle;
    const armedFor = cycle;
    map.once("idle", () => {
      if (armedFor === cycle) settle();
    });
    fallbackHandle = setTimer(() => {
      if (armedFor === cycle) settle();
    }, fallbackMs);
  }

  /** the in-flight style (or the not-yet-loaded initial one) has settled: issue whatever is parked. */
  function settle(): void {
    cycle += 1;
    armedCycle = -1;
    clearFallback();
    settling = false;
    const next = queued;
    queued = undefined;
    if (next) issue(next);
  }

  /** the ONE place `apply` is called: starts a fresh cycle, so anything armed for the previous one
   * (including a listener this interface cannot unregister) can no longer cut it short. */
  function issue(style: StyleSpecification): void {
    cycle += 1;
    armedCycle = -1;
    clearFallback();
    queued = undefined;
    settling = true;
    apply(style);
    arm();
  }

  return function applyQueued(style: StyleSpecification): void {
    if (settling || !map.isStyleLoaded()) {
      queued = style;
      arm();
      return;
    }
    issue(style);
  };
}
