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

  // 0.10.20 (the basemap-never-paints round): the direct branch above used to be taken by EVERY
  // call that arrived while `isStyleLoaded()` happened to be true -- including one arriving in the
  // same tick as a `setStyle` that had only just been issued. Two back-to-back
  // `setStyle(diff:true)` calls with nothing between them is the MapLibre-level mis-ordering
  // `layers/basemap.ts`'s header describes as measured, and the reason the basemap fix refused to
  // recompose when its fetch resolved -- which is what made the basemap silently never paint.
  // The invariant is now "at most one `setStyle` in flight": a second call lands on the queue and
  // is issued when the first settles, never beside it.
  it("REGRESSION: a second apply while the first is still settling is coalesced, not issued beside it", () => {
    const map = new MutableFakeMap();
    map.loaded = true; // the map's blank first style is trivially "loaded"
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s));

    applyQueued(STYLE_A);
    expect(applied).toEqual([STYLE_A]); // nothing in flight yet -> issued straight away

    // a SECOND call in the same tick, with `isStyleLoaded()` still reporting true (MapLibre does
    // not flip it synchronously). Before the fix this issued a second `setStyle` immediately.
    applyQueued(STYLE_B);
    expect(applied).toEqual([STYLE_A]); // parked, because STYLE_A has not settled

    map.emit("idle"); // STYLE_A settles -> the parked style is issued, exactly once
    expect(applied).toEqual([STYLE_A, STYLE_B]);

    map.emit("idle"); // ...and nothing is left to re-apply
    expect(applied).toEqual([STYLE_A, STYLE_B]);
  });

  it("REGRESSION: a burst of applies during one settle cycle costs ONE extra setStyle, with the LATEST style", () => {
    const map = new MutableFakeMap();
    map.loaded = true;
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s));

    applyQueued(STYLE_A);
    // e.g. the lens' raster effect, then the late-arriving basemap style, then a selection change
    applyQueued(STYLE_B);
    applyQueued(STYLE_A);
    applyQueued(STYLE_B);
    expect(applied).toEqual([STYLE_A]);

    map.emit("idle");
    expect(applied).toEqual([STYLE_A, STYLE_B]); // one extra call, carrying the last style asked for
  });

  it("a stale idle listener from a superseded cycle cannot cut the current cycle short", () => {
    // `once("idle", ...)` cannot be unregistered through this narrow interface, so a listener armed
    // for an earlier cycle DOES still fire. It must no-op rather than settle the current one early
    // (which would release a parked style beside an in-flight `setStyle` -- the very thing above).
    const map = new MutableFakeMap();
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s));

    applyQueued(STYLE_A); // not loaded -> parked, cycle 0 armed
    map.loaded = true;
    applyQueued(STYLE_B); // issued now; cycle 0's listener is stale, cycle 1 is armed
    expect(applied).toEqual([STYLE_B]);

    applyQueued(STYLE_A); // parked behind the in-flight STYLE_B
    map.emit("idle"); // fires BOTH the stale cycle-0 listener and the live cycle-1 one
    expect(applied).toEqual([STYLE_B, STYLE_A]); // exactly one flush, not two
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

/**
 * A fake that models what 0.10.22 depends on in real MapLibre (`Map#setStyle(style, {diff:true})`,
 * maplibre-gl 6.10 `Style#setState`): a diff that CHANGES something fires `"style.load"`
 * SYNCHRONOUSLY, inside `setStyle`, once the operations have been applied; an EMPTY diff returns
 * early and fires nothing; and a style with sources leaves `isStyleLoaded()` false for as long as
 * its tiles load — during which (like a camera flight) `"idle"` does not fire until the test says
 * so. The test decides when `"idle"` fires; the fake never emits it on its own.
 */
class DiffingFakeMap implements QueuedStyleTarget {
  private listeners = new Map<string, Array<() => void>>();
  /** what MapLibre currently holds, serialized — an equal style is an empty diff. */
  private current = "";
  /** false while the last applied style's tiles are "loading". */
  tilesLoaded = true;
  /** every `setStyle` MapLibre actually received, in order. */
  readonly setStyleCalls: StyleSpecification[] = [];

  isStyleLoaded(): boolean {
    return this.tilesLoaded;
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

  /** the `apply` the queue is built with: `setStyle(style, {diff: true})`. */
  setStyle = (style: StyleSpecification): void => {
    this.setStyleCalls.push(style);
    const next = JSON.stringify(style);
    if (next === this.current) return; // empty diff: `setState` returns false, no event
    this.current = next;
    this.tilesLoaded = false; // the new sources' tiles are now in flight
    this.emit("style.load"); // `setState` fires MapStyleLoadEvent at the end of a real diff
  };
}

/** a style with one raster source, standing in for "the basemap" / "the species raster". */
function styleWith(...ids: string[]): StyleSpecification {
  return {
    version: 8,
    sources: Object.fromEntries(
      ids.map((id) => [id, { type: "raster", tiles: [`https://x/${id}/{z}/{x}/{y}.png`] }]),
    ),
    layers: ids.map((id) => ({ id, type: "raster", source: id })),
  } as unknown as StyleSpecification;
}

// 0.10.22 — the species first-paint regression (1.3-1.5 s median on 0.10.19 -> a bimodal
// 1.4-3.2 s on 0.10.20/0.10.21). Instrumented: the basemap-arrival recompose was issued, and the
// species raster style composed 2-7 ms later was PARKED until the map next went `"idle"` — which
// MapLibre withholds for the whole species camera flight and while any tile loads (+528..+1,899 ms
// after the shard). These fixtures never emit `"idle"` during the window that matters, and use fake
// timers so the 4 s fallback cannot be what rescues them: under 0.10.20's queue every one is red.
describe("createStyleApplier — 0.10.22: a style settles on its own style.load, not on idle", () => {
  afterEach(() => vi.useRealTimers());

  it("REGRESSION: a style parked behind an in-flight one is issued on that style's style.load — no idle, no fallback", () => {
    vi.useFakeTimers();
    const map = new DiffingFakeMap();
    const applied: StyleSpecification[] = [];
    // a "rebuild" first: this apply does NOT report synchronously, so the next call must park
    let deferLoad = true;
    const applyQueued = createStyleApplier(map, (s) => {
      applied.push(s);
      if (deferLoad) return; // a from-scratch rebuild: style.load comes later, asynchronously
      map.setStyle(s);
    });
    const basemap = styleWith("basemap");
    const raster = styleWith("basemap", "species-raster");

    applyQueued(basemap); // issued: the map's blank style is loaded
    expect(applied).toEqual([basemap]);
    applyQueued(raster); // the basemap style has not reported yet -> parked (one in flight)
    expect(applied).toEqual([basemap]);

    deferLoad = false;
    map.emit("style.load"); // the basemap style is APPLIED — tiles still loading, no idle
    expect(applied).toEqual([basemap, raster]);
    vi.advanceTimersByTime(0);
    expect(applied).toEqual([basemap, raster]); // and not via a timer either
  });

  it("REGRESSION: a style arriving while the previous one's TILES load (camera moving, no idle) is issued at once", () => {
    vi.useFakeTimers();
    const map = new DiffingFakeMap();
    const applyQueued = createStyleApplier(map, map.setStyle);
    const basemap = styleWith("basemap");
    const raster = styleWith("basemap", "species-raster");

    applyQueued(basemap); // the basemap-arrival recompose: a real diff, reports synchronously
    expect(map.isStyleLoaded()).toBe(false); // its tiles are loading, and "idle" never comes here
    applyQueued(raster); // the shard's recompose, 2-7 ms later in the measured timeline
    expect(map.setStyleCalls).toEqual([basemap, raster]);
    vi.advanceTimersByTime(DEFAULT_STYLE_FALLBACK_MS * 2);
    expect(map.setStyleCalls).toEqual([basemap, raster]); // exactly two setStyle calls, ever
  });

  it("REGRESSION: an identical recompose (the INACTIVE theme's style.json reporting in) is not issued and opens no cycle", () => {
    vi.useFakeTimers();
    const map = new DiffingFakeMap();
    const applyQueued = createStyleApplier(map, map.setStyle);
    const basemap = styleWith("basemap");
    const raster = styleWith("basemap", "species-raster");

    applyQueued(basemap);
    // a NEW object with identical content: MapLibre's diff would be empty and fire nothing, so if
    // it were issued, only "idle" could end its cycle — 9 of the 10 measured slow loads.
    applyQueued(styleWith("basemap"));
    expect(map.setStyleCalls).toEqual([basemap]);
    applyQueued(raster);
    expect(map.setStyleCalls).toEqual([basemap, raster]);
  });

  it("an identical recompose while a newer style is parked supersedes it — the latest request wins", () => {
    const map = new MutableFakeMap(); // never reports style.load: everything stays in flight
    map.loaded = true;
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s));

    applyQueued(STYLE_A); // in flight
    applyQueued(STYLE_B); // parked
    applyQueued({ ...STYLE_A }); // "back to exactly what is in flight"
    map.emit("idle");
    expect(applied).toEqual([STYLE_A]); // STYLE_B was superseded, never issued
  });

  it("still at most one setStyle in flight: a style that does not report keeps later ones parked until it does", () => {
    const map = new DiffingFakeMap();
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s)); // never reports
    applyQueued(STYLE_A);
    applyQueued(STYLE_B);
    applyQueued(styleWith("c"));
    expect(applied).toEqual([STYLE_A]);
    map.emit("style.load"); // STYLE_A reports -> the LATEST parked style is issued, once
    expect(applied).toEqual([STYLE_A, styleWith("c")]);
  });

  it("before the map's first style has loaded, a style still waits (the latch starts closed)", () => {
    const map = new MutableFakeMap(); // isStyleLoaded() false: the blank initial style is loading
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s));
    applyQueued(STYLE_A);
    expect(applied).toEqual([]);
    map.emit("idle");
    expect(applied).toEqual([STYLE_A]);
  });

  it("a stale style.load (a superseded cycle's) cannot settle the current one early", () => {
    const map = new MutableFakeMap();
    map.loaded = true;
    const applied: StyleSpecification[] = [];
    const applyQueued = createStyleApplier(map, (s) => applied.push(s)); // never reports itself
    applyQueued(STYLE_A); // cycle for A armed: style.load + idle
    map.emit("idle"); // A settles by idle; A's once("style.load") is still registered (stale)
    applyQueued(STYLE_B); // issued: B is in flight, with its own style.load listener
    const c = styleWith("c");
    applyQueued(c); // parked behind B
    // ONE style.load fires both A's stale listener and B's live one: exactly one flush
    map.emit("style.load");
    expect(applied).toEqual([STYLE_A, STYLE_B, c]);
    // ...and c is now the one in flight: had the stale listener been allowed to settle a cycle
    // too, the queue would believe nothing is in flight and issue d beside c
    const d = styleWith("d");
    applyQueued(d);
    expect(applied).toEqual([STYLE_A, STYLE_B, c]);
    map.emit("style.load"); // c reports -> d, once
    expect(applied).toEqual([STYLE_A, STYLE_B, c, d]);
  });
});
