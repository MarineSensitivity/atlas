// camera.ts's three rules (round, de-duplicate, debounce) — one fixture each.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_WRITE_DELAY_MS,
  NO_PADDING,
  boundsToCameraView,
  cameraEqual,
  createCameraWriter,
  paddedStudyAreaCenter,
  roundCamera,
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

// usability M4: "frame the study area with padding for the panel/sheet". `paddedStudyAreaCenter`
// is what map.ts bakes into the INITIAL camera (never MapLibre's own persisted `padding` state --
// see the function's own header for why); these fixtures assert the geometry directly, independent
// of MapLibre.
describe("paddedStudyAreaCenter", () => {
  const CENTER = { lon: -101.304, lat: 46.9 };
  const ZOOM = 2.16;

  it("no padding: the center is unchanged", () => {
    const out = paddedStudyAreaCenter(CENTER, ZOOM, NO_PADDING);
    expect(out.lon).toBeCloseTo(CENTER.lon, 9);
    expect(out.lat).toBeCloseTo(CENTER.lat, 9);
  });

  it("symmetric padding (equal left/right, equal top/bottom) is still unchanged", () => {
    const out = paddedStudyAreaCenter(CENTER, ZOOM, {
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
    });
    expect(out.lon).toBeCloseTo(CENTER.lon, 9);
    expect(out.lat).toBeCloseTo(CENTER.lat, 9);
  });

  it("a right-docked panel (padding.right only) moves the center EAST, so the study area renders further left on screen", () => {
    const out = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, right: 380 });
    expect(out.lon).toBeGreaterThan(CENTER.lon);
    expect(out.lat).toBeCloseTo(CENTER.lat, 6); // right-only padding must not move latitude
  });

  it("a left-docked panel (padding.left only) moves the center WEST, mirroring the right-docked case", () => {
    const right = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, right: 380 });
    const left = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, left: 380 });
    expect(left.lon).toBeLessThan(CENTER.lon);
    // same MAGNITUDE of shift, opposite direction -- the formula is symmetric in left vs right.
    expect(Math.abs(left.lon - CENTER.lon)).toBeCloseTo(Math.abs(right.lon - CENTER.lon), 9);
  });

  it("a bottom-docked panel (padding.bottom only) moves the center SOUTH, so the study area renders higher on screen", () => {
    const out = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, bottom: 300 });
    expect(out.lat).toBeLessThan(CENTER.lat);
  });

  it("a bigger reservation shifts the center further, monotonically", () => {
    const small = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, right: 200 });
    const big = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, right: 500 });
    expect(big.lon - CENTER.lon).toBeGreaterThan(small.lon - CENTER.lon);
  });

  it("a higher zoom (a smaller world-px shift per degree) shifts the center LESS for the same padding", () => {
    const lowZoom = paddedStudyAreaCenter(CENTER, 2, { ...NO_PADDING, right: 380 });
    const highZoom = paddedStudyAreaCenter(CENTER, 8, { ...NO_PADDING, right: 380 });
    expect(Math.abs(highZoom.lon - CENTER.lon)).toBeLessThan(Math.abs(lowZoom.lon - CENTER.lon));
  });

  it("returns finite numbers even for degenerate input (zero zoom)", () => {
    const out = paddedStudyAreaCenter(CENTER, 0, { ...NO_PADDING, right: 380, bottom: 200 });
    expect(Number.isFinite(out.lon)).toBe(true);
    expect(Number.isFinite(out.lat)).toBe(true);
  });
});
