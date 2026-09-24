// Shared hermetic fixtures/helpers for the scores lens (atlas-4/0.10.21), split out of
// e2e/scores.firstpaint.spec.ts so `gotoScoresMap`/`readPixel`/`OCEAN_PROBES`/`BLENDED_RASTER_RGB`
// can be reused by another spec (e2e/scores.collapsed-panel.spec.ts, 0.10.21 fix 1) without
// copy-pasting the whole v7/v9 boot-fixture apparatus -- same convention as e2e/species-hermetic.ts
// and e2e/map-hermetic.ts. Not a `*.spec.ts` file, so Playwright never tries to run it as a test on
// its own.
//
// The zones PMTiles archive is a SEPARATE 20-feature fixture built for this spec (`e2e/fixtures/
// scores/zones20.{geojson,pmtiles}`) rather than the shared 4-feature one `e2e/map-hermetic.ts`
// already serves other specs, so this never contends with atlas-map's or another lens' fixture.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import {
  BASEMAP_RGB,
  RASTER_RGB,
  SCORE_COG_URL,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
} from "./map-hermetic";

export const ZONES20_PATH = fileURLToPath(
  new URL("./fixtures/scores/zones20.pmtiles", import.meta.url),
);
// the SAME 20-feature fixture geometry serves both versions -- only the boot.json each version
// publishes differs for this spec's purposes, and the fixture's own URL literal is a test-only
// artifact (routeZones20 matches this exact string), never a real per-release bucket path.
export const ZONES20_URL =
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

export type Ver = "v7" | "v9";

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

// atlas-4 fix round 2 (owner-reported defect, 2026-09-24): the REAL live v7 `flower_default.FULL`
// shape — 8 components, "Other" included, full double precision — read directly off the
// production screenshot (docs/parity/shots/scores-flower-atlas.jpg). The previous 3-item stand-in
// (bird/fish/primprod, none of them small enough) never exercised the hub-occlusion defect
// (flowerGeometry.ts's header): Coral/Fish/Invertebrate/Other/Primary producer are all <= the
// hub's radius and were the exact petals the live bug painted over. Order matches the real
// release's own row order.
export const FLOWER_DEFAULT_V7_FULL = [
  { component: "bird", score: 45.6671707107685 },
  { component: "coral", score: 10.4494142116047 },
  { component: "fish", score: 15.9570514927416 },
  { component: "invertebrate", score: 14.7345085163167 },
  { component: "mammal", score: 41.668393775248 },
  { component: "other", score: 15.1784428369187 },
  { component: "turtle", score: 38.8176408891894 },
  { component: "primprod", score: 10.3787489146688 },
];

/** the SAME real 8 values as `FLOWER_DEFAULT_V7_FULL`, keyed as a zone's own
 * `*_ecoregion_rescaled` metrics (`zoneFlowerComponents`'s input shape, `flower.ts#fromMetrics`) —
 * gives `e2e/scores.flower.spec.ts` a real, non-default (a SELECTED zone's) flower to exercise the
 * same fix against, per this round's own instructions ("nothing selected... AND a selected zone").
 * Reusing the exact reported numbers keeps every fixture in this suite traceable to the one real
 * screenshot rather than inventing a second, unverified data shape. */
export const FLOWER_ZONE_METRICS_GAA = {
  extrisk_bird_ecoregion_rescaled: 45.6671707107685,
  extrisk_coral_ecoregion_rescaled: 10.4494142116047,
  extrisk_fish_ecoregion_rescaled: 15.9570514927416,
  extrisk_invertebrate_ecoregion_rescaled: 14.7345085163167,
  extrisk_mammal_ecoregion_rescaled: 41.668393775248,
  extrisk_other_ecoregion_rescaled: 15.1784428369187,
  extrisk_turtle_ecoregion_rescaled: 38.8176408891894,
  primprod_ecoregion_rescaled: 10.3787489146688,
};

export function bootFor(ver: Ver) {
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
      // GAA carries the SAME real 8-component values as the default flower (a selected zone's
      // own flower, `e2e/scores.flower.spec.ts`'s second case) -- every other zone keeps just the
      // composite, unchanged, so no existing spec's zone-metrics assumptions move.
      programarea: ZONE_KEYS.map((key, i) => ({
        key,
        name: key,
        n_taxa: 100 + i,
        metrics:
          key === "GAA"
            ? { [COMPOSITE_KEY]: 10 + i, ...FLOWER_ZONE_METRICS_GAA }
            : { [COMPOSITE_KEY]: 10 + i },
      })),
      subregion: [{ key: "FULL", name: "All US waters", n_taxa: 1, metrics: {} }],
    },
    flower_default: { FULL: FLOWER_DEFAULT_V7_FULL },
  };
}

/** the 20-feature scores fixture, with real HTTP range support (the `pmtiles://` protocol reads
 * the header, then the directory, then each tile with a `Range` header). */
export async function routeZones20(page: Page) {
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
// structurally identical) — this module only reads the `handle.map` slice, but the extra
// applyStyle/composeStyle/inputs members are declared anyway so the files cannot drift apart.
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

export async function gotoScoresMap(page: Page, ver: Ver, opts: { basemapDelayMs?: number } = {}) {
  await blockWasm(page);
  await routeBucket(page, ver, bootFor(ver));
  // v9 is `restricted` in VERSIONS_FIXTURE (matching the live registry) -- a public, no-session
  // load renders nothing (plan D6's access gate correctly denies it). A preview session is the
  // honest way to view it here, same as a real reviewer would; v7 is already public, so passing
  // `preview: true` for it too is harmless (a public release never checks the session either way).
  await routeSession(page, { preview: true, ver });
  await routeSealFixture(page);
  await routeZones20(page);
  await routeBasemapStyle(page, { styleJsonDelayMs: opts.basemapDelayMs });
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  // mercator, not the shipped globe default: a flat probe (e2e/map.spec.ts's own reason) — globe
  // warps where a fixed lon/lat lands at this zoom, which is irrelevant to "is the raster/zones
  // actually painted" and would make the probe assertion depend on globe's exact curvature math.
  await page.goto("/?proj=mercator");
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

export function readPixel(page: Page, lon: number, lat: number) {
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

export const OCEAN_PROBES: Array<[number, number]> = [
  [-90, 26], // Gulf of America
  [-125, 38], // off central California
];

/** the score raster paints at `SCORE_RASTER_OPACITY` (0.6, `layers/raster.ts`) OVER the basemap,
 * not at full opacity — this is the blended colour a real probe reads, and asserting it (rather
 * than the raw fixture colour) is what actually proves the opacity constant is wired through. */
export const BLENDED_RASTER_RGB = [0, 1, 2].map((i) =>
  Math.round(RASTER_RGB[i] * 0.6 + BASEMAP_RGB[i] * 0.4),
);
