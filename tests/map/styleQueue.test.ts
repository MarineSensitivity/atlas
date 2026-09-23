// REGRESSION (atlas-5 fix round 1): `createStyleApplier` must flush its queue on `"idle"`, which
// MapLibre fires every time the map settles — NOT `"style.load"`, which fires exactly ONCE, ever,
// for the true initial style transition. A fake map that models exactly that asymmetry (below) is
// what makes this a real regression test rather than an assertion that happens to pass either way.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STYLE_FALLBACK_MS,
  createStyleApplier,
  type QueuedStyleTarget,
} from "../../src/lib/map/styleQueue";
import type { StyleSpecification } from "../../src/lib/map/types";

const STYLE_A = { version: 8, sources: {}, layers: [{ id: "a", type: "background" }] } as Pick<
  StyleSpecification,
  "version" | "sources" | "layers"
> as StyleSpecification;
const STYLE_B = { version: 8, sources: {}, layers: [{ id: "b", type: "background" }] } as Pick<
  StyleSpecification,
  "version" | "sources" | "layers"
> as StyleSpecification;

/**
 * A fake map whose `once()` reproduces real MapLibre event semantics closely enough to matter
 * here: any registered callback fires at most once, on the next matching `emit()` — the test
 * script decides how many times each named event actually fires, which is the whole point (it
 * fires `"style.load"` exactly once, `"idle"` as many times as a real map settling repeatedly
 * would). `isStyleLoaded()` is pinned `false`: this test is entirely about the QUEUE path, so
 * every `applyQueued()` call must take it, deterministically.
 */
class FakeMap implements QueuedStyleTarget {
  private listeners = new Map<string, Array<() => void>>();

  isStyleLoaded(): boolean {
    return false;
  }

  once(event: string, cb: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  /** fire every callback CURRENTLY registered for `event`, then drop them — `once` semantics. */
  emit(event: string): void {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(event, []);
    for (const cb of list) cb();
  }
}

/**
 * Like `FakeMap`, but `isStyleLoaded()` is a mutable flag the test flips mid-scenario — needed for
 * the fix-round-2 regression below, which is specifically about the map transitioning from
 * not-loaded to loaded BETWEEN two `applyQueued` calls (every existing `FakeMap`-based test above
 * pins `isStyleLoaded()` at one constant value for its whole run, so none of them could have
 * caught this).
 */
class MutableFakeMap implements QueuedStyleTarget {
  private listeners = new Map<string, Array<() => void>>();
  loaded = false;

  isStyleLoaded(): boolean {
    return this.loaded;
  }

  once(event: string, cb: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  emit(event: string): void {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(event, []);
    for (const cb of list) cb();
  }
}

describe("createStyleApplier", () => {
  it("applies immediately once the style is already loaded", () => {
    const map: QueuedStyleTarget = { isStyleLoaded: () => true, once: () => {} };
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s));
    applyQueued(STYLE_A);
    expect(applied).toEqual([STYLE_A]);
  });

  it("queues while not loaded, and a second call before any flush overwrites the first", () => {
    const map = new FakeMap();
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s));
    applyQueued(STYLE_A);
    applyQueued(STYLE_B);
    expect(applied).toEqual([]); // nothing flushed yet
    map.emit("idle");
    expect(applied).toEqual([STYLE_B]); // the LATEST queued style wins, not both
  });

  it("REGRESSION: two SEPARATE not-loaded windows each flush on their own idle — style.load never refires", () => {
    const map = new FakeMap();
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s));

    // window 1: the map's true initial style is still loading.
    applyQueued(STYLE_A);
    map.emit("style.load"); // the ONE TRUE initial load — fires exactly once, ever, in real MapLibre
    expect(applied).toEqual([]); // must NOT have been consumed by style.load
    map.emit("idle"); // the first settle
    expect(applied).toEqual([STYLE_A]);

    // window 2: a LATER update arrives while the map is briefly not-loaded again (e.g. a newly
    // added raster source's tiles still in flight) — "style.load" is NEVER emitted again, exactly
    // as real MapLibre never refires it after the true initial transition.
    applyQueued(STYLE_B);
    map.emit("idle"); // the second settle
    expect(applied).toEqual([STYLE_A, STYLE_B]);
  });

  it("a queued style surviving to flush is the exact object handed to applyQueued (no cloning)", () => {
    const map = new FakeMap();
    let received: StyleSpecification | undefined;
    const applyQueued = createStyleApplier(map, (s) => (received = s));
    applyQueued(STYLE_A);
    map.emit("idle");
    expect(received).toBe(STYLE_A);
  });

  // FIX ROUND 2 (atlas-8, coordinator-reported): e2e/scores.firstpaint.spec.ts's v9 raster test
  // reproduced this intermittently on Firefox -- a lens calls `applyStyle` once while the map is
  // still not loaded (queued), then AGAIN once it has just settled to `isStyleLoaded()===true`
  // (applied directly, bypassing the queue). The earlier call's `once("idle", ...)` listener +
  // fallback timer were left armed and, left alone, fired later anyway -- reapplying the STALE,
  // now-outdated style over the correct one that had just landed. Root-caused with
  // `page.on("response")`/wrapped `map.setStyle` instrumentation: `getStyle().layers` showed the
  // raster layer added, then REMOVED again 100-4000ms later by a second real `setStyle` call whose
  // style never asked for it -- not a timing/assertion problem in the test, a real queue bug.
  it("REGRESSION: a direct apply once loaded cancels an earlier still-queued call's idle listener", () => {
    const map = new MutableFakeMap();
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s));

    applyQueued(STYLE_A); // not loaded yet -- queued, "idle" + fallback armed
    expect(applied).toEqual([]);

    // the map settles to loaded BEFORE that queued call's own "idle" ever fires (measured: this
    // can happen between two calls in the very same reactive tick).
    map.loaded = true;
    applyQueued(STYLE_B); // isStyleLoaded() now true -> applied immediately
    expect(applied).toEqual([STYLE_B]);

    // the STALE "idle" listener from the STYLE_A window finally fires. It must NOT re-apply
    // STYLE_A over the already-applied STYLE_B -- that would silently undo it.
    map.emit("idle");
    expect(applied).toEqual([STYLE_B]);
  });

  it("REGRESSION: a direct apply once loaded also cancels the earlier call's fallback timer", () => {
    vi.useFakeTimers();
    const map = new MutableFakeMap();
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s), { fallbackMs: 4_000 });

    applyQueued(STYLE_A); // not loaded -- queued, fallback timer armed for 4000ms out
    map.loaded = true;
    applyQueued(STYLE_B); // applied immediately; must cancel STYLE_A's fallback timer too
    expect(applied).toEqual([STYLE_B]);

    vi.advanceTimersByTime(10_000); // well past the old fallback bound
    expect(applied).toEqual([STYLE_B]); // STYLE_A's cancelled timer never fires
    vi.useRealTimers();
  });
});

// FIX ROUND 3 #4: a HUNG tile request (routed to a handler that never responds) leaves
// `isStyleLoaded()` false and `"idle"` NEVER fires — without a bounded fallback, the queued style
// is stranded silently, same symptom as the style.load bug this file already regression-tests,
// just triggered by the network instead of by event timing.
describe("createStyleApplier — hung tile fallback", () => {
  afterEach(() => vi.useRealTimers());

  it("the default fallback is 4000 ms", () => {
    expect(DEFAULT_STYLE_FALLBACK_MS).toBe(4_000);
  });

  it("REGRESSION: applies the queued style after fallbackMs even though idle never fires", () => {
    vi.useFakeTimers();
    const map = new FakeMap(); // isStyleLoaded() always false; "idle" is never emitted below
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s), { fallbackMs: 4_000 });

    applyQueued(STYLE_A);
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(3_999);
    expect(applied).toEqual([]); // still hung, still not applied — not yet at the bound
    vi.advanceTimersByTime(1);
    expect(applied).toEqual([STYLE_A]); // the bound: a hung tile must not block the lens forever
  });

  it("idle firing before the fallback applies once and cancels the fallback timer (no double-apply)", () => {
    vi.useFakeTimers();
    const map = new FakeMap();
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s), { fallbackMs: 4_000 });

    applyQueued(STYLE_A);
    map.emit("idle");
    expect(applied).toEqual([STYLE_A]);
    vi.advanceTimersByTime(10_000); // long past the fallback bound
    expect(applied).toEqual([STYLE_A]); // still exactly once
  });

  it("a later queued style still gets its own fallback after an earlier one already flushed", () => {
    vi.useFakeTimers();
    const map = new FakeMap();
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s), { fallbackMs: 4_000 });

    applyQueued(STYLE_A);
    vi.advanceTimersByTime(4_000);
    expect(applied).toEqual([STYLE_A]);

    applyQueued(STYLE_B); // a second hung window, e.g. a later species switch
    vi.advanceTimersByTime(3_999);
    expect(applied).toEqual([STYLE_A]);
    vi.advanceTimersByTime(1);
    expect(applied).toEqual([STYLE_A, STYLE_B]);
  });
});
