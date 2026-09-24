import { describe, expect, it, vi } from "vitest";
import { CIRCLE_SEGMENTS, createDrawSession, type TerraDrawModules } from "../../src/places/draw";
import type { AreaGeometry } from "../../src/lib/geo/types";

/**
 * A fake terra-draw pair, structurally matching what `createDrawSession` calls -- this test is
 * about the WIRING (mode construction, finish -> onFinish, setMode/clear/stop delegation), not
 * terra-draw's own internals, so it never loads the real (heavy) library.
 */
/** terra-draw's own `OnFinishContext` shape ({@link https://terradraw.io} 1.35) -- `action` is
 * `"draw"` for a fresh shape and one of `"dragCoordinate"`/`"dragCoordinateResize"`/`"dragFeature"`/
 * `"insertMidpoint"`/`"deleteCoordinate"` for an edit of a feature that already exists (P9: the
 * "editing a drawn shape duplicates it" bug -- see `draw.ts`'s own `onFinish` comment). */
type FakeFinishContext = { mode: string; action: string };

function fakeModules() {
  const listeners = new Map<string, (id: string, context: FakeFinishContext) => void>();
  const calls: { setMode: string[]; clear: number; stop: number } = {
    setMode: [],
    clear: 0,
    stop: 0,
  };
  const snapshot = new Map<string, { geometry: AreaGeometry }>();
  const adapterConfigs: unknown[] = [];
  const circleOptions: unknown[] = [];

  class FakeAdapter {
    constructor(config: unknown) {
      adapterConfigs.push(config);
    }
  }
  class FakeMode {}
  class FakeCircleMode {
    constructor(options: unknown) {
      circleOptions.push(options);
    }
  }
  class FakeTerraDraw {
    modes: unknown[];
    constructor(opts: { adapter: unknown; modes: unknown[] }) {
      this.modes = opts.modes;
    }
    start() {}
    stop() {
      calls.stop++;
    }
    clear() {
      calls.clear++;
    }
    setMode(mode: string) {
      calls.setMode.push(mode);
    }
    on(event: string, cb: (id: string, context: FakeFinishContext) => void) {
      listeners.set(event, cb);
    }
    off(event: string) {
      listeners.delete(event);
    }
    getSnapshotFeature(id: string) {
      return snapshot.get(id);
    }
  }

  const core = {
    TerraDraw: FakeTerraDraw,
    TerraDrawPolygonMode: FakeMode,
    TerraDrawRectangleMode: FakeMode,
    TerraDrawCircleMode: FakeCircleMode,
    TerraDrawSelectMode: FakeMode,
  } as unknown as TerraDrawModules["core"];
  const adapter = {
    TerraDrawMapLibreGLAdapter: FakeAdapter,
  } as unknown as TerraDrawModules["adapter"];

  return {
    modules: { core, adapter } as TerraDrawModules,
    fireFinish: (id: string, geometry: AreaGeometry, action = "draw") => {
      snapshot.set(id, { geometry });
      listeners.get("finish")?.(id, { mode: "polygon", action });
    },
    calls,
    adapterConfigs,
    circleOptions,
  };
}

const POLYGON: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
};

describe("createDrawSession", () => {
  it("passes the map through to the adapter", () => {
    const f = fakeModules();
    const map = { fake: true };
    createDrawSession({ map, onFinish: () => {} }, f.modules);
    expect(f.adapterConfigs[0]).toMatchObject({ map });
  });

  it("constructs the circle mode with the 64-gon segment count (Deliverable 3)", () => {
    const f = fakeModules();
    createDrawSession({ map: {}, onFinish: () => {} }, f.modules);
    expect(f.circleOptions[0]).toMatchObject({ segments: CIRCLE_SEGMENTS });
  });

  it("calls onFinish with the finished feature's id, geometry, and isNewFeature=true for a fresh draw", () => {
    const f = fakeModules();
    const onFinish = vi.fn();
    createDrawSession({ map: {}, onFinish }, f.modules);
    f.fireFinish("feature-1", POLYGON, "draw");
    expect(onFinish).toHaveBeenCalledWith("feature-1", POLYGON, true);
  });

  // P9 (the "editing a drawn shape duplicates it" bug): terra-draw fires the SAME `finish` event
  // for an edit of an EXISTING feature (drag a corner, resize, drag the whole shape, add/remove a
  // midpoint) -- `isNewFeature` must be false so the caller updates that feature's own place
  // instead of appending a duplicate.
  it.each([
    "dragCoordinate",
    "dragCoordinateResize",
    "dragFeature",
    "insertMidpoint",
    "deleteCoordinate",
  ])("calls onFinish with isNewFeature=false for a %s edit of an existing feature", (action) => {
    const f = fakeModules();
    const onFinish = vi.fn();
    createDrawSession({ map: {}, onFinish }, f.modules);
    f.fireFinish("feature-1", POLYGON, action);
    expect(onFinish).toHaveBeenCalledWith("feature-1", POLYGON, false);
  });

  it("does NOT call onFinish for a non-area geometry (e.g. a point mode somehow finishing)", () => {
    const f = fakeModules();
    const onFinish = vi.fn();
    createDrawSession({ map: {}, onFinish }, f.modules);
    f.fireFinish("feature-1", { type: "Point", coordinates: [0, 0] } as never);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("setMode/clear delegate to the underlying instance", () => {
    const f = fakeModules();
    const session = createDrawSession({ map: {}, onFinish: () => {} }, f.modules);
    session.setMode("rectangle");
    session.setMode("select");
    session.clear();
    expect(f.calls.setMode).toEqual(["rectangle", "select"]);
    expect(f.calls.clear).toBe(1);
  });

  it("stop() unregisters the finish listener and stops the instance", () => {
    const f = fakeModules();
    const onFinish = vi.fn();
    const session = createDrawSession({ map: {}, onFinish }, f.modules);
    session.stop();
    expect(f.calls.stop).toBe(1);
    f.fireFinish("feature-1", POLYGON); // listener was removed by stop() -- must not fire
    expect(onFinish).not.toHaveBeenCalled();
  });
});
