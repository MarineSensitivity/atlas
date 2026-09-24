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
// replaces the boost-the-same-point approach. Test 1 and 2 below are rewritten for the new
// mechanism (they could not stay green under it — see each one's own comment); test 3 is
// unchanged and still passes (the new zoom, ~4.9, is comfortably above the sky-gap floor too).
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

async function gotoPhone(page: Page, path = "/") {
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

test.describe("P2: the phone first view frames the study area, not empty sky", () => {
  // P9 rewrite (this file's own header): the invariant that survives is still true (the phone's
  // initial zoom is well above the FALLBACK preset's own low zoom), but it no longer proves the
  // MECHANISM that made it true -- `PHONE_STUDY_AREA_ZOOM_BOOST` is retired. What actually matters,
  // and what test 2 below checks, is WHERE the camera ends up, not merely how zoomed in it is.
  test("the initial camera zoom is well above the study-area preset's own zoom (escapes the globe-sphere regime)", async ({
    page,
  }) => {
    await gotoPhone(page);
    const zoom = await page.evaluate(() =>
      (
        window as unknown as { __atlasMap: { handle: { map: { getZoom(): number } } } }
      ).__atlasMap.handle.map.getZoom(),
    );
    expect(zoom).toBeGreaterThan(FALLBACK.zoom);
    expect(zoom).toBeGreaterThan(3.5); // the ~3 floor `camera.ts#phoneDefaultCamera`'s header names
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

  // the pixel-probe half of P2's own red-first instructions ("no empty sky … probe pixel rows"):
  // with `water` painted WHITE and `background` (space) painted BLACK, the first non-black row
  // below the top bar is where "the globe" visibly starts. Before the fix this gap measured ~100
  // CSS px; the cap must cut it substantially. WebGL `readPixels` (not `getContext("2d")`, which
  // cannot attach a SECOND context to a canvas MapLibre already owns as WebGL — `e2e/map.spec.ts`'s
  // own `readPixel` helper is the precedent this follows), Y-flipped (readPixels' origin is
  // bottom-left; screen/CSS y is top-left).
  test("no large blank band of 'space' between the top bar and the globe", async ({ page }) => {
    await gotoPhone(page);
    const topbarBox = await page.locator(".topbar").boundingBox();
    const canvas = page.locator("#map canvas").first();
    await expect(canvas).toBeVisible();

    const gapPx = await page.evaluate((topbarBottom) => {
      const w = window as unknown as {
        __atlasMap: { handle: { map: { getCanvas(): HTMLCanvasElement } } };
      };
      const c = w.__atlasMap.handle.map.getCanvas();
      const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) return -1;
      const rect = c.getBoundingClientRect();
      const dpr = c.width / rect.width;
      const xCss = rect.width / 2; // straight down the canvas' own horizontal center
      const xDevice = Math.round(xCss * dpr);
      const startCssY = Math.max(0, topbarBottom - rect.top);
      const px = new Uint8Array(4);
      for (let yCss = startCssY; yCss < rect.height; yCss += 1) {
        const yDevice = Math.round(yCss * dpr);
        gl.readPixels(xDevice, c.height - yDevice, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // "not black" = the globe's own white water fill has started (allow for AA blending).
        if (px[0] > 40 || px[1] > 40 || px[2] > 40) return yCss - startCssY;
      }
      return rect.height - startCssY; // never found — the whole probe stayed empty
    }, topbarBox!.y + topbarBox!.height);

    expect(gapPx, "gap between the top bar and the globe, in CSS px").toBeGreaterThanOrEqual(0);
    // measured on this exact fixture: 102px uncapped (MAX_STUDY_AREA_SHIFT_PX raised past any real
    // padding — the review's own "~100 CSS px", reproduced), 62px capped at 200. 80 sits between
    // the two with margin on both sides — comfortably below the red baseline (catches a regression
    // back toward it) and comfortably above the green measurement (not flaky on render jitter).
    expect(gapPx).toBeLessThan(80);
  });
});
