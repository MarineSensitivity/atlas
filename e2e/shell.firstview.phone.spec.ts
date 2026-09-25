// P2 (Opus 5.5 eyes-on assessment, 2026-09-24, atlas-refs/"2026-09-24 eyes-on UI assessment
// (Opus 5.5) on 15d6e4c.md"): at 390x844 the first view leaves ~100 CSS px of empty "sky" above
// the globe, because the panel/sheet-driven shift (`src/lib/map/camera.ts#paddedStudyAreaCenter`,
// wired once at map construction in Shell.svelte's `initialStudyArea`) was computed as flat
// Mercator math and fed straight into MapLibre's GLOBE projection -- a true 3D sphere at the low
// zoom a study-area preset uses, where a large shift (a half-open phone sheet reserves ~450px of
// an 844px viewport) rotates the sphere far more than a flat-Mercator "move N px" intends.
//
// ROUND 2 (orchestrator, real-v7-build eyes-on, 2026-09-24): round 1's fix here (capping the
// shift at a flat 200px) reduced the empty-sky gap on this hermetic fixture, but a real-build
// screenshot caught the DEEPER problem the cap never addressed: at the study area's own zoom
// (~2.16), MapLibre's globe projection renders the WHOLE sphere regardless of the shift, so the
// visible frame showed Canada/Greenland/Finland/Norway/Iceland, not the US. The fix is
// `PHONE_STUDY_AREA_ZOOM_BOOST` (camera.ts): raise the zoom BEFORE computing an (now uncapped)
// shift -- verified on the real build (`?map=` sweeps against live v7 data) to both frame CONUS
// properly AND close the empty-sky gap (a higher zoom renders a visually larger globe disc).
//
// The shared hermetic basemap fixture (`e2e/map-hermetic.ts#routeBasemapStyle`) deliberately
// paints `background` and `water` the SAME colour (for OTHER specs' blend-math assertions), so it
// cannot tell "the globe's own surface" apart from "the empty space around it" — a pixel probe
// against it cannot see this bug at all. This file registers its own two-colour basemap (black
// space, white water), the same low-level chain `routeBasemapStyle` itself uses, purely so a
// probed row can tell "still empty sky" from "the globe has started".
//
// P9 (Opus docs re-check appendix finding A2, live-verified on 0.10.48): round 2's own fix
// (`PHONE_STUDY_AREA_ZOOM_BOOST`) escaped the globe-sphere regime but never checked WHAT the
// (now correctly zoomed-in) frame actually showed -- boosting the zoom of the SAME
// `FALLBACK_FULL_STUDY_AREA` centroid (central North Dakota, on the Canada border) just crops down
// to that same wrong neighbourhood. Measured live against the production build with this exact
// method (`?map=` sweeps, real CARTO tiles): `lon -101.304, lat 33.509, zoom 3.01`, and the ENTIRE
// free area showed Canada/the Great Lakes -- 0% scored cells, 0% recognisable U.S. coast, despite
// test 1/2/3 below all passing (none of them ever asked WHAT was on screen, only "is it zoomed in"
// and "is the sky gap small"). `camera.ts#phoneDefaultCamera`'s own header has the full
// measurement, both broken and fixed, and why a real Gulf-of-Mexico/south-east-coast bbox fit
// replaces the boost-the-same-point approach.
//
// R3-A2 (Ben, 2026-09-25): P9's tight single-region box (~4.9-5.2 zoom, comfortably clear of the
// sky-gap floor) read as "one region of four" to reviewers. FIRST PASS: `PHONE_DEFAULT_BOUNDS`
// covered the lower 48's waters + a south-east-Alaska/Gulf-of-Alaska hint at `[[-128,24],[-65,52]]`
// -- width-bound on a 390px phone, zoom ~1.97, and the empty-space gap this file's own two-colour
// probe measures came out to ~141 CSS px (43.0% of the free area at the default "half" sheet
// detent, 22.7% at "peek"). That was accepted at the time as a deliberate trade against the OLD
// absolute-pixel ceiling (180px against the whole canvas) -- but expressed as a fraction of the
// space a viewer actually sees, it was closer to "roughly the top third of the free area is empty
// navy sky above the globe's rim" than the old header's own "~100 CSS px" framing suggested, and a
// real screenshot (`phone-02-map.png`) confirmed it reads that way.
//
// SECOND PASS (orchestrator, 2026-09-25, after reading that screenshot): measured directly, zoom in
// this WIDTH-bound regime does not depend on the sheet's bottom padding at all (confirmed: IDENTICAL
// zoom and IDENTICAL absolute gapPx at "half" and "peek", only the free area's own height differs),
// so the only lever that shrinks the sky band is narrowing the bbox's own longitude SPAN -- which
// directly trades away width, not degrees north-south. Measured the tradeoff directly rather than
// guessing from the zoom formula alone (a "cliff": span 43 measured 11.6%/6.1%, span 40 measured
// 4.6%/2.4% -- NOT smoothly proportional to zoom, because the specific pixel the probe first hits
// depends on exactly where land vs. ocean sits at that latitude/longitude, not zoom in isolation).
// `PHONE_DEFAULT_BOUNDS` is now `[[-119,25],[-78,51]]` (span 41, zoom ~2.59): keeps the Pacific
// coast and Florida/the Gulf in frame (both explicitly required), but a span this narrow cannot ALSO
// keep the Alaska hint (needs west out to ~-130) or the full Atlantic seaboard past the Carolinas
// (needs east out to ~-65) within the same 10%-sky budget -- both are the SAME lever (narrower
// width = higher zoom = less sky), so something had to give. Per the explicit fallback ("if the
// Alaska sliver cannot survive that, keep the full lower 48 with minimal sky and say so with the
// shot"): the Alaska hint is dropped; the Atlantic is ALSO trimmed north of roughly the Carolinas,
// a corollary of the same constraint the brief anticipated for Alaska specifically. Measured on
// this exact fixture: 7.0% at half detent, 3.7% at peek -- both comfortably under the 10% target.
// Tests 1, 2 and 4 below are updated to the new bbox/zoom/gap; test 3 (the old FALLBACK centroid is
// not what the camera frames near) is unchanged and still passes.
import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { routeGlyphs } from "./map-hermetic";
import { PHONE_DEFAULT_BOUNDS } from "../src/lib/map/camera";

const BOOT = {
  ver: "v7",
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  grid: { grid_id: "test05r" },
  release: { status: "release", access: "public" },
  units: [],
  zones: { programarea: [] },
  datasets: [],
  layers: [],
};

// the FALLBACK study area (src/lib/map/interaction.ts#FALLBACK_FULL_STUDY_AREA) -- what this
// fixture's boot (no `study_areas`) resolves to either way.
const FALLBACK = { lon: -101.304, lat: 46.9, zoom: 2.16 };

const WATER_TILE_PATH = fileURLToPath(new URL("./fixtures/map/basemap-water.pbf", import.meta.url));

/** background BLACK ("space"), water WHITE ("the globe's own surface") -- a real CARTO-shaped
 * minimal style, the same shape `map-hermetic.ts#basemapStyleFixture` uses, just with the two
 * layers given DIFFERENT colours instead of the same one. */
function twoColorStyle() {
  return {
    version: 8,
    sources: {
      carto: {
        type: "vector",
        url: "https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json",
      },
    },
    sprite: "https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite",
    glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#000000" } },
      {
        id: "water",
        type: "fill",
        source: "carto",
        "source-layer": "water",
        paint: { "fill-color": "#ffffff" },
      },
    ],
  };
}

async function routeTwoColorBasemap(page: Page) {
  const tile = readFileSync(WATER_TILE_PATH);
  await page.route(
    "https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json",
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tilejson: "3.0.0",
          tiles: [
            "https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt",
          ],
          vector_layers: [{ id: "water", minzoom: 0, maxzoom: 14, fields: {} }],
        }),
      }),
  );
  await page.route(
    "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(twoColorStyle()),
      }),
  );
  await page.route(
    "https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/v1/**",
    (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/x-protobuf", body: tile }),
  );
}

/** R3-A2 second pass (orchestrator, 2026-09-25, after reading `phone-02-map.png`): `detent`, when
 * given, is written to the sheet's own persisted localStorage key (`sheetGeometry.ts#
 * sheetStorageKey("shell")`) via `addInitScript` -- BEFORE the page's own inline bootstrap runs --
 * so `initialChromePadding()` (Shell.svelte) reads it as the STARTING detent, exactly as a real
 * visitor who last left the sheet at "peek" would. Unset, the sheet boots at its own default
 * ("half", `DEFAULT_SHEET_DETENT`) -- no localStorage write needed, matching every other test in
 * this file. */
async function gotoPhone(page: Page, path = "/", detent?: "peek" | "half" | "full") {
  if (detent) {
    await page.addInitScript((d) => window.localStorage.setItem("atlas.sheet.shell", d), detent);
  }
  await routeBucket(page, "v7", BOOT);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeTwoColorBasemap(page);
  await routeGlyphs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await waitForHydration(page);
  await page.waitForFunction(() => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap, {
    timeout: 15_000,
  });
  // let the globe's own tiles settle (map-hermetic's fixture answers instantly, but MapLibre still
  // needs a frame or two to composite and paint the globe geometry).
  await page.waitForTimeout(400);
}

/**
 * R3-A2 second pass: the sky-band gap, expressed as a PERCENT of the FREE area's own height (top
 * bar's bottom to the sheet's top -- not the whole canvas, which extends full-height BEHIND the
 * sheet). Same WebGL `readPixels` technique the original px-based probe used (black "space" vs.
 * white "water"), Y-flipped, scanning a column straight down the canvas' own horizontal centre --
 * but bounded to the free area's own bottom (the sheet top), because a pixel below that is covered
 * chrome, not empty sky, and would otherwise inflate the ratio for a tall-sheet detent.
 */
async function measureSkyBandPercent(page: Page): Promise<{ gapPx: number; percent: number }> {
  const topbarBox = await page.locator(".topbar").boundingBox();
  const sheetBox = await page.locator(".sheet").first().boundingBox();
  if (!topbarBox || !sheetBox) throw new Error("missing .topbar or .sheet box");
  const freeTop = topbarBox.y + topbarBox.height;
  const freeBottom = sheetBox.y;
  const freeHeight = freeBottom - freeTop;

  const gapPx = await page.evaluate(
    ({ freeTop, freeHeight }) => {
      const w = window as unknown as {
        __atlasMap: { handle: { map: { getCanvas(): HTMLCanvasElement } } };
      };
      const c = w.__atlasMap.handle.map.getCanvas();
      const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) return -1;
      const rect = c.getBoundingClientRect();
      const dpr = c.width / rect.width;
      const xDevice = Math.round((rect.width / 2) * dpr);
      const startCssY = Math.max(0, freeTop - rect.top);
      const endCssY = startCssY + freeHeight; // never scan past the free area's own bottom
      const px = new Uint8Array(4);
      for (let yCss = startCssY; yCss < endCssY; yCss += 1) {
        const yDevice = Math.round(yCss * dpr);
        gl.readPixels(xDevice, c.height - yDevice, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (px[0] > 40 || px[1] > 40 || px[2] > 40) return yCss - startCssY;
      }
      return freeHeight; // never found -- the whole free area stayed empty
    },
    { freeTop, freeHeight },
  );
  return { gapPx, percent: (gapPx / freeHeight) * 100 };
}

test.describe("P2: the phone first view frames the study area, not empty sky", () => {
  // P9 rewrite (this file's own header): what actually matters, and what test 2 below checks, is
  // WHERE the camera ends up, not merely how zoomed in it is. R3-A2 SECOND PASS: the final bbox is
  // width-bound and its own zoom (~2.59 measured) sits ABOVE the FALLBACK preset's zoom (2.16) --
  // raised specifically to bring the sky band under the 10% target (this file's own header has the
  // full measurement) -- but still clearly BELOW a collapse toward a single-region-tight fit
  // (P9's own ~4.9-5.2). This test pins the zoom to a band that distinguishes it from all three real
  // failure modes: the whole-study-area bbox (~1.27), the first-pass R3-A2 bbox (~1.97, too much
  // sky), and an over-narrowed collapse back toward a tight single region (~4.9+).
  test("the initial camera zoom sits in the SECOND-PASS band (raised for the 10% sky target)", async ({
    page,
  }) => {
    await gotoPhone(page);
    const zoom = await page.evaluate(() =>
      (
        window as unknown as { __atlasMap: { handle: { map: { getZoom(): number } } } }
      ).__atlasMap.handle.map.getZoom(),
    );
    expect(zoom).toBeGreaterThan(2.3); // clear of the first-pass bbox's own ~1.97 (too much sky)
    expect(zoom).toBeLessThan(3.5); // clear of a collapse toward a tight single-region fit (~4.9+)
  });

  // P9 rewrite: the OLD version of this test checked the `FALLBACK_FULL_STUDY_AREA` centroid
  // itself projected inside the free area -- which it did, right up until the bug: that centroid
  // (central North Dakota) is the thing that was WRONG, so a test built entirely around it could
  // never catch "wrong place, correctly framed". The reference point now is the bbox
  // `phoneDefaultCamera` actually fits (`PHONE_DEFAULT_BOUNDS`'s own center) -- real Gulf-of-
  // Mexico/south-east-coast geography, live-verified to show real scored cells and real coastline.
  test("the default view's own reference point (PHONE_DEFAULT_BOUNDS' center) projects INSIDE the free area (below the top bar, above the sheet)", async ({
    page,
  }) => {
    await gotoPhone(page);
    const [[west, south], [east, north]] = PHONE_DEFAULT_BOUNDS;
    const reference: [number, number] = [(west + east) / 2, (south + north) / 2];
    const pt = await page.evaluate((ll) => {
      const w = window as unknown as {
        __atlasMap: {
          handle: { map: { project(ll: [number, number]): { x: number; y: number } } };
        };
      };
      const p = w.__atlasMap.handle.map.project(ll);
      return { x: p.x, y: p.y };
    }, reference);

    const topbar = await page.locator(".topbar").boundingBox();
    const sheet = await page.locator(".sheet").first().boundingBox();
    expect(topbar, "no .topbar box").not.toBeNull();
    expect(sheet, "no .sheet box").not.toBeNull();

    // the free (unobscured) area is strictly between the top bar's bottom and the sheet's top.
    expect(pt.y).toBeGreaterThan(topbar!.y + topbar!.height);
    expect(pt.y).toBeLessThan(sheet!.y);
    // and not pinned against either edge — reasonably WITHIN the free area, not just barely inside.
    const freeHeight = sheet!.y - (topbar!.y + topbar!.height);
    const fraction = (pt.y - (topbar!.y + topbar!.height)) / freeHeight;
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.85);
  });

  // SEEDED-FAULT SHAPE (P9): the OLD `FALLBACK_FULL_STUDY_AREA` centroid itself -- central North
  // Dakota, the wrong anchor the bug shipped with -- must NOT be what a fixed camera frames. This
  // is the regression the retired mechanism could never have caught (it was built to keep this
  // point in frame, on purpose).
  test("the OLD (broken) FALLBACK centroid is NOT what the fixed camera frames near", async ({
    page,
  }) => {
    await gotoPhone(page);
    const center = await page.evaluate(() =>
      (
        window as unknown as {
          __atlasMap: { handle: { map: { getCenter(): { lng: number; lat: number } } } };
        }
      ).__atlasMap.handle.map.getCenter(),
    );
    const dLon = Math.abs(center.lng - FALLBACK.lon);
    const dLat = Math.abs(center.lat - FALLBACK.lat);
    expect(dLon > 5 || dLat > 5).toBe(true);
  });

  // R3-A2 SECOND PASS (orchestrator, 2026-09-25, after reading a real `phone-02-map.png`): the
  // first pass's absolute-pixel ceiling (180px against the whole canvas height) hid a real problem
  // it wasn't shaped to catch -- expressed as a fraction of the actual FREE area (not the whole
  // canvas, most of which sits behind the sheet), the sky band was roughly a THIRD to a HALF of the
  // free area's own height (measured 43.0% at half detent, 22.7% at peek, on the first R3-A2
  // bbox). `PHONE_DEFAULT_BOUNDS` was narrowed further (camera.ts's own header has the exact
  // numbers and the iteration log) to bring this under a 10% target at BOTH detents a real visitor
  // might have left the sheet at -- measured 7.0% at half, 3.7% at peek, on the FINAL bbox. Both
  // detents are checked because zoom in this width-bound regime does not depend on the bottom
  // padding (confirmed by measurement: identical zoom, identical absolute gapPx, at both detents),
  // so only the FREE AREA's own height differs between them, making "half" (the taller sheet, the
  // smaller free area, the tighter percent) the binding case -- but both are asserted so a future
  // change to either the padding formula or the bbox cannot silently regress the one not measured.
  for (const detent of ["half", "peek"] as const) {
    test(`the sky band stays <= 10% of the free area at the ${detent} detent`, async ({ page }) => {
      await gotoPhone(page, "/", detent);
      const canvas = page.locator("#map canvas").first();
      await expect(canvas).toBeVisible();
      const { gapPx, percent } = await measureSkyBandPercent(page);
      expect(gapPx, "gap between the top bar and the globe, in CSS px").toBeGreaterThanOrEqual(0);
      expect(
        percent,
        `sky band = ${percent.toFixed(1)}% of the free area (${gapPx}px)`,
      ).toBeLessThanOrEqual(10);
    });
  }
});
