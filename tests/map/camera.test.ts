// camera.ts's three rules (round, de-duplicate, debounce) — one fixture each.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_WRITE_DELAY_MS,
  cameraEqual,
  createCameraWriter,
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
