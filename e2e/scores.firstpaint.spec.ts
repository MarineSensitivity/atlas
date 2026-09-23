// atlas-4 step 1's gate: "the first-paint spec with **/*.wasm blocked: raster pixels at two ocean
// probe points, 20 Program-Area outlines, legend, default flower." Fully hermetic — every
// cross-origin request is routed to a fixture (docs/map.md's convention, `e2e/hermetic.ts`), and
// the zones PMTiles archive is a SEPARATE 20-feature fixture built for this spec (`e2e/fixtures/
// scores/zones20.{geojson,pmtiles}`) rather than the shared 4-feature one `e2e/map-hermetic.ts`
// already serves other specs, so this never contends with atlas-map's or another lens' fixture.
//
// atlas-4 fix round 2: runs this whole suite on BOTH v7 (public, the plain case) and v9 (the real
// release that broke the flower — `extrisk_primary_producer_ecoregion_rescaled` AND
// `primprod_ecoregion_rescaled` both published, folding onto one "primprod" category; see
// `src/lens/scores/flower.ts`'s `dedupeFlowerComponents`). v9 is `restricted` in
// `e2e/hermetic.ts`'s `VERSIONS_FIXTURE` (matching the live registry), so viewing it here needs a
// preview session — same as `e2e/species-hermetic.ts`'s `gotoSpecies` already does for the species
// lens, and for the same reason (measured: a public, no-session load of v9 is correctly DENIED by
// plan D6's access gate and renders nothing at all).
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
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
} from "./map-hermetic";

// atlas-8 step 2: widened from chromium-only to all three engines (measured green on all three).
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

const ZONES20_PATH = fileURLToPath(new URL("./fixtures/scores/zones20.pmtiles", import.meta.url));
// the SAME 20-feature fixture geometry serves both versions -- only the boot.json each version
// publishes differs for this spec's purposes, and the fixture's own URL literal is a test-only
// artifact (routeZones20 matches this exact string), never a real per-release bucket path.
const ZONES20_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v7/zones/programarea_2026-01/zones.pmtiles";

const COMPOSITE_KEY = "score_extriskspcat_primprod_ecoregionrescaled_equalweights";
const ZONE_KEYS = [
  "ALA", "ALB", "BFT", "BOW", "CEC", "CHU", "COK", "GAA", "GAB", "GEO",
  "GOA", "HAR", "HOP", "KOD", "MAT", "NAV", "NOC", "NOR", "SHU", "SOC",
]; // prettier-ignore

const SPECTRAL_R = [
  "#5E4EA1", "#3287BD", "#66C1A5", "#ABDDA4", "#E5F498", "#FFFFBF",
  "#FEDF8B", "#FDAD60", "#F36C43", "#D43E4E", "#9E0041",
]; // prettier-ignore

type Ver = "v7" | "v9";

/**
 * v9's real 17-key `layers` list (curl'd from the live
 * `v9/app/boot.json`, orchestrator-verified 2026-09-22) — only the composite carries a
 * `by_subregion` (the raster/legend probes below only ever look at the default, composite layer).
 */
const LAYERS_V9 = [
  { metric_key: "extrisk_bird", category: "raw", order: 1 },
  { metric_key: "extrisk_coral", category: "raw", order: 2 },
  { metric_key: "extrisk_fish", category: "raw", order: 3 },
  { metric_key: "extrisk_invertebrate", category: "raw", order: 4 },
  { metric_key: "extrisk_mammal", category: "raw", order: 5 },
  { metric_key: "extrisk_primary_producer", category: "raw", order: 6 },
  { metric_key: "extrisk_turtle", category: "raw", order: 7 },
  { metric_key: "extrisk_bird_ecoregion_rescaled", category: "component", order: 8 },
  { metric_key: "extrisk_coral_ecoregion_rescaled", category: "component", order: 9 },
  { metric_key: "extrisk_fish_ecoregion_rescaled", category: "component", order: 10 },
  { metric_key: "extrisk_invertebrate_ecoregion_rescaled", category: "component", order: 11 },
  { metric_key: "extrisk_mammal_ecoregion_rescaled", category: "component", order: 12 },
  { metric_key: "extrisk_primary_producer_ecoregion_rescaled", category: "component", order: 13 },
  { metric_key: "extrisk_turtle_ecoregion_rescaled", category: "component", order: 14 },
  { metric_key: "primprod", category: "raw", order: 15 },
  { metric_key: "primprod_ecoregion_rescaled", category: "component", order: 16 },
  {
    metric_key: COMPOSITE_KEY,
    label: "Equal-weight composite",
    category: "composite",
    order: 17,
    by_subregion: { FULL: { cog: SCORE_COG_URL, rescale: [0, 90] } },
  },
];

/** v9's real `flower_default.AK` (8 entries: both "primary producer" and the bare "primprod" —
 * the exact collision `dedupeFlowerComponents` must resolve to 7). */
const FLOWER_DEFAULT_V9_AK = [
  { component: "bird", score: 31.5829481713802 },
  { component: "coral", score: 16.7307766374964 },
  { component: "fish", score: 18.9728978214797 },
  { component: "invertebrate", score: 22.8381493804011 },
  { component: "mammal", score: 27.9090045093681 },
  { component: "primary producer", score: 15.5113319426193 },
  { component: "turtle", score: 18.3932458216487 },
  { component: "primprod", score: 5.63669830203109 },
];

function bootFor(ver: Ver) {
  const common = {
    schema: 1,
    ver,
    study_areas: [{ key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 }],
    units: [
      {
        fld: "programarea_key",
        label: "Program areas",
        pmtiles: ZONES20_URL,
        source_layer: "programarea",
      },
    ],
    palettes: { spectral_r: SPECTRAL_R },
  };
  if (ver === "v9") {
    return {
      ...common,
      grid: {
        grid_id: "global05",
        nc: 7200,
        nr: 3600,
        xmin: -180,
        ymax: 90,
        resx: 0.05,
        resy: 0.05,
        lon360: false,
        tile: { size: 50 },
      },
      layers: LAYERS_V9,
      zones: {
        programarea: ZONE_KEYS.map((key, i) => ({
          key,
          name: key,
          n_taxa: 100 + i,
          metrics: { [COMPOSITE_KEY]: 10 + i },
        })),
        // no FULL/USA subregion published on v9 (real shape) -- zoneAllKey() falls through to the
        // first available key, "AK", matching flower_default.AK below it.
        subregion: [{ key: "AK", name: "Alaska", n_taxa: 1, metrics: {} }],
      },
      flower_default: { AK: FLOWER_DEFAULT_V9_AK },
    };
  }
  return {
    ...common,
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
  };
}

/** the default flower's expected rounded hub value for each version -- v7's plain 3-component
 * mean, v9's real 8-entry `flower_default.AK` de-duplicated down to 7 before averaging. */
const EXPECTED_DEFAULT_HUB: Record<Ver, string> = {
  v7: "24", // (45.67+15.96+10.38)/3 = 24.00...
  v9: "22", // 7 kept of 8 (bare "primprod" dropped): mean ~= 21.705 -> 22
};

/** the default (composite) layer's own `label` in each version's `bootFor()` fixture above --
 * the floating legend's title (`ScoresLegend.svelte`/`mapInputs.ts`'s `scoresMapInputs().legend`). */
const EXPECTED_LEGEND_TITLE: Record<Ver, string> = {
  v7: "Overall score",
  v9: "Equal-weight composite",
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
          getLayer(id: string): unknown;
        };
        applyStyle(style: unknown): void;
      };
      composeStyle(input: Record<string, unknown>): unknown;
      inputs(): Record<string, unknown>;
    };
  }
}

async function gotoScoresMap(page: Page, ver: Ver) {
  await blockWasm(page);
  await routeBucket(page, ver, bootFor(ver));
  // v9 is `restricted` in VERSIONS_FIXTURE (matching the live registry) -- a public, no-session
  // load renders nothing (plan D6's access gate correctly denies it). A preview session is the
  // honest way to view it here, same as a real reviewer would; v7 is already public, so passing
  // `preview: true` for it too is harmless (a public release never checks the session either way).
  await routeSession(page, { preview: true, ver });
  await routeSealFixture(page);
  await routeZones20(page);
  await routeBasemapStyle(page);
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

for (const ver of ["v7", "v9"] as const) {
  test.describe(`scores lens — first paint with **/*.wasm blocked (atlas-4 step 1 gate), ${ver}`, () => {
    test("paints the score raster at two ocean probe points", async ({ page }) => {
      // two probes at up to 40s of polling each (below) can exceed Playwright's 30s default test
      // timeout on its own, independent of whether either poll actually needs the time -- widen
      // the TEST's own budget so a slow-but-still-passing poll is never truncated by the wrong
      // timer.
      test.setTimeout(90_000);
      const errors = collectConsoleErrors(page);
      const requests = collectRequests(page);
      await gotoScoresMap(page, ver);
      await page.waitForFunction(() => window.__atlasMap!.handle.map.loaded(), undefined, {
        timeout: 20_000,
      });

      // atlas-8 fix round 1 (root cause, replaces an earlier narrow Firefox-only skip that only
      // papered over the symptom): ScoresLens.svelte's OWN `$effect` computes the real raster
      // from `boot.layers` and applies it via Shell's composed-style effect -- exactly like
      // e2e/map.spec.ts's manually-injected raster, this call can land while
      // `map.isStyleLoaded()` is still false (the map's TRUE initial style, not yet settled) and
      // get QUEUED (`src/lib/map/styleQueue.ts`), flushing only on the next `"idle"` or its 4000ms
      // fallback. `map.loaded()` above says nothing about whether that queue has flushed yet --
      // reproduced on Firefox AND (once, under load) WebKit as a 40s pixel-poll timeout with the
      // BASEMAP colour still showing, i.e. the layer never having been added at all. Waiting for
      // the real layer to exist first (generous timeout, comfortably past the queue's fallback)
      // proves the queue has flushed before the pixel probe -- the fix is waiting on the right
      // signal, not a longer/looser pixel poll.
      await page.waitForFunction(
        () => !!window.__atlasMap!.handle.map.getLayer("r_lyr"),
        undefined,
        {
          timeout: 20_000,
        },
      );

      for (const [lon, lat] of OCEAN_PROBES) {
        await expect
          .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
            message: `no score raster pixel painted at ${lon},${lat}`,
            // atlas-8 step 2 (widened to all three engines): 20s was enough for v7 and for v9 run
            // ALONE, but the v9 case measured a reproducible timeout on Firefox specifically when
            // it runs as the 5th WebGL-heavy test in this file's own serial sequence (v7's four
            // tests, then v9's) -- Firefox's own GL-context teardown between successive test
            // pages is slower to settle than Chromium's/WebKit's here. 40s is the generous,
            // never-the-thing-that-fails number (tests/perf.ts's own PERF_TIMEOUT_MS philosophy);
            // the assertion itself is unchanged.
            timeout: 40_000,
          })
          .toBe(BLENDED_RASTER_RGB.join(","));
      }

      expect(requests.filter((u) => /\.wasm(\?|$)/.test(u))).toEqual([]);
      expect(requests.filter((u) => /duckdb/i.test(u))).toEqual([]);
      expect(errors).toEqual([]);
    });

    test("renders 20 Program-Area outlines", async ({ page }) => {
      await gotoScoresMap(page, ver);
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

    test("shows the FLOATING legend, with the layer title and exactly two rescale endpoints", async ({
      page,
    }) => {
      // atlas-4 defect fix: the scores lens used to have NO floating legend at all (only an
      // in-panel copy, visible only while the Layers tool happened to be open) -- clicking a
      // DIFFERENT tool first proves this no longer matters.
      await gotoScoresMap(page, ver);
      await page.getByRole("button", { name: "Flower plot" }).click();
      const legend = page.locator('[data-testid="scores-legend"]');
      await expect(legend).toBeVisible({ timeout: 10_000 });
      await expect(legend.locator("h2")).toHaveText(EXPECTED_LEGEND_TITLE[ver]);
      // the OTHER defect fix, pinned end-to-end here too: two endpoint labels, never one per stop.
      await expect(legend.locator(".ramp-ticks span")).toHaveCount(2);
      await expect(legend.locator(".ramp-ticks")).toContainText("0");
      await expect(legend.locator(".ramp-ticks")).toContainText("90");
    });

    test("shows the default flower (nothing selected, Tier 0 only)", async ({ page }) => {
      await gotoScoresMap(page, ver);
      await page.getByRole("button", { name: "Flower plot" }).click();
      const flower = page.locator(".flower-title");
      await expect(flower).toHaveText("Full study area", { timeout: 10_000 });
      // v7: mean of 3 fixture components. v9: `flower_default.AK`'s real 8 entries, de-duplicated
      // to 7 (the "primprod"/"primary producer" collision `dedupeFlowerComponents` resolves) —
      // proving the fix end-to-end, not just at the unit level.
      await expect(page.locator(".hub-text")).toHaveText(EXPECTED_DEFAULT_HUB[ver]);
    });
  });
}

test.describe("atlas-4 defect fix: the scores/species floating legend is ONE slot, keyed on sel.lens", () => {
  test("switching from Scores to Species swaps the floating legend (spec.md: one legend on screen at a time)", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    const scoresLegend = page.locator('[data-testid="scores-legend"]');
    await expect(scoresLegend).toBeVisible({ timeout: 10_000 });

    await page.locator(".topbar").getByRole("button", { name: "Species" }).click();
    await expect(scoresLegend).toHaveCount(0);
  });
});
