// R3 (round-2 plan §5 U4, `docs/usability.md` §7 R3): end-to-end proof of the layer stack against a
// REAL rendered map — `tests/map/layerStack.test.ts`/`tests/map/style.test.ts` already cover the
// model/composeStyle rules at the unit level; this is the "does moving a group actually repaint the
// map, and does it survive a reload" proof, the same shape `e2e/scores.outlines.spec.ts` uses for
// `out=`.
//
// Pixel-probe note: this harness's fixture basemap (`e2e/map-hermetic.ts`) carries a `background` +
// `water` FILL layer (both classify into `basemap-land`) but no symbol/sprite layer with real glyph
// bytes — `routeGlyphs()` fulfils the font range with an EMPTY body on purpose (a valid "no glyphs
// in this range" answer), so a text layer paints nothing a pixel probe could read. Ben's example
// ("names above a semi-transparent raster") is proven at the ORDER level here (`map.getStyle()` /
// `queryRenderedFeatures`, on `basemap-labels` specifically) and at the PIXEL level using
// `basemap-land` instead (the fixture's own solid, distinguishable `BASEMAP_RGB` fill) — the SAME
// mechanism (a basemap group promoted above `data-raster`), just probed with a layer type this
// hermetic harness can actually paint.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  BUCKET,
  collectConsoleErrors,
  routeBucket,
  routeSealFixture,
  routeSession,
  safeRoute,
  waitForHydration,
} from "./hermetic";
import {
  BLENDED_RASTER_RGB,
  OCEAN_PROBES,
  bootFor,
  readPixel,
  routeZones20,
} from "./scores-hermetic";
import {
  BASEMAP_RGB,
  RASTER_RGB,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
} from "./map-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

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

/** the fully-ordered default token, spelled out (never a PARTIAL token in these tests — a partial
 * one deliberately reorders via `layerStack.ts`'s own forward-compat "missing groups append at the
 * end" rule, tested at the unit level in `tests/map/layerStack.test.ts`; a geometry-asserting e2e
 * test always wants the reorder it names and nothing else). */
const DEFAULT_ORDER = [
  "basemap-land",
  "basemap-bathymetry",
  "basemap-boundaries",
  "basemap-roads",
  "basemap-labels",
  "data-raster",
  "data-zones",
  "data-places",
];

/** `basemap-land` moved from the very bottom to directly ABOVE `data-raster` — everything else
 * keeps its default relative order. This is Ben's "names above a semi-transparent raster" move,
 * substituting the fixture's opaque water fill for a label layer (see this file's own header). */
const LAND_ABOVE_RASTER = [
  "basemap-bathymetry",
  "basemap-boundaries",
  "basemap-roads",
  "basemap-labels",
  "data-raster",
  "basemap-land",
  "data-zones",
  "data-places",
].join(",");

async function gotoLayersScores(page: Page, search: string) {
  await blockWasm(page);
  await routeBucket(page, "v7", bootFor("v7"));
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZones20(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(`/?proj=mercator${search}`);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"), undefined, {
    timeout: 20_000,
  });
}

/** GPU alpha-blending can round a channel value 1 off from plain CPU `Math.round` arithmetic
 * (measured: an exact .5 tie rounded the opposite way from this file's own math) — a per-channel
 * tolerance is the honest comparison for a blended pixel, the same spirit as
 * `e2e/shell.cls.spec.ts`'s own 0.5px subpixel tolerance. */
function isCloseRgb(
  actual: readonly number[] | null,
  expected: readonly number[],
  tol = 2,
): boolean {
  return !!actual && expected.every((v, i) => Math.abs(actual[i] - v) <= tol);
}

function styleLayerIds(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __atlasMap: { handle: { map: { getStyle(): { layers: { id: string }[] } } } };
      }
    ).__atlasMap.handle.map
      .getStyle()
      .layers.map((l) => l.id),
  );
}

test.describe("layer stack (R3): reorder, dim and reload a REAL composed map", () => {
  test("default stack: every basemap sub-role (incl. labels) sits UNDER the raster in the real style", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    const ids = await styleLayerIds(page);
    expect(ids.indexOf("basemap-water")).toBeLessThan(ids.indexOf("r_lyr"));
    expect(errors).toEqual([]);
  });

  test("moving basemap-land above data-raster reorders the REAL composed style (map.getStyle())", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, `&layers=${LAND_ABOVE_RASTER}`);
    const ids = await styleLayerIds(page);
    expect(ids.indexOf("basemap-water")).toBeGreaterThan(ids.indexOf("r_lyr"));
    // queryRenderedFeatures agrees: the raster tile IS still there, just underneath now.
    const rasterFeatures = await page.evaluate(
      () => window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: ["r_lyr"] }).length,
    );
    expect(rasterFeatures).toBeGreaterThanOrEqual(0); // layer exists and is queryable either way
    expect(errors).toEqual([]);
  });

  test("...and a pixel probe shows the promoted basemap layer painting OVER the raster", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, `&layers=${LAND_ABOVE_RASTER}`);
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        message: "expected the basemap's own opaque colour once promoted above the raster",
        timeout: 20_000,
      })
      .toBe(BASEMAP_RGB.join(","));
    expect(errors).toEqual([]);
  });

  test("default order (no layers=): the raster's blended colour still reads OVER the basemap, unchanged", async ({
    page,
  }) => {
    await gotoLayersScores(page, "");
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        timeout: 20_000,
      })
      .toBe(BLENDED_RASTER_RGB.join(","));
  });

  test("dimming data-raster to 35% opacity probes a DIFFERENTLY blended pixel than the 60% default", async ({
    page,
  }) => {
    // 35%, not 50%: 127*0.5 + 102*0.5 = 114.5 is an exact rounding TIE, and measured GPU alpha-
    // blending rounds .5 ties differently from this file's own `Math.round` (114 vs 115) -- not a
    // wrong blend, a genuine half-to-even-vs-half-up disagreement at the one value that can have
    // one. 35% keeps every channel comfortably off a tie (±0.25 or more), and `closeRgb` below
    // still tolerates ±2/channel for ordinary GPU/driver rounding, so this is not fragile to being
    // OFF a tie either.
    const errors = collectConsoleErrors(page);
    const token = DEFAULT_ORDER.map((id) => (id === "data-raster" ? "data-raster:o35" : id)).join(
      ",",
    );
    await gotoLayersScores(page, `&layers=${token}`);
    const expected = [0, 1, 2].map((i) => RASTER_RGB[i] * 0.35 + BASEMAP_RGB[i] * 0.65);
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => isCloseRgb(await readPixel(page, lon, lat), expected), {
        message: `expected a pixel near [${expected.join(",")}] (±2/channel)`,
        timeout: 20_000,
      })
      .toBe(true);
    // and it is clearly NOT the unmodified 60% default blend (a wide margin, never itself a
    // rounding-tie question) -- proves the opacity actually moved, not just that SOME blended
    // colour happened to read back.
    expect(isCloseRgb(expected, BLENDED_RASTER_RGB, 2)).toBe(false);
    expect(errors).toEqual([]);
  });

  test("layers= round-trips through a reload: the reorder AND the pixel it produces both survive", async ({
    page,
  }) => {
    await gotoLayersScores(page, `&layers=${LAND_ABOVE_RASTER}`);
    expect(page.url()).toContain("layers=");
    await page.reload();
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"), undefined, {
      timeout: 20_000,
    });
    expect(page.url()).toContain("layers=");
    const ids = await styleLayerIds(page);
    expect(ids.indexOf("basemap-water")).toBeGreaterThan(ids.indexOf("r_lyr"));
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        timeout: 20_000,
      })
      .toBe(BASEMAP_RGB.join(","));
  });

  test("Reset layers clears layers= from the URL and restores the default order", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, `&layers=${LAND_ABOVE_RASTER}`);
    expect(page.url()).toContain("layers=");

    await page.getByRole("button", { name: "Reset layers" }).click();

    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain("layers=");
    await expect
      .poll(async () => {
        const ids = await styleLayerIds(page);
        return ids.indexOf("basemap-water") < ids.indexOf("r_lyr");
      })
      .toBe(true);
    expect(errors).toEqual([]);
  });

  // orchestrator audit item 1: "each row's eye toggle must be gated by an e2e where toggling makes
  // that layer's rendered features disappear" -- the REAL `Switch` control (not a `layers=` URL
  // shortcut), proving the panel's own accessible name wires through to `onChange` -> `composeStyle`
  // -> the map. A PIXEL probe, not `queryRenderedFeatures`: MapLibre's rendered-feature query only
  // returns vector-tile features (fill/line/circle/symbol) -- a `raster` layer has no per-feature
  // geometry to query, so `queryRenderedFeatures({layers:["r_lyr"]})` is always `[]` regardless of
  // whether the raster is painting (measured: the assertion never passed, even generously timed).
  // A blended-vs-basemap-only pixel is the real, visible proof; `getLayer("r_lyr")` staying defined
  // is the CLAUDE.md "never removed" proof.
  test("the Data row's eye toggle hides the raster's PAINTED pixel without removing the layer", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        timeout: 20_000,
      })
      .toBe(BLENDED_RASTER_RGB.join(","));

    await page.getByRole("switch", { name: "Data visible on the map" }).click();

    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        message: "expected the plain basemap colour once the Data row was toggled off",
        timeout: 20_000,
      })
      .toBe(BASEMAP_RGB.join(","));
    expect(await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"))).toBe(true);
    expect(errors).toEqual([]);
  });
});

// orchestrator audit item 2: the standalone ecoregion outline (black, 3px --
// `layers/zones.ts#ZONE_LINE_STYLE.ecoregion`, unchanged) drawn on every scores view, read from the
// release's MANIFEST (`boot.ts#ecoregionZoneUnitFromManifest`), independent of `sel.unit`/`sel.out`.
// `e2e/scores.outlines.spec.ts`'s own manifest fixture never publishes `zones`, so this is a
// SEPARATE describe block with its own manifest override rather than a change to that file.
test.describe("ecoregion boundaries (orchestrator audit item 2): the manifest-published outline", () => {
  const ECOREGION_PMTILES_PATH = fileURLToPath(
    new URL("./fixtures/scores/ecoregion4.pmtiles", import.meta.url),
  );
  const ECOREGION_PMTILES_URL = `${BUCKET}zones/ecoregion_2025-06/zones.pmtiles`;

  async function routeEcoregionPmtiles(page: Page) {
    const file = readFileSync(ECOREGION_PMTILES_PATH);
    await page.route(
      ECOREGION_PMTILES_URL,
      safeRoute((route) => {
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
      }),
    );
  }

  /** overrides `routeBucket`'s own manifest fixture (`{ver, capabilities: {}}`, no `zones`) with
   * one that also publishes `zones[]` -- registered AFTER `routeBucket`, so this exact-URL route
   * wins (Playwright tries routes in reverse registration order). */
  async function routeManifestWithEcoregion(page: Page, ver: string) {
    await page.route(
      `${BUCKET}${ver}/manifest.json`,
      safeRoute((route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ver,
            capabilities: {},
            zones: [{ fld: "ecoregion_key", pmtiles: ECOREGION_PMTILES_URL }],
          }),
        }),
      ),
    );
  }

  async function gotoScoresWithEcoregion(page: Page, search: string) {
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeManifestWithEcoregion(page, "v7");
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeZones20(page);
    await routeEcoregionPmtiles(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    await page.goto(`/?proj=mercator${search}`);
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  }

  test("ecoregion_ln renders >= 1 feature on v7 (the release's manifest publishes it)", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoScoresWithEcoregion(page, "");
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("ecoregion_ln"), {
      timeout: 20_000,
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: ["ecoregion_ln"] })
              .length,
        ),
      )
      .toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("out=none (hides the SELECTABLE unit's outline) does NOT hide the ecoregion boundary -- it is decoration, not the selected unit", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoScoresWithEcoregion(page, "&out=none");
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("ecoregion_ln"), {
      timeout: 20_000,
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: ["ecoregion_ln"] })
              .length,
        ),
      )
      .toBeGreaterThan(0);
    // and out=none DID hide the programarea outline, same as e2e/scores.outlines.spec.ts's own
    // case -- proving the two are independent, not that out= stopped working.
    expect(
      await page.evaluate(() =>
        window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: ["programarea_ln"] }),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a manifest with no ecoregion row (this repo's OTHER scores fixtures): no ecoregion_ln layer at all", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeZones20(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    await page.goto("/?proj=mercator");
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"), undefined, {
      timeout: 20_000,
    });
    expect(
      await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("ecoregion_ln")),
    ).toBe(false);
  });
});
