// Shared hermetic fixtures/helpers for the species lens (atlas-5), used by BOTH
// e2e/species.smoke.spec.ts (the functional species-lens behaviour) and e2e/species.timing.spec.ts
// (the cold first-paint TIMING gate, split out per atlas-8's rule: a first-paint/first-frame timing
// gate runs alone in its own Playwright project, gated on the median of N >= 3 cold runs, never a
// single sample -- see playwright.config.ts's "timing" project and workflows' "atlas-8
// verification, accessibility, performance.md", 2026-09-21 handover). Not a `*.spec.ts` file, so
// Playwright never tries to run it as a test on its own -- same convention as e2e/hermetic.ts and
// e2e/map-hermetic.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { BUCKET, routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { safeRoute } from "./routeSafety";

// NOT a `declare global` augmentation of `Window.__atlasMap` — e2e/map.spec.ts already declares
// one, and TypeScript requires every declaration of the SAME global interface member to have an
// IDENTICAL type; a second, differently-shaped one is a compile error. This is a plain type, cast
// to at each call site instead (`window as unknown as { __atlasMap: AtlasMapForSpecies }`).
export interface AtlasMapForSpecies {
  handle: {
    map: {
      isSourceLoaded(id: string): boolean;
      getLayer(id: string): unknown;
      getCanvas(): HTMLCanvasElement;
      getCenter(): { lng: number; lat: number };
      project(lngLat: [number, number]): { x: number; y: number };
      loaded(): boolean;
    };
  };
}

/** the merged key's `|`/`:` as a real browser navigation bar would encode them — a literal `|` is
 * not a valid URI character (`page.goto` must not be handed one raw). */
export const LEATHERBACK_SP = encodeURIComponent("ms_merge|WORMS:137209");
export const WALRUS_AM_MDL_KEY = encodeURIComponent("am|ITS-Mam-180639");
/** `valid_usa: false` — the "US-only toggle falls back to the default" case's non-US taxon. */
export const WRYBILL_SP = encodeURIComponent("ms_merge|BOTW:22693928");

const FIXTURES = new URL("../tests/fixtures/species/", import.meta.url);
function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, FIXTURES)), "utf8"));
}

const STUDY_AREAS_V9 = readFixture("v9/study-areas.json");
const STUDY_AREAS_V7 = readFixture("v7/study-areas.json");
const DATASETS_V9 = readFixture("v9/datasets.json");
const DATASETS_V7 = readFixture("v7/datasets.json");

export function bootFor(ver: "v9" | "v7") {
  return {
    schema: 1,
    ver,
    grid_id: ver === "v9" ? "global05" : "usa05",
    grid:
      ver === "v9"
        ? { nc: 7200, nr: 3600, xmin: -180, ymax: 90, resx: 0.05, resy: 0.05, tile: { size: 50 } }
        : {
            nc: 3103,
            nr: 2006,
            xmin: 141.1,
            ymax: 74.75,
            resx: 0.05,
            resy: 0.05,
            lon360: true,
            tile: { size: 50 },
          },
    study_areas: ver === "v9" ? STUDY_AREAS_V9 : STUDY_AREAS_V7,
    units: [],
    datasets: ver === "v9" ? DATASETS_V9 : DATASETS_V7,
    // U6 (round 2): every fixture taxon here (leatherback/walrus/wrybill) publishes
    // `colormap: "spectral_r"` (tests/fixtures/species/v9/taxon/*.json) -- without a matching
    // `boot.palettes` entry, `paletteStopsFromBoot()` (src/lib/raster/ramps.ts) returns null and
    // `speciesMapInputs()` never builds a legend at all (no DOM node, not even an empty one --
    // SpeciesLegend.svelte has no fallback branch). None of the existing specs against this
    // fixture ever checked the legend's OWN presence (only `species-title-sci` etc.), so this gap
    // was invisible until e2e/tour.spec.ts's species walk asserted `[data-testid="species-legend"]`
    // directly. 11 real stops, copied from e2e/report-hermetic.ts's own BOOT_V9 fixture.
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
}

/** every `{ver}/app/**` shard this spec's fixtures cover, keyed by the path `dataUrl()` builds. */
const SHARD_FILES: Record<string, string> = {
  "v9/app/taxa.json": "v9/taxa.json",
  "v9/app/taxon/f9.json": "v9/taxon/f9.json",
  "v9/app/taxon/75.json": "v9/taxon/75.json",
  "v9/app/taxon/28.json": "v9/taxon/28.json",
  "v9/app/alias/f9.json": "v9/alias/f9.json",
  "v9/app/alias/9f.json": "v9/alias/9f.json",
  "v7/app/taxon/6f.json": "v7/taxon/6f.json",
  "v7/app/alias/6f.json": "v7/alias/6f.json",
  // V4 fix (owner phone report, 2026-09-24): the leatherback fixture (54241, mdl_seq) was already
  // on disk (`tests/fixtures/species/v7/{taxon,alias}/e1.json`) but never wired into this map --
  // `e2e/species.camera.spec.ts`'s V4 free-area-coverage test is the first to need it.
  "v7/app/taxon/e1.json": "v7/taxon/e1.json",
  "v7/app/alias/e1.json": "v7/alias/e1.json",
};

/** exported so a spec that needs to compose its OWN route order (e.g. registering a hung titiler
 * handler that must win over `gotoSpecies`'s own `routeTitilerTiles`) can call every other piece
 * of this setup without duplicating it — see species.smoke.spec.ts's hung-tile-fallback test. */
export async function routeSpeciesShards(page: Page) {
  await page.route(
    (url) => url.href.startsWith(BUCKET) && url.href.includes("/app/"),
    safeRoute((route) => {
      const path = route.request().url().slice(BUCKET.length);
      const file = SHARD_FILES[path];
      // NOT a known species shard path (e.g. app/boot.json) — fall through to routeBucket's
      // handler (registered BEFORE this one; Playwright tries routes newest-first, and
      // `fallback()` hands the request to the next-most-recently-registered matching route,
      // rather than this handler's own 404 shadowing routeBucket's real boot.json fixture).
      if (!file) return route.fallback();
      return route.fulfill({ status: 200, json: readFixture(file) });
    }),
  );
}

export async function gotoSpecies(page: Page, path: string, ver: "v9" | "v7" = "v9") {
  await blockWasm(page);
  await routeBucket(page, ver, bootFor(ver));
  await routeSpeciesShards(page);
  // e2e/hermetic.ts's VERSIONS_FIXTURE (routeBucket's versions.json) marks v9 restricted (matching
  // the live registry) — a PUBLIC (no-session) load of v9 is correctly DENIED by plan D6's access
  // gate and renders nothing at all (measured: this is what a first attempt at this spec, with
  // `routeSession(page, null)`, actually hit). A preview session is the honest way to view v9 here,
  // same as a real reviewer would; v7 is already public, so this session is simply unneeded for it.
  await routeSession(page, { preview: true, ver });
  await routeSealFixture(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(path);
  await waitForHydration(page);
}
