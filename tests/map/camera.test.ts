// camera.ts's three rules (round, de-duplicate, debounce) — one fixture each.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_WRITE_DELAY_MS,
  INITIAL_AREA_CAMERA_STATE,
  NO_PADDING,
  PHONE_DEFAULT_BOUNDS,
  STUDY_AREA_REFERENCE_VIEWPORT,
  boundsToCameraView,
  cameraEqual,
  cameraViewToBounds,
  createCameraWriter,
  paddedStudyAreaCenter,
  phoneDefaultCamera,
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

  // P6/D8 (Opus 5.5 eyes-on, 2026-09-24): a docked panel/sheet occludes only ONE side, so the
  // caller needs the SAME asymmetric-padding shift `paddedStudyAreaCenter` already applies to the
  // initial camera — a uniform number (every caller before this round) is the degenerate case
  // (shift zero, as the pre-existing tests above already pin) and must keep behaving exactly as
  // before.
  describe("asymmetric padding (ChromePadding)", () => {
    const bounds: [[number, number], [number, number]] = [
      [-10, -10],
      [10, 10],
    ];
    const viewport = { width: 800, height: 600 };

    it("a uniform ChromePadding (all four sides equal) matches the plain-number form", () => {
      const byNumber = boundsToCameraView(bounds, viewport, { padding: 100 });
      const byPadding = boundsToCameraView(bounds, viewport, {
        padding: { top: 100, right: 100, bottom: 100, left: 100 },
      });
      expect(byPadding.center[0]).toBeCloseTo(byNumber.center[0], 9);
      expect(byPadding.center[1]).toBeCloseTo(byNumber.center[1], 9);
      expect(byPadding.zoom).toBeCloseTo(byNumber.zoom, 9);
    });

    it("a right-only reservation (a right-docked panel) shifts the fitted center EAST, same direction paddedStudyAreaCenter uses", () => {
      const shifted = boundsToCameraView(bounds, viewport, {
        padding: { top: 0, right: 300, bottom: 0, left: 0 },
      });
      const unpadded = boundsToCameraView(bounds, viewport, { padding: 0 });
      expect(shifted.center[0]).toBeGreaterThan(unpadded.center[0]);
      expect(shifted.center[1]).toBeCloseTo(unpadded.center[1], 6);
    });

    it("a bottom-only reservation (a phone sheet) shifts the fitted center SOUTH, and still shrinks the available height for the zoom", () => {
      const shifted = boundsToCameraView(bounds, viewport, {
        padding: { top: 0, right: 0, bottom: 300, left: 0 },
      });
      const unpadded = boundsToCameraView(bounds, viewport, { padding: 0 });
      expect(shifted.center[1]).toBeLessThan(unpadded.center[1]);
      expect(shifted.zoom).toBeLessThan(unpadded.zoom);
    });

    it("is uncapped, monotonic — a fit's own (content-scaled) zoom already keeps the shift proportionate", () => {
      const at300 = boundsToCameraView(bounds, viewport, {
        padding: { top: 0, right: 300, bottom: 0, left: 0 },
      });
      const at200 = boundsToCameraView(bounds, viewport, {
        padding: { top: 0, right: 200, bottom: 0, left: 0 },
      });
      expect(at300.center[0]).toBeGreaterThan(at200.center[0]);
    });
  });
});

// R3-A1: the inverse of boundsToCameraView -- "what bbox does this camera show". Used to derive a
// fallback "study area as a box" for the species lens' wide-range framing (data/camera.ts's own
// STUDY_AREA_REFERENCE_VIEWPORT-tagged tests), since boot.study_areas publishes a camera, not an
// extent.
describe("cameraViewToBounds", () => {
  it("round-trips through boundsToCameraView at the SAME viewport (no padding)", () => {
    const view = { lon: -101.304, lat: 46.9, zoom: 2.16 };
    const bounds = cameraViewToBounds(view, STUDY_AREA_REFERENCE_VIEWPORT);
    const back = boundsToCameraView(bounds, STUDY_AREA_REFERENCE_VIEWPORT);
    expect(back.center[0]).toBeCloseTo(view.lon, 6);
    expect(back.center[1]).toBeCloseTo(view.lat, 6);
    expect(back.zoom).toBeCloseTo(view.zoom, 6);
  });

  it("a higher zoom yields a NARROWER bbox for the same center/viewport", () => {
    const lo = cameraViewToBounds({ lon: 0, lat: 0, zoom: 2 }, STUDY_AREA_REFERENCE_VIEWPORT);
    const hi = cameraViewToBounds({ lon: 0, lat: 0, zoom: 4 }, STUDY_AREA_REFERENCE_VIEWPORT);
    expect(hi[1][0] - hi[0][0]).toBeLessThan(lo[1][0] - lo[0][0]);
  });

  it("the west edge may go below -180 (a continuous, never re-wrapped frame)", () => {
    // the FULL study area's own preset, at the reference viewport, is wide enough at zoom 2.16
    // that its west edge crosses the antimeridian -- this is the exact case
    // studyAreaBboxFallback (species lens) must hand onward without wrapping it back into range.
    const bounds = cameraViewToBounds(
      { lon: -101.304, lat: 46.9, zoom: 2.16 },
      STUDY_AREA_REFERENCE_VIEWPORT,
    );
    expect(bounds[0][0]).toBeLessThan(-180);
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

  it("a bigger reservation shifts the center further, monotonically, uncapped", () => {
    const small = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, right: 50 });
    const big = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, right: 150 });
    const huge = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, right: 452 }); // a real "half" sheet's own bottom reservation, applied here to the right axis
    expect(big.lon - CENTER.lon).toBeGreaterThan(small.lon - CENTER.lon);
    expect(huge.lon - CENTER.lon).toBeGreaterThan(big.lon - CENTER.lon);
  });

  // P2 round 2 (orchestrator, real-build eyes-on, 2026-09-24): round 1 capped this shift at a flat
  // 200px, which turned out to be the WRONG fix (camera.ts's own `PHONE_STUDY_AREA_ZOOM_BOOST`
  // header has the measured proof: capping still left Canada/Greenland dominant on the real v7
  // build, at every latitude tried). This function is deliberately UNCAPPED now -- the caller
  // (`Shell.svelte`) is responsible for passing a zoom where a flat-Mercator shift is a fair
  // stand-in for the globe's own low-zoom rendering.
  it("is UNCAPPED — a huge bottom reservation shifts proportionally, not clamped", () => {
    const bottom300 = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, bottom: 300 });
    const bottom452 = paddedStudyAreaCenter(CENTER, ZOOM, { ...NO_PADDING, bottom: 452 });
    expect(CENTER.lat - bottom452.lat).toBeGreaterThan(CENTER.lat - bottom300.lat);
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

// R3-A2 (Ben, 2026-09-25, round-3 plan): "find an extent that includes at least the waters of the
// lower 48 and ideally a sliver of Alaska (hinting at extent coverage there)" -- P9's own fix (the
// tight northern-Gulf-of-Mexico box below) was correct but read as "one region of four" to
// reviewers. `PHONE_DEFAULT_BOUNDS` is now a wide CONUS + south-east-Alaska/Gulf-of-Alaska sliver
// bbox, chosen BY LOOKING at real builds (`scripts/eyes-shots.mjs`'s `map`/`layers` phone states) --
// see `camera.ts`'s own header for the full iteration log. Boosting `FALLBACK_FULL_STUDY_AREA`'s own
// centroid (central North Dakota, on the Canada border) and shifting it for chrome crops down to
// that SAME wrong neighbourhood (P9, live-verified on 0.10.48: Canada/the Great Lakes, 0% scored
// cells) -- `phoneDefaultCamera` fits a real, hand-picked bbox instead, same as before.
describe("phoneDefaultCamera / PHONE_DEFAULT_BOUNDS — the phone's DEFAULT first view", () => {
  // a realistic phone viewport + the SAME "half" detent padding chromePadding.ts's own tests use
  // (topbar 48, bottom = 46% of 844 + the rail row).
  const PHONE_VIEWPORT = { width: 390, height: 844 };
  const PHONE_HALF_PADDING = { top: 48, right: 0, bottom: 452, left: 0 };

  it("PHONE_DEFAULT_BOUNDS covers the Pacific coast and Florida/the Gulf, not the whole study area", () => {
    const [[west, south], [east, north]] = PHONE_DEFAULT_BOUNDS;
    // R3-A2 SECOND PASS (camera.ts's own header has the full measurement): west edge reaches the
    // Pacific coast (California/Oregon); east edge keeps Florida/the Gulf coast in frame but stops
    // short of the Northeast Atlantic (needed to clear the 10%-sky-band target); south/north
    // bracket the Gulf of Mexico up to the Pacific Northwest -- a regression here (e.g. narrowed
    // back to a single-region box, or widened back toward the full Alaska-Caribbean extent) is
    // caught by these bounds together with the region-content shot in the round-3 report.
    expect(west).toBeLessThan(-110); // reaches the Pacific coast
    expect(west).toBeGreaterThan(-135); // but well short of the Alaska hint (dropped this pass)
    expect(east).toBeLessThan(-70); // keeps Florida/the Gulf coast in frame
    expect(east).toBeGreaterThan(-85); // but well short of the whole Atlantic seaboard (also dropped)
    expect(south).toBeGreaterThan(15);
    expect(south).toBeLessThan(35);
    expect(north).toBeGreaterThan(40);
    expect(north).toBeLessThan(60);
  });

  it("computes a center near PHONE_DEFAULT_BOUNDS, nowhere near the old FALLBACK centroid (-101.3, 46.9)", () => {
    const fit = phoneDefaultCamera(PHONE_VIEWPORT, PHONE_HALF_PADDING);
    const [[west, south], [east, north]] = PHONE_DEFAULT_BOUNDS;
    // longitude: no left/right padding on phone, so the raw bbox midpoint is untouched.
    expect(fit.center[0]).toBeGreaterThanOrEqual(west);
    expect(fit.center[0]).toBeLessThanOrEqual(east);
    // latitude: `paddedStudyAreaCenter`'s own shift (folded into `boundsToCameraView` here) moves
    // the center SOUTH of the bbox's own midpoint on purpose -- a bottom-heavy sheet reservation
    // means the geographic content must sit in the visually SMALLER top portion, so the underlying
    // camera center is pushed toward (and, for a tall bottom reservation, past) the free area's own
    // south edge. A generous band, not the bbox's own bounds, is the honest invariant here.
    expect(fit.center[1]).toBeGreaterThan(south - 20);
    expect(fit.center[1]).toBeLessThan(north);
    // the OLD (broken) mechanism's own center, for contrast -- this must not be anywhere close (the
    // narrower R3-A2 second-pass bbox centres closer to it in longitude than the first pass did, so
    // this checks BOTH axes together rather than longitude alone, the same OR-of-two-axes shape
    // e2e/shell.firstview.phone.spec.ts's own "not the FALLBACK centroid" test uses).
    const dLon = Math.abs(fit.center[0] - -101.304);
    const dLat = Math.abs(fit.center[1] - 46.9);
    expect(dLon > 2 || dLat > 5).toBe(true);
  });

  // R3-A2 SECOND PASS: this narrower bbox (41 deg lon x 26 deg lat) is WIDTH-bound on a 390px
  // phone, and was deliberately narrowed further than the first pass to bring the sky band under a
  // 10% target (camera.ts's own header has the full measurement + the live screenshots). Its own
  // zoom is HIGHER than the first pass's ~1.97 but still clearly below a collapse toward P9's tight
  // single-region box (~4.9) -- this pins the computed zoom to the measured range, so a regression
  // toward the old whole-study-area bbox (zoom ~1.27), back toward the first-pass bbox (~1.97, too
  // much sky), or over-narrowed toward a tight single region (~4.9+) all go red.
  it("computes a zoom in the SECOND-PASS band, clear of both the first-pass bbox and a tight single-region collapse", () => {
    const fit = phoneDefaultCamera(PHONE_VIEWPORT, PHONE_HALF_PADDING);
    expect(fit.zoom).toBeGreaterThan(2.2);
    expect(fit.zoom).toBeLessThan(3.5);
  });

  it("is just boundsToCameraView(PHONE_DEFAULT_BOUNDS, ...) -- no separate math to drift out of sync", () => {
    const viaFn = phoneDefaultCamera(PHONE_VIEWPORT, PHONE_HALF_PADDING);
    const direct = boundsToCameraView(PHONE_DEFAULT_BOUNDS, PHONE_VIEWPORT, {
      padding: PHONE_HALF_PADDING,
    });
    expect(viaFn).toEqual(direct);
  });

  // the geometric claim the docs review asked for, checked directly rather than through
  // `boundsToCameraView` a second time: project the bbox's SOUTH and NORTH edges under the fit's
  // own {center, zoom} with the same plain Web-Mercator formula `boundsToCameraView` itself is
  // built from (this is an internal-consistency check of that pure function, not a claim about
  // MapLibre's globe render at this zoom — R3-A2's bbox computes zoom ~2.1, below the ~3 point
  // where flat Mercator and the globe projection are known to agree; the live screenshot, not this
  // math, is what proves the real render). RED on the old mechanism: projecting the SAME south edge
  // under `boostedForPhone`'s camera (center -101.304, lat 33.509, zoom 3.01 — the live-measured
  // broken values) lands it far below the free area, off the bottom of the whole viewport.
  function projectY(
    center: [number, number],
    zoom: number,
    lat: number,
    viewportHeight: number,
  ): number {
    const worldPx = 512 * 2 ** zoom;
    const latY = (y: number) =>
      0.5 - Math.log((1 + Math.sin(y)) / (1 - Math.sin(y))) / (4 * Math.PI);
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const centerY = latY(rad(center[1])) * worldPx;
    const pointY = latY(rad(lat)) * worldPx;
    return viewportHeight / 2 + (pointY - centerY);
  }

  it("both the bbox's south AND north edges project inside the free area (below the top bar, above the sheet)", () => {
    const fit = phoneDefaultCamera(PHONE_VIEWPORT, PHONE_HALF_PADDING);
    const southLat = PHONE_DEFAULT_BOUNDS[0][1];
    const northLat = PHONE_DEFAULT_BOUNDS[1][1];
    const sheetTop = PHONE_VIEWPORT.height - PHONE_HALF_PADDING.bottom;
    const ySouth = projectY(fit.center, fit.zoom, southLat, PHONE_VIEWPORT.height);
    const yNorth = projectY(fit.center, fit.zoom, northLat, PHONE_VIEWPORT.height);
    // R3-A2: this bbox is WIDTH-bound (63 deg lon on a 390px phone), unlike P9's tight box, which
    // was height-bound and so landed its south edge EXACTLY at the sheet top by construction. Here
    // both edges land comfortably inside the free area with real slack on both sides — the whole
    // bbox's own geography fits vertically, which is why the wider frame reads as "lower 48 +
    // Alaska hint" rather than a cropped sliver.
    expect(ySouth).toBeGreaterThan(PHONE_HALF_PADDING.top);
    expect(ySouth).toBeLessThan(sheetTop);
    expect(yNorth).toBeGreaterThan(PHONE_HALF_PADDING.top);
    expect(yNorth).toBeLessThan(sheetTop);
    expect(yNorth).toBeLessThan(ySouth); // north edge sits higher on screen than south
  });

  it("SEEDED-FAULT SHAPE: the OLD broken camera (measured live, 0.10.48) projects the SAME south edge below the sheet, off-frame", () => {
    const brokenCenter: [number, number] = [-101.304, 33.509];
    const brokenZoom = 3.01;
    const southLat = PHONE_DEFAULT_BOUNDS[0][1];
    const y = projectY(brokenCenter, brokenZoom, southLat, PHONE_VIEWPORT.height);
    const sheetTop = PHONE_VIEWPORT.height - PHONE_HALF_PADDING.bottom;
    expect(y).toBeGreaterThan(sheetTop); // off the bottom of the free area -- the bug this fixes
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
