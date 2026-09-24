// camera.ts's three rules (round, de-duplicate, debounce) — one fixture each.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_WRITE_DELAY_MS,
  INITIAL_AREA_CAMERA_STATE,
  boundsToCameraView,
  cameraEqual,
  createCameraWriter,
  roundCamera,
  shouldFlyToArea,
  type AreaCameraState,
} from "../../src/lib/map/camera";
import { formatSel, parseSel } from "../../src/lib/state/codec";
import { DEFAULT_SEL } from "../../src/lib/state/types";

describe("roundCamera", () => {
  it("rounds lon/lat to 5 dp and zoom to 2 dp", () => {
    expect(roundCamera({ lon: -101.30412345678, lat: 46.900987654, zoom: 2.16349 })).toEqual({
      lon: -101.30412,
      lat: 46.90099,
      zoom: 2.16,
    });
  });

  it("drops a flat bearing/pitch — they travel together, and `,0,0` is noise in a link", () => {
    expect(roundCamera({ lon: 1, lat: 2, zoom: 3, bearing: 0, pitch: 0 })).toEqual({
      lon: 1,
      lat: 2,
      zoom: 3,
    });
  });

  it("keeps BOTH once either is non-zero (state/types.ts's 3-or-5-field tuple)", () => {
    expect(roundCamera({ lon: 1, lat: 2, zoom: 3, bearing: 45.06, pitch: 0 })).toEqual({
      lon: 1,
      lat: 2,
      zoom: 3,
      bearing: 45.1,
      pitch: 0,
    });
  });

  it("normalizes -0, which would otherwise write `-0` and parse back as 0", () => {
    expect(Object.is(roundCamera({ lon: -0.000001, lat: 2, zoom: 3 }).lon, 0)).toBe(true);
  });

  it("round-trips through the URL codec unchanged", () => {
    const camera = roundCamera({ lon: -101.304123, lat: 46.9009876, zoom: 2.164 });
    const { search } = formatSel({ ...DEFAULT_SEL, map: camera });
    expect(parseSel({ search, hash: "" }).map).toEqual(camera);
  });
});

describe("cameraEqual", () => {
  it("treats an absent bearing/pitch as flat", () => {
    expect(
      cameraEqual({ lon: 1, lat: 2, zoom: 3 }, { lon: 1, lat: 2, zoom: 3, bearing: 0, pitch: 0 }),
    ).toBe(true);
  });

  it("separates two different zooms", () => {
    expect(cameraEqual({ lon: 1, lat: 2, zoom: 3 }, { lon: 1, lat: 2, zoom: 4 })).toBe(false);
  });
});

describe("createCameraWriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces ~300 ms and writes ONCE for a burst of moves", () => {
    const write = vi.fn();
    const w = createCameraWriter({ write });
    expect(CAMERA_WRITE_DELAY_MS).toBe(300);
    for (let i = 1; i <= 20; i++) w.push({ lon: i, lat: 2, zoom: 3 });
    vi.advanceTimersByTime(299);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ lon: 20, lat: 2, zoom: 3 });
  });

  it("never writes the camera the page loaded with (the seed)", () => {
    const write = vi.fn();
    const w = createCameraWriter({ write }, { lon: 1, lat: 2, zoom: 3 });
    w.push({ lon: 1, lat: 2, zoom: 3.000001 }); // rounds back to the seed
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it("a drag that returns to where it started writes nothing", () => {
    const write = vi.fn();
    const w = createCameraWriter({ write }, { lon: 1, lat: 2, zoom: 3 });
    w.push({ lon: 5, lat: 2, zoom: 3 });
    w.push({ lon: 1, lat: 2, zoom: 3 });
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it("flush() writes the pending camera immediately", () => {
    const write = vi.fn();
    const w = createCameraWriter({ write });
    w.push({ lon: 1, lat: 2, zoom: 3 });
    w.flush();
    expect(write).toHaveBeenCalledWith({ lon: 1, lat: 2, zoom: 3 });
  });

  it("cancel() drops it — what a programmatic flyTo does to a half-finished gesture", () => {
    const write = vi.fn();
    const w = createCameraWriter({ write });
    w.push({ lon: 1, lat: 2, zoom: 3 });
    w.cancel();
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();
  });
});

// atlas-5: the species camera hands the map an EXTENT (data/camera.ts's BoundsCamera), not a
// center+zoom preset — this is the "fitBounds is the map module's business" half of the subplan,
// done WITHOUT ever calling MapLibre's own fitBounds (tests/map/no-fitbounds.test.ts's gate).
describe("boundsToCameraView", () => {
  it("centers a symmetric box at its own center", () => {
    const { center } = boundsToCameraView(
      [
        [-10, -10],
        [10, 10],
      ],
      { width: 1000, height: 1000 },
    );
    expect(center[0]).toBeCloseTo(0, 5);
    expect(center[1]).toBeCloseTo(0, 5);
  });

  it("east may exceed 180 (an unwrapped, re-expressed frame) and is read LINEARLY, never wrapped", () => {
    // a Bering/Chukchi-style frame, minimalFrame()'s own worked example: 22.6 deg centred on 175E
    const { center, zoom } = boundsToCameraView(
      [
        [163.7, -16.05],
        [186.3, 20.2],
      ],
      { width: 1000, height: 1000 },
    );
    // the center must land AT the frame's own longitude (175), never at 0/antipodal from
    // wrapping east=186.3 back to -173.7 first.
    expect(center[0]).toBeCloseTo(175, 5);
    expect(Number.isFinite(zoom)).toBe(true);
  });

  it("a wider box gets a LOWER zoom than a narrower one, same viewport", () => {
    const viewport = { width: 800, height: 600 };
    const wide = boundsToCameraView(
      [
        [-100, -20],
        [100, 20],
      ],
      viewport,
    );
    const narrow = boundsToCameraView(
      [
        [-5, -5],
        [5, 5],
      ],
      viewport,
    );
    expect(wide.zoom).toBeLessThan(narrow.zoom);
  });

  it("padding shrinks the effective viewport, so a padded fit zooms out a bit", () => {
    const viewport = { width: 800, height: 600 };
    const bounds: [[number, number], [number, number]] = [
      [-10, -10],
      [10, 10],
    ];
    const padded = boundsToCameraView(bounds, viewport, { padding: 200 });
    const unpadded = boundsToCameraView(bounds, viewport, { padding: 0 });
    expect(padded.zoom).toBeLessThan(unpadded.zoom);
  });

  it("degenerate input (zero-area box, zero viewport) still returns finite numbers", () => {
    const { center, zoom } = boundsToCameraView(
      [
        [5, 5],
        [5, 5],
      ],
      { width: 0, height: 0 },
    );
    expect(Number.isFinite(center[0])).toBe(true);
    expect(Number.isFinite(center[1])).toBe(true);
    expect(Number.isFinite(zoom)).toBe(true);
  });

  it("respects minZoom/maxZoom clamps", () => {
    const { zoom } = boundsToCameraView(
      [
        [-179, -89],
        [179, 89],
      ],
      { width: 100, height: 100 },
      { minZoom: 3, maxZoom: 18 },
    );
    expect(zoom).toBeGreaterThanOrEqual(3);
  });
});

// the owner's 2026-09-24 defect: `?area=AK` rendered the default camera. Root cause was
// `Shell.svelte` resolving the initial study area against a literal `null` boot, plus the ONLY
// `flyTo` call living in `LayersPanel.svelte`'s `onchange` (the panel body, which never runs for a
// URL-driven `sel.area` on load) — see camera.ts's own header just above `shouldFlyToArea`.
describe("shouldFlyToArea — sel.area drives the camera on load AND on change", () => {
  it("flies on the FIRST resolution when ?area= is explicit (non-default) — this is the bug fix", () => {
    const { fly, next } = shouldFlyToArea("AK", "FULL", INITIAL_AREA_CAMERA_STATE);
    expect(fly).toBe(true);
    expect(next).toEqual({ flownAreaKey: "AK" });
  });

  it("does NOT fly on the first resolution when sel.area is still the default", () => {
    // boot just arrived; sel.area was never set explicitly — the map was already constructed
    // pointed roughly there (createMap's own area fallback), so this must be a no-op: precedence
    // for a LATER round that pads that initial default camera for docked panel/sheet chrome (an
    // area=-driven fly must win over the default fit, but the default fit itself is untouched
    // here — this is exactly why that precedence needs a comment AND a test).
    const { fly, next } = shouldFlyToArea("FULL", "FULL", INITIAL_AREA_CAMERA_STATE);
    expect(fly).toBe(false);
    expect(next).toEqual({ flownAreaKey: "FULL" });
  });

  it("does not re-fly to the same key twice in a row (no-fight: a re-render is not a change)", () => {
    const first = shouldFlyToArea("AK", "FULL", INITIAL_AREA_CAMERA_STATE);
    const second = shouldFlyToArea("AK", "FULL", first.next);
    expect(second.fly).toBe(false);
  });

  it("flies on a LATER change to a different area (the select, or the back button)", () => {
    const afterFirst = shouldFlyToArea("AK", "FULL", INITIAL_AREA_CAMERA_STATE).next;
    const { fly, next } = shouldFlyToArea("GA", "FULL", afterFirst);
    expect(fly).toBe(true);
    expect(next).toEqual({ flownAreaKey: "GA" });
  });

  it("flies on a LATER, explicit return to the default — it is no longer 'first'", () => {
    const afterFirst = shouldFlyToArea("GA", "FULL", INITIAL_AREA_CAMERA_STATE).next;
    const { fly } = shouldFlyToArea("FULL", "FULL", afterFirst);
    expect(fly).toBe(true);
  });

  it("area=FULL (an explicit, non-default STATE transition) fits the whole study area", () => {
    // the select's own "All US waters" option round-trips through the same path as any other
    // area, once it is a real change rather than the untouched initial default.
    let state: AreaCameraState = INITIAL_AREA_CAMERA_STATE;
    state = shouldFlyToArea("AK", "FULL", state).next;
    const { fly, next } = shouldFlyToArea("FULL", "FULL", state);
    expect(fly).toBe(true);
    expect(next.flownAreaKey).toBe("FULL");
  });
});
