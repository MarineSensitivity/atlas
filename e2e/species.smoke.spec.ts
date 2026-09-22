// atlas-5: the species lens, on the REAL shell, fully hermetic — the same convention e2e/map.spec.ts
// already uses (routeBucket + map-hermetic's tile/wasm helpers). Fixtures are the REAL trimmed
// bundles already committed for the data-layer tests (tests/fixtures/species/**, see its README),
// reused here through page.route rather than re-typed.
//
// Chromium only, serial: this suite drives the same WebGL map e2e/map.spec.ts does (S2's numbers
// were only ever measured on headless Chromium/swiftshader — see that file's own header), plus a
// COLD-load timing gate that contention from a parallel engine matrix would make meaningless.
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
  blockWasm,
  routeBasemapTiles,
  routeGlyphs,
  routeTitilerTiles,
  routeZonesPmtiles,
} from "./map-hermetic";

// NOT a `declare global` augmentation of `Window.__atlasMap` — e2e/map.spec.ts already declares
// one, and TypeScript requires every declaration of the SAME global interface member to have an
// IDENTICAL type; a second, differently-shaped one is a compile error. This is a plain type, cast
// to at each call site instead (`window as unknown as { __atlasMap: AtlasMapForSpecies }`).
interface AtlasMapForSpecies {
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
const LEATHERBACK_SP = encodeURIComponent("ms_merge|WORMS:137209");
const WALRUS_AM_MDL_KEY = encodeURIComponent("am|ITS-Mam-180639");

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

const FIXTURES = new URL("../tests/fixtures/species/", import.meta.url);
function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, FIXTURES)), "utf8"));
}

const STUDY_AREAS_V9 = readFixture("v9/study-areas.json");
const STUDY_AREAS_V7 = readFixture("v7/study-areas.json");
const DATASETS_V9 = readFixture("v9/datasets.json");
const DATASETS_V7 = readFixture("v7/datasets.json");

function bootFor(ver: "v9" | "v7") {
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
  };
}

/** every `{ver}/app/**` shard this spec's fixtures cover, keyed by the path `dataUrl()` builds. */
const SHARD_FILES: Record<string, string> = {
  "v9/app/taxa.json": "v9/taxa.json",
  "v9/app/taxon/f9.json": "v9/taxon/f9.json",
  "v9/app/taxon/75.json": "v9/taxon/75.json",
  "v9/app/alias/f9.json": "v9/alias/f9.json",
  "v9/app/alias/9f.json": "v9/alias/9f.json",
  "v7/app/taxon/6f.json": "v7/taxon/6f.json",
  "v7/app/alias/6f.json": "v7/alias/6f.json",
};

const BUCKET = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/";

async function routeSpeciesShards(page: Page) {
  await page.route(
    (url) => url.href.startsWith(BUCKET) && url.href.includes("/app/"),
    (route) => {
      const path = route.request().url().slice(BUCKET.length);
      const file = SHARD_FILES[path];
      // NOT a known species shard path (e.g. app/boot.json) — fall through to routeBucket's
      // handler (registered BEFORE this one; Playwright tries routes newest-first, and
      // `fallback()` hands the request to the next-most-recently-registered matching route,
      // rather than this handler's own 404 shadowing routeBucket's real boot.json fixture).
      if (!file) return route.fallback();
      return route.fulfill({ status: 200, json: readFixture(file) });
    },
  );
}

async function gotoSpecies(page: Page, path: string, ver: "v9" | "v7" = "v9") {
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
  await routeBasemapTiles(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(path);
  await waitForHydration(page);
}

test.describe("species lens, first paint with **/*.wasm blocked", () => {
  test("a deep link (?sp=) paints the first species pixel within 2.5s cold, with zero wasm/duckdb requests", async ({
    page,
  }) => {
    const requests = collectRequests(page);
    const errors = collectConsoleErrors(page);
    const start = Date.now();
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);

    // The 2.5s BUDGET is enforced ONCE, below, by the wall-clock `elapsedMs` check — each poll
    // below gets a generous ceiling of its own so nobody's individual timeout is the artificial
    // bottleneck on a run that is genuinely on-budget end to end.
    await expect
      .poll(() => page.locator('[data-testid="species-panel"] [data-testid="layer-bar"]').count(), {
        message: "the layer bar never rendered — the taxon shard fetch is the first thing to check",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    // the actual first species PIXEL, not just the DOM: the raster layer must exist and its
    // source must be loaded before a probe at the map's own center can mean anything.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = (window as unknown as { __atlasMap: AtlasMapForSpecies }).__atlasMap.handle
              .map;
            return !!map.getLayer("species-raster") && map.isSourceLoaded("species-raster");
          }),
        { message: "the species raster layer/source never loaded", timeout: 10_000 },
      )
      .toBe(true);
    const pixel = await page.evaluate(() => {
      const map = (window as unknown as { __atlasMap: AtlasMapForSpecies }).__atlasMap.handle.map;
      const canvas = map.getCanvas();
      const gl = (canvas.getContext("webgl2") ??
        canvas.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) return null;
      const dpr = canvas.width / canvas.clientWidth;
      const c = map.getCenter();
      const p = map.project([c.lng, c.lat]);
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
      return [px[0], px[1], px[2]];
    });
    // the raster paints at SPECIES_RASTER_OPACITY (0.8) OVER the basemap — an alpha-blended pixel,
    // not the pure raster colour: round(raster*0.8 + basemap*0.2) per channel.
    const blended = RASTER_RGB.map((c, i) => Math.round(c * 0.8 + BASEMAP_RGB[i] * 0.2));
    expect(pixel).toEqual(blended);

    // The plan's own gate: "first species pixel <= 2.5s cold".
    const elapsedMs = Date.now() - start;

    console.log(`species lens cold first-pixel: ${elapsedMs} ms`);
    expect(elapsedMs).toBeLessThanOrEqual(2_500);

    // plan D3 Tier 0 / the atlas-5 gate: the DuckDB-WASM engine never starts in a species-only
    // session — structural, not aspirational (every .wasm byte is aborted by blockWasm() above;
    // this also proves the app never even TRIED to fetch one).
    expect(requests.filter((u) => /\.wasm(\?|$)/.test(u))).toEqual([]);
    expect(requests.filter((u) => /duckdb/i.test(u))).toEqual([]);
    expect(errors).toEqual([]);

    // the species title/card actually rendered the resolved taxon, not a placeholder
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");
  });

  test("switching species twice before the map's first idle leaves the SECOND species' raster in sources (fix round 1)", async ({
    page,
  }) => {
    // the exact race styleQueue.ts's unit regression test covers in isolation: two applyStyle
    // calls queued while the map's true initial style is still loading. Driven here through the
    // REAL app (window.__atlasSpecies.selectSpecies, exactly what the picker does) rather than a
    // fake, so a regression in the WIRING (not just the queue itself) would also show up here.
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await page.evaluate((walrusKey) => {
      (
        window as unknown as { __atlasSpecies: { selectSpecies: (k: string) => void } }
      ).__atlasSpecies.selectSpecies(walrusKey);
    }, "ms_merge|WORMS:137077");

    await expect
      .poll(() => page.getByTestId("species-title-sci").textContent(), { timeout: 10_000 })
      .toBe("Odobenus rosmarus");
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = (window as unknown as { __atlasMap: AtlasMapForSpecies }).__atlasMap.handle
              .map;
            return !!map.getLayer("species-raster") && map.isSourceLoaded("species-raster");
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    const sourceUrl = await page.evaluate(() => {
      const style = (
        window as unknown as {
          __atlasMap: { handle: { map: { getStyle(): { sources: Record<string, unknown> } } } };
        }
      ).__atlasMap.handle.map.getStyle();
      const source = style.sources["species-raster"] as { tiles?: string[] } | undefined;
      return source?.tiles?.[0] ?? null;
    });
    // walrus's merged COG (ms_merge_WORMS_137077.tif), never leatherback's stranded first request
    expect(sourceUrl).toContain("WORMS_137077");
    expect(sourceUrl).not.toContain("WORMS_137209");
  });

  test("an AquaX 'Delivered' (native) tile URL carries rescale=0,1000 (the AquaX gate)", async ({
    page,
  }) => {
    const requests = collectRequests(page);
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&in=ax&rep=native&ver=v9`);
    await expect
      .poll(() => requests.some((u) => u.includes("titiler-v8") && u.includes("rescale=0,1000")), {
        message: "no titiler request carried rescale=0,1000 for the AquaX Delivered layer",
        timeout: 10_000,
      })
      .toBe(true);
  });

  test("a struck-through pill is not focusable-as-button and carries the reason as its title", async ({
    page,
  }) => {
    // v7 walrus (mdl_seq 54383): both inputs publish zero assets — every pill besides the merged
    // one is struck-through.
    await gotoSpecies(page, "/?mdl_seq=54383&ver=v7", "v7");
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    const unavailable = page.locator('[data-testid="layer-pill"].unavailable').first();
    await expect(unavailable).toBeVisible();
    expect(await unavailable.evaluate((el) => el.tagName)).toBe("SPAN");
    expect(await unavailable.getAttribute("tabindex")).toBeNull();
    const title = await unavailable.getAttribute("title");
    expect(title).toContain("feeds the merged model");
    expect(title).toContain("nothing to draw");
  });

  test("?mdl_seq=<int> on v7 lands on the right taxon and input (the merged model)", async ({
    page,
  }) => {
    await gotoSpecies(page, "/?mdl_seq=54383&ver=v7", "v7");
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");
    // the URL is rewritten to sp= (canonical), mdl_seq dropped
    await expect.poll(() => page.url()).toContain("sp=54383");
    expect(page.url()).not.toContain("mdl_seq");
  });

  test("?mdl_key=am|... on v9 lands on the right taxon AND selects that input", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?mdl_key=${WALRUS_AM_MDL_KEY}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");
    await expect.poll(() => page.url()).toContain("sp=ms_merge");
    await expect.poll(() => page.url()).toContain("in=am");
    // the layer bar shows the INPUT variant (orange/is-input), not the merged one — the "no
    // merged-surface flash" guard (§11.12) means this must already be true at first render.
    await expect(page.locator(".layer-bar.is-input")).toHaveCount(1);
  });

  test("a range draws >= 1 rendered feature (the PMTiles branch, real vector data)", async ({
    page,
  }) => {
    // reuses atlas-map's own committed archive (e2e/fixtures/map/zones.pmtiles, a REAL 7 KB
    // tippecanoe build with working HTTP range support — building a fresh one-polygon archive
    // just for this gate would just re-prove tippecanoe works) under a species RANGE-style
    // filter: layer "programarea", key property "programarea_key", a real feature's key ("GAA").
    // This exercises the real `map/layers/ranges.ts` builders + composeStyle's "range" field
    // through REAL MapLibre vector-tile parsing — the same technique e2e/map.spec.ts's own
    // "renders a VECTOR feature" test uses for zones.
    const RANGE_URL = "https://file.marinesensitivity.org/pmtiles/v9/e2e-range-fixture.pmtiles";
    await routeZonesPmtiles(page, RANGE_URL);
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await page.waitForFunction(() => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap);

    await page.evaluate((url) => {
      const api = (
        window as unknown as {
          __atlasMap: {
            handle: { applyStyle(s: unknown): void };
            composeStyle: (i: unknown) => unknown;
            inputs: () => Record<string, unknown>;
          };
        }
      ).__atlasMap;
      api.handle.applyStyle(
        api.composeStyle({
          ...api.inputs(),
          range: {
            id: "species-range",
            pmtiles: url,
            sourceLayer: "programarea",
            keyProperty: "programarea_key",
            key: "GAA",
            fillColor: "#3388ff",
            opacity: 0.5,
          },
        }),
      );
    }, RANGE_URL);

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = (
              window as unknown as {
                __atlasMap: {
                  handle: {
                    map: {
                      isSourceLoaded(id: string): boolean;
                      queryRenderedFeatures(opts: { layers: string[] }): unknown[];
                    };
                  };
                };
              }
            ).__atlasMap.handle.map;
            if (!map.isSourceLoaded("species-range")) return -1;
            return map.queryRenderedFeatures({ layers: ["species-range"] }).length;
          }),
        {
          message: 'source/layer "species-range" never rendered a vector feature',
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0);
  });
});
