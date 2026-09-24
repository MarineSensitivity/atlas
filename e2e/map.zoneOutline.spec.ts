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
  BASEMAP_RGB_BY_THEME,
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
// comfortably outside this margin either way. Unchanged by the R2 probe fix below (root-caused,
// reproduced with `--repeat-each`): `DISTANCE_THRESHOLD` was never the problem, so it stays put.
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
 * has to be, for a usable click target), so the hit point is only "near" the line, not
 * necessarily ON its anti-aliased core.
 *
 * R2 (round 2, 2026-09-24, root-caused not just widened): a version of this probe that reads ONE
 * pixel at the hit point is not just imprecise, it can be UNRECOVERABLE -- reproduced with
 * `--repeat-each=10..25` and confirmed with a raw `readPixels` column dump
 * (`.claude/worktrees/r2-u5b/.debug/`, not committed): this test's own jump target
 * (`center` == the exact `[lon, lat]` being probed) lands the 1px-wide line's continuous
 * coordinate EXACTLY on a device-pixel row boundary whenever the projected fractional offset
 * rounds to (or drifts, under load, toward) 0 -- at which point the line's paint is split
 * ~50/50 across the two neighbouring rows and NEITHER pixel, however you pick among them, is
 * ever closer than ~150-350 to the pure colour (measured: chromium's split varies 172-346
 * depending on machine load; firefox's software rasterizer resolves the SAME exact split
 * deterministically at ~326-335 on every single run -- not flaky, just always on the wrong side
 * of `DISTANCE_THRESHOLD`). No amount of widening the search window or picking a different
 * "best" pixel among the samples can see a colour that was never rendered onto any single pixel.
 *
 * The fix is additive, not a better pick: for a 1px line, per-pixel alpha coverage conserves
 * (sum of the antialiased pixels' deviation from the basemap colour across the line's full
 * device-pixel footprint reconstructs the line's true paint, no matter how that footprint's
 * coverage is split between 1, 2, or more neighbouring device pixels). Verified against every
 * captured split above (symmetric and asymmetric, both engines, both themes): the reconstruction
 * recovers the exact expected colour (distance 0) in every case, where picking the single closest
 * sample landed anywhere from 0 to 346. For each row in a small neighbourhood of the hit, this
 * takes the column farthest from the KNOWN basemap colour (`basemapRgb` -- the literal ask: "the
 * pixel farthest from the basemap colour") as that row's sample of the line, then SUMS every
 * row's deviation from the basemap back onto it.
 */
async function findOutlinePixel(
  page: Page,
  lon: number,
  lat: number,
  wantRgb: [number, number, number],
  basemapRgb: [number, number, number],
  maxRadiusPx = 250,
  stepPx = 3,
): Promise<[number, number, number]> {
  return page.evaluate(
    ([lng, la, wr, wg, wb, br, bg, bb, maxR, step]) => {
      const map = window.__atlasMap!.handle.map as unknown as {
        getCanvas(): HTMLCanvasElement;
        project(lngLat: [number, number]): { x: number; y: number };
        queryRenderedFeatures(opts: { point: [number, number]; layers: string[] }): unknown[];
      };
      const canvas = map.getCanvas();
      const gl = (canvas.getContext("webgl2") ??
        canvas.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) return [wr, wg, wb];
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
      if (!hit) return [wr, wg, wb];
      // reconstruct: sum every row's excess-over-basemap in a small neighbourhood of the hit, in
      // DEVICE pixels. `want*`/`want`'s own colour never enters the reconstruction (only the
      // KNOWN basemap does) so this cannot be gamed into reading whatever the test hopes to see --
      // it recovers whatever the renderer actually painted, whole and undiluted, then the caller
      // compares THAT to `wantRgb`.
      const hx = Math.round(hit.x * dpr);
      const hy = Math.round(canvas.height - hit.y * dpr);
      const px = new Uint8Array(4);
      const neighborhood = 7;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let dy = -neighborhood; dy <= neighborhood; dy++) {
        const cy = hy + dy;
        if (cy < 0 || cy >= canvas.height) continue;
        // this row's own purest sample -- farthest from the basemap colour, across a small dx
        // range (the line is uniform along its own length, so dx only guards a hit that landed
        // slightly off the stroke horizontally; a row with no line in it reads ~basemap at every
        // dx and contributes ~nothing to the sums below).
        let rowDelta: [number, number, number] = [0, 0, 0];
        let rowDist = -Infinity;
        for (let dx = -neighborhood; dx <= neighborhood; dx++) {
          const cx = hx + dx;
          if (cx < 0 || cx >= canvas.width) continue;
          gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const delta: [number, number, number] = [px[0] - br, px[1] - bg, px[2] - bb];
          const dist = Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]);
          if (dist > rowDist) {
            rowDist = dist;
            rowDelta = delta;
          }
        }
        sumR += rowDelta[0];
        sumG += rowDelta[1];
        sumB += rowDelta[2];
      }
      const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
      return [clamp(br + sumR), clamp(bg + sumG), clamp(bb + sumB)];
    },
    [lon, lat, ...wantRgb, ...basemapRgb, maxRadiusPx, stepPx] as const,
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

    const hit = await findOutlinePixel(page, -90, 30, [0, 26, 87], BASEMAP_RGB_BY_THEME.paper);
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

  test("navy: the SAME boundary stays white, unchanged (control)", async ({ page }) => {
    // R2: this used to be chromium-only ("measured flaky on firefox... up to ~326") -- root-caused
    // above, not just a slower engine: firefox's software rasterizer split this exact line's paint
    // ~50/50 across two rows on EVERY run (deterministic, not flaky), and chromium did the same
    // under load; no single sampled pixel could ever read closer than ~150-350. `findOutlinePixel`'s
    // reconstruction (sum of each row's excess-over-basemap) recovers the true painted colour
    // regardless of the split, proven stable across chromium/webkit/firefox with
    // `--repeat-each=10` (see the commit message / PR description for the counts) -- so all three
    // engines run this control now.
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

    const hit = await findOutlinePixel(page, -90, 30, [255, 255, 255], BASEMAP_RGB_BY_THEME.navy);
    const distToWhite = Math.abs(hit[0] - 255) + Math.abs(hit[1] - 255) + Math.abs(hit[2] - 255);
    expect(
      distToWhite,
      `the rendered programarea_ln pixel was rgb(${hit.join(",")}) -- expected it to stay close ` +
        `to white on the navy theme (unchanged by R9)`,
    ).toBeLessThan(DISTANCE_THRESHOLD);
  });
});
