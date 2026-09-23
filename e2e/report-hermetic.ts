// Hermetic fixtures for `report.html`, extracted out of e2e/report.spec.ts (atlas-8 step 3) so a
// SECOND spec -- e2e/matrix.a11y.spec.ts, which audits the report alongside every scripts/verify.mjs
// matrix state -- reaches the same document through the same fixtures rather than a near-copy of
// them. Not a `*.spec.ts` file, so Playwright never runs it as a test on its own (same convention as
// e2e/hermetic.ts and e2e/map-hermetic.ts).
import type { Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession } from "./hermetic";
import { blockWasm, routeVariedBasemapStyle, VARIED_DARK, VARIED_LIGHT } from "./map-hermetic";
import { PLACE_CIRCLE_OPACITY } from "../src/report/reportMap";

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
        // M4 (atlas-8 review round 2): a real `label_pt` so `zonePointFromBoot` resolves a place
        // for the report map -- without one, `places`/`place-labels` are EMPTY FeatureCollections
        // and the captured map is 100% basemap, which is exactly the "img visible" gate's blind
        // spot (nothing painted the DATA layer at all, and nothing here could have caught it).
        label_pt: [-90, 25],
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
        label_pt: [-155, 60], // M4: see GAA's own note
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

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blendOver(
  src: readonly [number, number, number],
  alpha: number,
  bg: readonly [number, number, number],
): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(src[i] * alpha + bg[i] * (1 - alpha))) as [
    number,
    number,
    number,
  ];
}

/**
 * M4 (atlas-8 review round 2): `.map-print img` used to be proven only by "is an `<img>` visible"
 * (`report.spec.ts`), which passes on the basemap alone -- `reportMap.ts#captureRejectionReason`
 * rejects a BLANK or FLAT capture, never one whose score-coloured places layer simply never
 * painted (an empty `places`/`place-labels` FeatureCollection, say). This reads the captured img's
 * real pixels back and counts how many match a colour ONLY a real place's score circle could have
 * painted -- proof the DATA layer, not just the basemap, is actually in the image. Kept alongside
 * `gotoReport` (not in `report.spec.ts`) so it stays paired with the ONE fixture (`BOOT_V9`) it is
 * computed from.
 *
 * GAA (overall `(50+30+40)/3 = 40`) and ALA (overall `(55+20)/2 = 37.5`) are, by construction,
 * exactly `BOOT_V9`'s `rampDomain` MAX and MIN (`src/lib/report/ramp.ts`) -- so each interpolates
 * to EXACTLY one `spectral_r` ramp ENDPOINT, never an intermediate blend a maplibre `interpolate`
 * expression would otherwise have to be replicated to predict. Each place draws as a CIRCLE
 * (`places-circle`, `PLACE_CIRCLE_OPACITY`), alpha-blended over whichever of
 * `routeVariedBasemapStyle`'s two checkerboard colours happens to be underneath -- both are
 * candidate backgrounds, since which one a given circle lands on is a map-projection detail this
 * helper does not need to reproduce (verified empirically: exact, tolerance-0 matches for 3 of the
 * 4 candidates against a real capture; the 4th is simply the colour combination neither place's
 * circle happened to land on in that camera position).
 */
export async function mapPrintRampPixelCount(page: Page, tolerance = 4): Promise<number> {
  const stops = BOOT_V9.palettes.spectral_r;
  const endpointColors = [hexToRgb(stops[0]), hexToRgb(stops[stops.length - 1])];
  const backgrounds: Array<[number, number, number]> = [VARIED_DARK, VARIED_LIGHT];
  const targets: Array<[number, number, number]> = [];
  for (const c of endpointColors) {
    for (const bg of backgrounds) targets.push(blendOver(c, PLACE_CIRCLE_OPACITY, bg));
  }
  return page.evaluate(
    ({ selector, targets, tolerance }) => {
      const img = document.querySelector(selector) as HTMLImageElement | null;
      if (!img || !img.naturalWidth) return -1;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return -1;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        for (const [tr, tg, tb] of targets) {
          if (
            Math.abs(r - tr) <= tolerance &&
            Math.abs(g - tg) <= tolerance &&
            Math.abs(b - tb) <= tolerance
          ) {
            count++;
            break;
          }
        }
      }
      return count;
    },
    { selector: ".map-print img", targets, tolerance },
  );
}
