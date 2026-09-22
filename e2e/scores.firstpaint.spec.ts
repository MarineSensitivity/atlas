// atlas-4 step 1's gate: "the first-paint spec with **/*.wasm blocked: raster pixels at two ocean
// probe points, 20 Program-Area outlines, legend, default flower." Fully hermetic — every
// cross-origin request is routed to a fixture (docs/map.md's convention, `e2e/hermetic.ts`), and
// the zones PMTiles archive is a SEPARATE 20-feature fixture built for this spec (`e2e/fixtures/
// scores/zones20.{geojson,pmtiles}`) rather than the shared 4-feature one `e2e/map-hermetic.ts`
// already serves other specs, so this never contends with atlas-map's or another lens' fixture.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  collectConsoleErrors,
  collectRequests,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";
import {
  BASEMAP_RGB,
  RASTER_RGB,
  SCORE_COG_URL,
  blockWasm,
  routeBasemapTiles,
  routeGlyphs,
  routeTitilerTiles,
} from "./map-hermetic";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

const ZONES20_PATH = fileURLToPath(new URL("./fixtures/scores/zones20.pmtiles", import.meta.url));
const ZONES20_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v7/zones/programarea_2026-01/zones.pmtiles";

const COMPOSITE_KEY = "score_extriskspcat_primprod_ecoregionrescaled_equalweights";
const ZONE_KEYS = [
  "ALA", "ALB", "BFT", "BOW", "CEC", "CHU", "COK", "GAA", "GAB", "GEO",
  "GOA", "HAR", "HOP", "KOD", "MAT", "NAV", "NOC", "NOR", "SHU", "SOC",
]; // prettier-ignore

const BOOT_SCORES_FIXTURE = {
  schema: 1,
  ver: "v7",
  grid: {
    grid_id: "usa05",
    nc: 3103,
    nr: 2006,
    xmin: 141.1,
    ymax: 74.75,
    resx: 0.05,
    resy: 0.05,
    lon360: true,
    tile: { size: 50 },
  },
  study_areas: [{ key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 }],
  units: [
    {
      fld: "programarea_key",
      label: "Program areas",
      pmtiles: ZONES20_URL,
      source_layer: "programarea",
    },
  ],
  layers: [
    {
      metric_key: COMPOSITE_KEY,
      label: "Overall score",
      category: "composite",
      order: 1,
      by_subregion: { FULL: { cog: SCORE_COG_URL, rescale: [0, 90] } },
    },
  ],
  zones: {
    programarea: ZONE_KEYS.map((key, i) => ({
      key,
      name: key,
      n_taxa: 100 + i,
      metrics: { [COMPOSITE_KEY]: 10 + i },
    })),
    subregion: [{ key: "FULL", name: "All US waters", n_taxa: 1, metrics: {} }],
  },
  flower_default: {
    FULL: [
      { component: "bird", score: 45.67 },
      { component: "fish", score: 15.96 },
      { component: "primprod", score: 10.38 },
    ],
  },
  palettes: {
    spectral_r: [
      "#5E4EA1", "#3287BD", "#66C1A5", "#ABDDA4", "#E5F498", "#FFFFBF",
      "#FEDF8B", "#FDAD60", "#F36C43", "#D43E4E", "#9E0041",
    ], // prettier-ignore
  },
};

/** the 20-feature scores fixture, with real HTTP range support (the `pmtiles://` protocol reads
 * the header, then the directory, then each tile with a `Range` header). */
async function routeZones20(page: Page) {
  const file = readFileSync(ZONES20_PATH);
  await page.route(ZONES20_URL, (route) => {
    const range = route.request().headers()["range"];
    const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
    if (!m) {
      return route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "accept-ranges": "bytes", "access-control-allow-origin": "*" },
        body: file,
      });
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : file.length - 1;
    return route.fulfill({
      status: 206,
      contentType: "application/octet-stream",
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${file.length}`,
        "access-control-allow-origin": "*",
      },
      body: file.subarray(start, end + 1),
    });
  });
}

// this ambient shape must match e2e/map.spec.ts's OWN `declare global` for `window.__atlasMap`
// byte-for-byte (TypeScript requires every repeated ambient declaration of the same global to be
// structurally identical) — this spec only reads the `handle.map` slice, but the extra
// applyStyle/composeStyle/inputs members are declared anyway so the two files cannot drift apart.
declare global {
  interface Window {
    __atlasMap?: {
      handle: {
        map: {
          isSourceLoaded(id: string): boolean;
          queryRenderedFeatures(opts: { layers: string[] }): unknown[];
          getCanvas(): HTMLCanvasElement;
          project(lngLat: [number, number]): { x: number; y: number };
          loaded(): boolean;
        };
        applyStyle(style: unknown): void;
      };
      composeStyle(input: Record<string, unknown>): unknown;
      inputs(): Record<string, unknown>;
    };
  }
}

async function gotoScoresMap(page: Page) {
  await blockWasm(page);
  await routeBucket(page, "v7", BOOT_SCORES_FIXTURE);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZones20(page);
  await routeBasemapTiles(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  // mercator, not the shipped globe default: a flat probe (e2e/map.spec.ts's own reason) — globe
  // warps where a fixed lon/lat lands at this zoom, which is irrelevant to "is the raster/zones
  // actually painted" and would make the probe assertion depend on globe's exact curvature math.
  await page.goto("/?proj=mercator");
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

function readPixel(page: Page, lon: number, lat: number) {
  return page.evaluate(
    ([lng, la]) => {
      const map = window.__atlasMap!.handle.map;
      const canvas = map.getCanvas();
      const gl = (canvas.getContext("webgl2") ??
        canvas.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) return null;
      const dpr = canvas.width / canvas.clientWidth;
      const p = map.project([lng, la]);
      const px = new Uint8Array(4);
      gl.readPixels(
        Math.round(p.x * dpr),
        Math.round(canvas.height - p.y * dpr),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        px,
      );
      return [px[0], px[1], px[2], px[3]];
    },
    [lon, lat] as const,
  );
}

const OCEAN_PROBES: Array<[number, number]> = [
  [-90, 26], // Gulf of America
  [-125, 38], // off central California
];

/** the score raster paints at `SCORE_RASTER_OPACITY` (0.6, `layers/raster.ts`) OVER the basemap,
 * not at full opacity — this is the blended colour a real probe reads, and asserting it (rather
 * than the raw fixture colour) is what actually proves the opacity constant is wired through. */
const BLENDED_RASTER_RGB = [0, 1, 2].map((i) =>
  Math.round(RASTER_RGB[i] * 0.6 + BASEMAP_RGB[i] * 0.4),
);

test.describe("scores lens — first paint with **/*.wasm blocked (atlas-4 step 1 gate)", () => {
  test("paints the score raster at two ocean probe points", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const requests = collectRequests(page);
    await gotoScoresMap(page);
    await page.waitForFunction(() => window.__atlasMap!.handle.map.loaded(), undefined, {
      timeout: 20_000,
    });

    for (const [lon, lat] of OCEAN_PROBES) {
      await expect
        .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
          message: `no score raster pixel painted at ${lon},${lat}`,
          timeout: 20_000,
        })
        .toBe(BLENDED_RASTER_RGB.join(","));
    }

    expect(requests.filter((u) => /\.wasm(\?|$)/.test(u))).toEqual([]);
    expect(requests.filter((u) => /duckdb/i.test(u))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("renders 20 Program-Area outlines", async ({ page }) => {
    await gotoScoresMap(page);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = window.__atlasMap!.handle.map;
            if (!map.isSourceLoaded("programarea_src")) return -1;
            return map.queryRenderedFeatures({ layers: ["programarea_ln"] }).length;
          }),
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(20);
  });

  test("shows the legend with the raster's rescale endpoints", async ({ page }) => {
    await gotoScoresMap(page);
    // "Layers" is already the shell's default rail tool, so no click is needed, but click it
    // anyway so this spec does not depend on that default staying true.
    await page.getByRole("button", { name: "Layers" }).click();
    const legend = page.locator(".legend");
    await expect(legend).toBeVisible({ timeout: 10_000 });
    await expect(legend.locator(".ramp-ticks")).toContainText("0");
    await expect(legend.locator(".ramp-ticks")).toContainText("90");
  });

  test("shows the default flower (nothing selected, Tier 0 only)", async ({ page }) => {
    await gotoScoresMap(page);
    await page.getByRole("button", { name: "Flower plot" }).click();
    const flower = page.locator(".flower-title");
    await expect(flower).toHaveText("Full study area", { timeout: 10_000 });
    // the centre number is the mean of the three fixture components, rounded: (45.67+15.96+10.38)/3
    await expect(page.locator(".hub-text")).toHaveText("24");
  });
});
