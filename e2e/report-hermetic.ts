// Hermetic fixtures for `report.html`, extracted out of e2e/report.spec.ts (atlas-8 step 3) so a
// SECOND spec -- e2e/matrix.a11y.spec.ts, which audits the report alongside every scripts/verify.mjs
// matrix state -- reaches the same document through the same fixtures rather than a near-copy of
// them. Not a `*.spec.ts` file, so Playwright never runs it as a test on its own (same convention as
// e2e/hermetic.ts and e2e/map-hermetic.ts).
import type { Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession } from "./hermetic";
import { blockWasm, routeVariedBasemapStyle } from "./map-hermetic";

/** the restricted (preview-only) release fixture: two Program Areas with real published metrics, so
 * the Table of Scores carries real numbers (model.ts's own "Overall = mean of the components
 * PRESENT" rule is what e2e/report.spec.ts asserts against these). */
export const BOOT_V9 = {
  ver: "v9",
  built_at: "2026-09-05T00:00:00Z",
  msens: "0.43.0",
  id_field: "mdl_key",
  grid: { grid_id: "global05" },
  release: { status: "prerelease", access: "restricted" },
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "Gulf of America",
        n_cells: 14238,
        area_km2: 600000,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 50,
          extrisk_fish_ecoregion_rescaled: 30,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 40,
        },
      },
      {
        key: "ALA",
        name: "Alaska",
        n_cells: 45685,
        area_km2: 900000,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 55,
          extrisk_fish_ecoregion_rescaled: 20,
        },
      },
    ],
  },
  tables: { cell: { href: "https://example.test/v9/tables/cell.parquet", digest: "d-cell" } },
  datasets: [
    { ds_key: "a", name_display: "A Dataset", citation: "A. Author 2026.", sort_order: 1 },
  ],
  palettes: {
    spectral_r: [
      "#9E0142",
      "#D53E4F",
      "#F46D43",
      "#FDAE61",
      "#FEE08B",
      "#FFFFBF",
      "#E6F598",
      "#ABDDA4",
      "#66C2A5",
      "#3288BD",
      "#5E4FA2",
    ],
  },
};

/** the same content, published: `access: "public"`, so no PREVIEW banner/watermark. */
export const BOOT_V7 = {
  ...BOOT_V9,
  ver: "v7",
  release: { status: "release", access: "public" },
};

/** `z.pa.GAA,ALA` -- the g1 place codec's zone-place token, two Program Area keys. */
export const PL = "z.pa.GAA%2CALA";

export async function gotoReport(
  page: Page,
  opts: { ver: "v9" | "v7"; preview?: boolean; pl?: string },
) {
  await blockWasm(page);
  await routeBucket(page, opts.ver, opts.ver === "v9" ? BOOT_V9 : BOOT_V7);
  await routeSession(page, opts.preview ? { preview: true, ver: opts.ver } : null);
  await routeSealFixture(page);
  // fix round 2, item 6: `routeBucket()`'s own tile route (`routeMapTileOrigins()`, hermetic.ts) is
  // a FLAT, single-colour basemap -- fine for specs that never look at the captured map PNG, but
  // exactly the shape of the reviewer's bug (a flat, single-colour capture that a luminance-only
  // guard let through). `routeVariedBasemapStyle()` (map-hermetic.ts), registered AFTER
  // `routeBucket()` so it wins (Playwright: reverse registration order), swaps in a checkerboard
  // "water" fill -- every report.html capture in these specs is now of a REAL, varied basemap.
  await routeVariedBasemapStyle(page);
  const pl = opts.pl ?? PL;
  await page.goto(`/report.html?ver=${opts.ver}#pl=${pl}`);
}
