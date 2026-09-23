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
//
// 0.10.22 — SETTLE ON THE STYLE'S OWN LOAD, NOT ON "idle". The 0.10.20 cycle was right to hold
// "at most one `setStyle` in flight", but it ended the flight on `"idle"`, and MapLibre withholds
// `"idle"` for as long as ANY tile of ANY source is loading or the camera is moving. That is not
// "the style has been applied": it is "the whole map has finished drawing". Measured (instrumented
// `e2e/species.timing.spec.ts`, 10 cold loads per tree): on a species deep link the shell recomposes
// when CARTO's style.json lands, and the species raster's own style — composed 2-7 ms later, once
// the taxon shard resolves — was PARKED behind it for the whole of the species camera flight
// (+528..+750 ms after the shard in 9/10 loads, +1,899 ms in one), because `"idle"` cannot fire
// while `flyTo` is animating. 0.10.19 issued the same style +2..+7 ms after the shard. Pushed past
// one of the timing gate's `expect.poll` back-off steps, that delay is the ~1 s bimodal regression
// (1.3-1.5 s -> 2.3-3.2 s median). Worse, the in-flight style in 9/10 of those loads was a NO-OP:
// the INACTIVE theme's style.json reporting in recomposes an identical style, MapLibre's diff finds
// nothing to change and fires no event at all — so only `"idle"` could ever end that cycle.
//
// So "in flight" now means exactly what MapLibre means by it:
//  - an issued style SETTLES on its own `"style.load"`. MapLibre fires it at the end of a diff that
//    changed something (synchronously, inside `setStyle`) and at the end of a from-scratch rebuild
//    (asynchronously, once the rebuilt style has loaded). After it, the style is diffable again —
//    tiles still loading are not a `setStyle` in flight. `"idle"` and the bounded fallback stay as
//    the backstops for a style that never reports (a failed validation), exactly as before.
//  - a style IDENTICAL to the one last handed to MapLibre is not issued at all (and supersedes
//    anything parked): its diff is empty, it would fire nothing, and nothing needs applying.
//  - "may this style be diffed against yet?" is a LATCH (the map's style has loaded once — seen via
//    `"idle"`, a confirmed issue, or `isStyleLoaded()`), not a fresh `isStyleLoaded()` on every call:
//    that one is false while any tile loads, and parking on it re-created the same wait.
//  - the ONE part of a diff `"style.load"` does not cover is a changed `sprite`: MapLibre fetches it
//    afterwards, and maplibre-gl 6.10's `Style#_loadSprite` does not abort an earlier fetch, so two
//    sprite changes in flight at once land in whichever order the network answers (a double theme
//    toggle could end on the wrong theme's icons). A style that changes the sprite AGAIN while the
//    last change is still loading therefore waits for `"idle"`, exactly as 0.10.20 made every style
//    wait. A style that keeps the sprite — the species raster behind the basemap's arrival — does not.
// Every 0.10.20 guarantee holds: one `setStyle` in flight (a parked style still waits for the
// in-flight one to be APPLIED), latest style wins, a stale listener (any cycle's `"idle"` OR
// `"style.load"`) no-ops, the 4 s fallback still bounds a hung map, and 0.10.10's rule that a stale
// queued style can never clobber a newer one is unchanged (`issue()` clears the queue and bumps the
// cycle). `tests/map/styleQueue.test.ts` "0.10.22" cases are the regression gate.
import type { StyleSpecification } from "./types";

/** the narrow slice of MapLibre's `Map` this queue needs. `isStyleLoaded()`'s own real return type
 * is `boolean | void` (a MapLibre typing quirk) — matched here, not narrowed, so the real `Map`
 * satisfies this structurally without a cast at the call site. `"style.load"` is MapLibre's own
 * "this style has been applied" event (0.10.22 — see the header). */
export interface QueuedStyleTarget {
  isStyleLoaded(): boolean | void;
  once(event: "idle" | "style.load", cb: () => void): unknown;
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
 * One rule: **at most one `setStyle` in flight**. A call that arrives while nothing is in flight
 * and the map's style can take a diff is issued immediately; any other call parks the LATEST style
 * (an older parked one is simply overwritten — the caller only ever wants "what should be on screen
 * now"). The in-flight style settles on its own `"style.load"` (0.10.22), or on `"idle"`, or after
 * `fallbackMs`, whichever comes first — and then the parked style, if any, is issued.
 *
 * A style identical to the one last issued is never re-issued (0.10.22): MapLibre's diff would be
 * empty and would report nothing, which used to hold the queue until the map next went idle.
 *
 * Every armed listener/timer carries the cycle it belongs to, so a stale one — MapLibre's `once`
 * has no cancel this narrow interface exposes, and a `once("idle")`/`once("style.load")` registered
 * for a superseded cycle still fires — compares unequal and is a no-op rather than an early,
 * out-of-turn flush.
 */
export function createStyleApplier(
  map: QueuedStyleTarget,
  apply: (style: StyleSpecification) => void,
  opts: CreateStyleApplierOptions = {},
): (style: StyleSpecification) => void {
  const fallbackMs = opts.fallbackMs ?? DEFAULT_STYLE_FALLBACK_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  let queued: { style: StyleSpecification; key: string } | undefined;
  /** true between issuing a `setStyle` and MapLibre confirming it — the "in flight" flag. */
  let settling = false;
  /** latched once the map's style is known to have loaded: from then on a diff is valid even while
   * tiles load (MapLibre's own precondition is the style's JSON, not its tiles). */
  let diffable = false;
  /** the serialized form of the style last handed to `apply` — the no-op check. */
  let lastIssued: string | undefined;
  /** the last issued style's `sprite` (serialized; `""` for none — the blank first style has none),
   * and whether a CHANGE to it may still be loading (only `"idle"`/the fallback clear this: the
   * style's own `"style.load"` fires before its sprite has arrived). */
  let lastSprite = "";
  let spriteLoading = false;
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

  /** wait for the current cycle to settle: `"idle"` (which implies a loaded style) or the bounded
   * fallback. An ISSUED style also listens for its own `"style.load"` — see `issue()`. */
  function arm(): void {
    if (armedCycle === cycle) return; // already waiting on this cycle
    armedCycle = cycle;
    const armedFor = cycle;
    map.once("idle", () => {
      if (armedFor === cycle) settle("idle");
    });
    fallbackHandle = setTimer(() => {
      if (armedFor === cycle) settle("fallback");
    }, fallbackMs);
  }

  /** the in-flight style (or the not-yet-loaded initial one) has settled: offer whatever is parked.
   * `"idle"` and `"style.load"` prove the map's style is loaded; only `"idle"` proves its sprite is
   * too; the fallback proves nothing and only bounds the wait, so it issues the parked style
   * regardless (a hung map must never block a lens forever — fix round 3 #4). */
  function settle(by: "idle" | "style.load" | "fallback"): void {
    cycle += 1;
    armedCycle = -1;
    clearFallback();
    settling = false;
    if (by !== "fallback") diffable = true;
    if (by !== "style.load") spriteLoading = false;
    const next = queued;
    queued = undefined;
    if (!next) return;
    if (by === "fallback") issue(next.style, next.key);
    else offer(next.style, next.key); // may still wait: a second sprite change needs "idle"
  }

  /** the ONE place `apply` is called: starts a fresh cycle, so anything armed for the previous one
   * (including a listener this interface cannot unregister) can no longer cut it short. */
  function issue(style: StyleSpecification, key: string): void {
    cycle += 1;
    armedCycle = -1;
    clearFallback();
    queued = undefined;
    settling = true;
    lastIssued = key;
    const sprite = spriteKey(style);
    if (sprite !== lastSprite) spriteLoading = sprite !== "";
    lastSprite = sprite;
    const issuedFor = cycle;
    // registered BEFORE `apply`: a diff that changes anything fires it synchronously, inside
    // `setStyle`, so this is usually settled by the time `apply` returns.
    map.once("style.load", () => {
      if (issuedFor === cycle) settle("style.load");
    });
    apply(style);
    if (issuedFor === cycle) arm(); // not confirmed yet (a rebuild, or a style MapLibre rejected)
  }

  function spriteKey(style: StyleSpecification): string {
    return style.sprite === undefined ? "" : JSON.stringify(style.sprite);
  }

  /** issue `style` now if nothing forbids it, else park it (the latest parked style wins). */
  function offer(style: StyleSpecification, key: string): void {
    if (!diffable && map.isStyleLoaded()) diffable = true;
    if (spriteLoading && map.isStyleLoaded()) spriteLoading = false;
    if (settling || !diffable || (spriteLoading && spriteKey(style) !== lastSprite)) {
      queued = { style, key };
      arm();
      return;
    }
    issue(style, key);
  }

  return function applyQueued(style: StyleSpecification): void {
    const key = JSON.stringify(style);
    if (key === lastIssued) {
      // already what MapLibre has (or is applying): nothing to issue, and anything parked is
      // older than this call, so it is superseded — the latest request wins, as always.
      queued = undefined;
      return;
    }
    offer(style, key);
  };
}
