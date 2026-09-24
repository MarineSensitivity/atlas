// e2e/report.map.spec.ts -- P4 (Ben, phone, "Report" tool): "Report map is duplicated and seemingly
// empty or at least not zoomed to selected/drawn areas."
//
// TWO root causes, proven here against a PRODUCTION-SHAPED fixture (`units: []` pointing at a REAL
// PMTiles archive, the SAME one e2e/map.spec.ts's own zone-outline tests use -- no `label_pt` relied
// on, unlike e2e/report-hermetic.ts's own `BOOT_V9`, which the B1 audit note names as the exact gap
// that let this ship: "the gate passes because e2e/report-hermetic.ts ADDS label_pt to its
// fixture"):
//   1. `.map-print` (the static print/export snapshot) had no CSS hiding it on screen, so it sat
//      right below the live interactive map -- two map-shaped boxes, easy to read as "duplicated".
//   2. A zone place with no `label_pt` had NEITHER a point NOR a polygon (no published boot carries
//      `label_pt`) and was silently dropped from the map entirely -- `combinedBbox` had nothing to
//      fly to, so the camera never left its construction default. "Seemingly empty... not zoomed."
//
// The fix (reportMap.ts/Report.svelte): draw the zone place's REAL polygon from the release's own
// PMTiles (the same source the live Atlas already draws Program-Area outlines from), and fit the
// camera to its ACTUAL rendered extent -- fly wide to the full study area first (guaranteed to cover
// every unit's low-zoom tiles), query the rendered feature once the source settles, then fly to that
// real bbox. `Report.svelte` records the target box as `data-fitted-bounds` on `.map-live` and
// exposes `window.__reportMap` (the SAME test/automation seam `window.__atlasMap` already is for the
// main app), so this spec can assert the camera FIT rather than guessing from screenshots.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession } from "./hermetic";
import {
  blockWasm,
  routeVariedBasemapStyle,
  routeZonesPmtiles,
  ZONES_PMTILES_URL,
} from "./map-hermetic";
import { BOOT_V9, waitForMapCapture } from "./report-hermetic";

// GAA's real polygon, e2e/fixtures/map/zones.geojson (the source `zones.pmtiles` was built from):
// a 12 deg x 6 deg rectangle. Any camera that "fits" this place must contain it and stay close to
// it -- neither a tiny box around a label point nor the whole study area.
const GAA_BBOX = { west: -96, south: 24, east: -84, north: 30 };
const GAA_LON_SPAN = GAA_BBOX.east - GAA_BBOX.west;
const GAA_LAT_SPAN = GAA_BBOX.north - GAA_BBOX.south;

// P4: a production-shaped boot -- `units: []` (no test-only `label_pt` dependency) pointing at the
// SAME real PMTiles archive e2e/map.spec.ts's own zone tests use. GAA's `_prepctareaweighting` twin
// gives it ~99.5 % coverage -- ABOVE the new 99 % floor (scores.ts), so the OLD "< ~100 %" rule would
// have footnoted it and the new rule must not (part 2 of this same bug report, checked here too so
// one fixture proves both halves of the fix together, the way Ben actually saw them).
const BOOT = {
  ...BOOT_V9,
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "Gulf of America",
        n_cells: 14238,
        area_km2: 600000,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 50,
          extrisk_bird_ecoregion_rescaled_prepctareaweighting: 50.25, // coverage 50/50.25 ~= 99.50%
        },
      },
    ],
  },
  units: [
    {
      zone_set_key: "programarea_2026-01",
      fld: "programarea_key",
      label: "Program areas",
      pmtiles: ZONES_PMTILES_URL,
      source_layer: "programarea",
    },
  ],
};

// P4 follow-up (owner report, 0.10.43): Ben's own phone screenshot showed a footnote marker
// wrapping onto its OWN line under the score ("21" then "3" stacked) in the narrow "fish" column
// -- this repo's own p4-report-phone-scores-footnotes.png shot reproduced it exactly ("20" then
// "1"). BOOT_WRAP carries a SECOND component (fish) at ~88 % coverage specifically to trigger a
// footnote marker (BOOT above stays footnote-free on purpose, to prove the OTHER half of the
// original bug -- see its own header) -- this is the narrow-column, footnoted-cell fixture.
const BOOT_WRAP = {
  ...BOOT,
  zones: {
    programarea: [
      {
        ...BOOT.zones.programarea[0],
        metrics: {
          ...BOOT.zones.programarea[0].metrics,
          extrisk_fish_ecoregion_rescaled: 20,
          extrisk_fish_ecoregion_rescaled_prepctareaweighting: 22.66, // coverage ~= 88.3%
        },
      },
    ],
  },
};

// the map's public test/automation seam (Report.svelte's own header comment, mirroring
// Shell.svelte's `window.__atlasMap` -- e2e/map.spec.ts's OWN `declare global` for that, repeated
// verbatim per-file per this repo's convention, see e2e/scores-hermetic.ts's note on why).
declare global {
  interface Window {
    __reportMap?: {
      handle: {
        map: {
          queryRenderedFeatures(opts: { layers: string[] }): { geometry: { type: string } }[];
          getBounds(): {
            getWest(): number;
            getSouth(): number;
            getEast(): number;
            getNorth(): number;
          };
        };
      };
    };
  }
}

async function gotoZoneReport(page: Page, boot: object = BOOT) {
  await blockWasm(page);
  await routeBucket(page, "v9", boot);
  await routeSession(page, { preview: true, ver: "v9" });
  await routeSealFixture(page);
  await routeVariedBasemapStyle(page);
  await routeZonesPmtiles(page);
  await page.goto("/report.html?ver=v9#pl=z.pa.GAA");
}

for (const viewport of [
  { name: "phone (390x844)", width: 390, height: 844 },
  { name: "desktop (1280x800)", width: 1280, height: 800 },
]) {
  test.describe(`report map -- ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("exactly one visible map figure, the place's real polygon renders, and the camera fits its bbox", async ({
      page,
    }) => {
      await gotoZoneReport(page);
      await expect(page.locator(".progress-line")).toContainText("Done");

      // B1 part 1 -- the duplication: ONE <figure> in the DOM (always true), and on screen only the
      // live interactive map is visible; the static print/export snapshot is hidden (report.css).
      await expect(page.locator('section[aria-labelledby="s-map"] figure')).toHaveCount(1);
      await expect(page.locator(".map-live")).toBeVisible();
      await expect(page.locator(".map-print")).toBeHidden();

      // the whole mountMap() flow -- bounds fit, idle waits, the capture itself -- has finished.
      await waitForMapCapture(page);

      // B1 part 2 -- "seemingly empty": a REAL rendered feature on the zone polygon layer, not a
      // circle at an unpublished label point (this fixture carries none).
      const featureCount = await page.evaluate(
        () =>
          window.__reportMap!.handle.map.queryRenderedFeatures({
            layers: ["report-zone-fill-programarea"],
          }).length,
      );
      expect(featureCount).toBeGreaterThan(0);

      // the report's OWN record of the box it fit the camera to -- GAA's real extent, not the whole
      // study area and not a tiny box around a point (0.5 deg slack for tile-boundary clipping: GAA
      // straddles the antimeridian-relative x=90W tile seam at low zoom).
      const rawFitted = await page.locator(".map-live").getAttribute("data-fitted-bounds");
      expect(rawFitted).toBeTruthy();
      const fitted = JSON.parse(rawFitted!) as [[number, number], [number, number]] | null;
      expect(fitted).not.toBeNull();
      const [[fx0, fy0], [fx1, fy1]] = fitted!;
      expect(fx0).toBeLessThanOrEqual(GAA_BBOX.west + 0.5);
      expect(fy0).toBeLessThanOrEqual(GAA_BBOX.south + 0.5);
      expect(fx1).toBeGreaterThanOrEqual(GAA_BBOX.east - 0.5);
      expect(fy1).toBeGreaterThanOrEqual(GAA_BBOX.north - 0.5);

      // "not zoomed to selected/drawn areas": the REAL settled camera (map.getBounds()) contains
      // GAA and is not more than ~4x its extent wide -- the whole-study-area fallback (~80 deg lon)
      // would fail this by more than an order of magnitude, so this cannot pass by accident.
      const cam = await page.evaluate(() => {
        const b = window.__reportMap!.handle.map.getBounds();
        return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
      });
      expect(cam.west).toBeLessThanOrEqual(GAA_BBOX.west);
      expect(cam.south).toBeLessThanOrEqual(GAA_BBOX.south);
      expect(cam.east).toBeGreaterThanOrEqual(GAA_BBOX.east);
      expect(cam.north).toBeGreaterThanOrEqual(GAA_BBOX.north);
      expect(cam.east - cam.west).toBeLessThanOrEqual(GAA_LON_SPAN * 4);
      expect(cam.north - cam.south).toBeLessThanOrEqual(GAA_LAT_SPAN * 4);

      // part 2 of the same report -- ~99.5 % coverage is ABOVE the new 99 % floor: no footnote
      // marker anywhere, no footnote list at all (the OLD "< ~100 %" rule would have printed one).
      await expect(page.locator(".footnotes")).toHaveCount(0);
      await expect(page.locator('table[aria-describedby="scores-summary"] sup')).toHaveCount(0);
    });

    // P4 follow-up (owner report, 0.10.43): the score + its footnote marker must stay ONE inline
    // unit, never wrapping the marker onto its own line beneath the number in a narrow column.
    //
    // NOT a cell-height/boundingBox comparison: an HTML table row stretches EVERY cell to the
    // height of its tallest cell, so a wrapped cell's height is indistinguishable from its
    // neighbours' (measured directly -- a same-row "reference cell" comparison passed even against
    // the unfixed CSS, because every td.num in the row reports the SAME stretched height
    // regardless of whether ITS OWN content wrapped). What actually distinguishes "one line" from
    // "two lines" is `Range.getClientRects()` over the cell's own content: a `<sup>` sits a few px
    // HIGHER than its surrounding text even on the SAME line (`vertical-align: super`, measured
    // directly: a ~4-5px gap on both a genuinely one-line phone AND desktop cell) -- so the bar
    // is not "every rect shares one top" but "the SPREAD between the highest and lowest rect is
    // within a normal same-line offset". A real wrap (measured against the unfixed CSS before this
    // patch) put the marker a full line-height lower: an 18px gap at 390px, easily past this floor.
    const SAME_LINE_TOP_SPREAD_MAX_PX = 10;
    test("the footnote marker never wraps onto its own line under the score", async ({ page }) => {
      await gotoZoneReport(page, BOOT_WRAP);
      await expect(page.locator(".progress-line")).toContainText("Done");
      await waitForMapCapture(page);

      const table = page.locator('table[aria-describedby="scores-summary"]');
      const footnotedCell = table.locator("td.num", { has: page.locator("sup") }).first();
      await expect(footnotedCell).toBeVisible();
      await expect(footnotedCell.locator("sup")).toHaveCount(1);

      const rectTops = await footnotedCell.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return Array.from(range.getClientRects()).map((r) => Math.round(r.top));
      });
      const spread = Math.max(...rectTops) - Math.min(...rectTops);
      expect(
        spread,
        `cell content's line-box tops span ${spread}px (tops: ${rectTops.join(", ")}) -- the ` +
          `score and its footnote marker must render on ONE line, not the marker wrapped beneath it`,
      ).toBeLessThan(SAME_LINE_TOP_SPREAD_MAX_PX);
    });
  });
}
