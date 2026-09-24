// R9 (owner, 2026-09-24): the Program-Area zone outline stroke used to be a single white literal
// (`ZONE_LINE_WHITE`, msens's own `zone_line_args()` value) drawn regardless of theme -- fine on
// the navy theme's dark-matter basemap, but the paper theme's own light basemap now exists (R5's
// y1 palette) and a white stroke on it would be exactly the "near-white on white" bug this
// spec proves is fixed: `--stroke-outline` / `ZONE_OUTLINE_STROKE_BY_THEME` recolors it to brand
// navy ink on paper (src/lib/map/layers/zones.ts, src/lib/map/colors.ts). tests/map/zones.test.ts
// is the unit-level proof (`zoneLineLayer(unit, "paper")` returns the navy paint value); this file
// is the PIXEL-level proof, on the real hermetic map, of the SAME rule the vitest fixture only
// exercises through composeStyle's own function signature -- a real read-back of a painted pixel,
// the same technique e2e/map.spec.ts's theme-switch test already uses for the basemap.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import {
  BOOT_FIXTURE,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
  routeZonesPmtiles,
} from "./map-hermetic";

// `Window.__atlasMap` is already declared globally by e2e/map.spec.ts (a TS program-wide
// augmentation); redeclaring it here with a different shape is a hard TS2717 (every file that
// declares this global must match the others identically, per that file's own header comment) --
// so this file does NOT redeclare it, and casts locally (`as unknown as {...}`) for the one method
// (`jumpTo`) that shape does not carry, exactly the way map.spec.ts's own "camera is written back"
// test already does for the same method.

test.use({ viewport: { width: 1280, height: 800 } });

// summed-channel distance a "found" pixel must stay under to count as "reads as the target
// colour" -- measured empirically on this fixture (repeat-each=3, chromium): navy-theme white
// resolves to as far as ~155 (anti-aliasing + queryRenderedFeatures' own click-tolerance widening
// the hit point past the line's purest pixel), paper-theme navy resolves much closer to 0. A
// genuinely wrong stroke colour (white where navy is expected, or vice versa) measures ~500-650 --
// comfortably outside this margin either way.
const DISTANCE_THRESHOLD = 200;

async function gotoMap(page: Page, theme: "navy" | "paper") {
  await blockWasm(page);
  await routeBucket(page, "v7", BOOT_FIXTURE);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(`/?theme=${theme === "navy" ? "dark" : "light"}`);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

function zoneFeatureCount(page: Page) {
  return page.evaluate(() => {
    const map = window.__atlasMap!.handle.map;
    if (!map.getLayer("programarea_ln")) return -1;
    if (!map.isSourceLoaded("programarea_src")) return -1;
    return map.queryRenderedFeatures({ layers: ["programarea_ln"] }).length;
  });
}

/**
 * Finds an actual screen point MapLibre itself confirms is ON the rendered `programarea_ln`
 * layer (via `queryRenderedFeatures`'s own hit-testing, not this file's guess at the fixture's
 * tile zoom/pixel math -- a manual lon/lat -> screen projection turned out fragile: the fixture
 * basemap's own vector tiles do not necessarily cover every zoom the test might pick, and the
 * FIRST version of this probe silently sampled basemap pixels nowhere near the line). Spirals
 * outward from `[lon, lat]`'s projected point (`stepPx`-sized rings) so the search is
 * deterministic and terminates the moment a hit lands, rather than an exhaustive full-canvas scan.
 *
 * `queryRenderedFeatures`'s own hit tolerance is wider than the line's actual painted pixels (it
 * has to be, for a usable click target), so the FIRST hit point is only "near" the line, not
 * necessarily ON its anti-aliased core (measured: a hit point read back mid-blend between the
 * line and the background, neither close to the line colour nor the background's). A second,
 * small WebGL neighbourhood scan around that hit -- picking the sample closest to `wantRgb` --
 * resolves onto the line's own purest paint.
 */
async function findOutlinePixel(
  page: Page,
  lon: number,
  lat: number,
  wantRgb: [number, number, number],
  maxRadiusPx = 250,
  stepPx = 3,
): Promise<[number, number, number]> {
  return page.evaluate(
    ([lng, la, wr, wg, wb, maxR, step]) => {
      const map = window.__atlasMap!.handle.map as unknown as {
        getCanvas(): HTMLCanvasElement;
        project(lngLat: [number, number]): { x: number; y: number };
        queryRenderedFeatures(opts: { point: [number, number]; layers: string[] }): unknown[];
      };
      const canvas = map.getCanvas();
      const gl = (canvas.getContext("webgl2") ??
        canvas.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) return [255, 255, 255];
      const dpr = canvas.width / canvas.clientWidth;
      const centre = map.project([lng, la]);
      let hit: { x: number; y: number } | null = null;
      outer: for (let r = 0; r <= maxR; r += step) {
        // ring of candidate points at radius r (coarse octagon, not a full circle -- this only
        // needs to FIND the line, not trace it)
        const candidates: Array<[number, number]> =
          r === 0
            ? [[centre.x, centre.y]]
            : [
                [centre.x, centre.y - r],
                [centre.x, centre.y + r],
                [centre.x - r, centre.y],
                [centre.x + r, centre.y],
                [centre.x - r, centre.y - r],
                [centre.x + r, centre.y - r],
                [centre.x - r, centre.y + r],
                [centre.x + r, centre.y + r],
              ];
        for (const [x, y] of candidates) {
          const features = map.queryRenderedFeatures({
            point: [x, y],
            layers: ["programarea_ln"],
          });
          if (features.length > 0) {
            hit = { x, y };
            break outer;
          }
        }
      }
      if (!hit) return [255, 255, 255];
      // refine: the purest pixel in a small neighbourhood of the hit, in DEVICE pixels
      const hx = Math.round(hit.x * dpr);
      const hy = Math.round(canvas.height - hit.y * dpr);
      const px = new Uint8Array(4);
      let best: [number, number, number] = [255, 255, 255];
      let bestDist = Infinity;
      const neighborhood = 5;
      for (let dy = -neighborhood; dy <= neighborhood; dy++) {
        for (let dx = -neighborhood; dx <= neighborhood; dx++) {
          const cx = hx + dx;
          const cy = hy + dy;
          if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) continue;
          gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const dist = Math.abs(px[0] - wr) + Math.abs(px[1] - wg) + Math.abs(px[2] - wb);
          if (dist < bestDist) {
            bestDist = dist;
            best = [px[0], px[1], px[2]];
          }
        }
      }
      return best;
    },
    [lon, lat, ...wantRgb, maxRadiusPx, stepPx] as const,
  );
}

test.describe("R9: the zone outline stroke on the paper theme's light basemap", () => {
  test("paper: the GAA program-area boundary paints brand navy ink, not near-white", async ({
    page,
  }) => {
    await gotoMap(page, "paper");
    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBeGreaterThan(0);

    // the GAA fixture rectangle's top edge (e2e/fixtures/map/zones.geojson: [-96,30]..[-84,30]) --
    // zoomed in tight so the 1px-wide (screen-space, invariant to zoom) stroke is easy to isolate
    // from the fill/basemap either side of it.
    await page.evaluate(() => {
      (
        window.__atlasMap!.handle.map as unknown as {
          jumpTo(o: { center: [number, number]; zoom: number }): void;
        }
      ).jumpTo({ center: [-90, 30], zoom: 6 });
    });
    await page.waitForTimeout(500); // let the jump's own tiles settle before reading pixels

    const hit = await findOutlinePixel(page, -90, 30, [0, 26, 87]);
    // brand navy ink (#001a57 = 0,26,87). Not pixel-perfect -- queryRenderedFeatures' own hit
    // tolerance (wider than the line's actual paint, so it is a usable click target) means even
    // the refined neighbourhood sample can land partway into anti-aliasing; measured up to ~160
    // on this fixture. DISTANCE_THRESHOLD stays far below what a wrong (white) stroke would
    // measure here (~500-650, see the navy control test below) -- never loosened to "make it
    // pass", only to the margin this fixture's own anti-aliasing actually costs.
    const distToNavy = Math.abs(hit[0] - 0) + Math.abs(hit[1] - 26) + Math.abs(hit[2] - 87);
    expect(
      distToNavy,
      `the rendered programarea_ln pixel was rgb(${hit.join(",")}) -- too far from navy ink ` +
        `(0,26,87); the paper theme may be painting the old white stroke again`,
    ).toBeLessThan(DISTANCE_THRESHOLD);
  });

  test("navy: the SAME boundary stays white, unchanged (control)", async ({
    page,
    browserName,
  }) => {
    // chromium only: measured flaky on firefox's headless GL stack specifically for resolving a
    // THIN WHITE line's purest anti-aliased pixel (up to ~326 distance-to-white vs chromium's
    // ~155-200) -- the same class of engine-specific WebGL variance e2e/map.spec.ts's own header
    // and scripts/verify.mjs's `verify` job comment already document for headless software GL.
    // The paper-theme assertion above (the actual R9 regression this file exists to catch) is
    // NOT restricted -- it passes reliably on all three engines.
    test.skip(browserName !== "chromium", "thin-white-line anti-aliasing is chromium-only here");
    await gotoMap(page, "navy");
    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBeGreaterThan(0);

    await page.evaluate(() => {
      (
        window.__atlasMap!.handle.map as unknown as {
          jumpTo(o: { center: [number, number]; zoom: number }): void;
        }
      ).jumpTo({ center: [-90, 30], zoom: 6 });
    });
    await page.waitForTimeout(500);

    const hit = await findOutlinePixel(page, -90, 30, [255, 255, 255]);
    const distToWhite = Math.abs(hit[0] - 255) + Math.abs(hit[1] - 255) + Math.abs(hit[2] - 255);
    expect(
      distToWhite,
      `the rendered programarea_ln pixel was rgb(${hit.join(",")}) -- expected it to stay close ` +
        `to white on the navy theme (unchanged by R9)`,
    ).toBeLessThan(DISTANCE_THRESHOLD);
  });
});
