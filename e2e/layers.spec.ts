// R3 (round-2 plan §5 U4, `docs/usability.md` §7 R3): end-to-end proof of the layer stack against a
// REAL rendered map — `tests/map/layerStack.test.ts`/`tests/map/style.test.ts` already cover the
// model/composeStyle rules at the unit level; this is the "does moving/hiding/dimming a group
// actually repaint the map, and does it survive a reload" proof, the same shape
// `e2e/scores.outlines.spec.ts` uses for `out=`.
//
// M11 fix (Opus 5.5 review): this header used to claim an ORDER-level proof "on basemap-labels
// specifically" that did not exist — the actual test below moves `basemap-land`, not
// `basemap-labels`, at BOTH the order and pixel level (corrected here).
//
// Pixel-probe note: this harness's fixture basemap (`e2e/map-hermetic.ts`) carries a `background` +
// `water` FILL layer (both classify into `basemap-land`) but no symbol/sprite layer with real glyph
// bytes — `routeGlyphs()` fulfils the font range with an EMPTY body on purpose (a valid "no glyphs
// in this range" answer), so a text layer paints nothing a pixel probe could read. Ben's example
// ("names above a semi-transparent raster") is proven here at BOTH the ORDER level (`map.getStyle()`)
// and the PIXEL level using `basemap-land` instead of `basemap-labels` (the fixture's own solid,
// distinguishable `BASEMAP_RGB` fill) — the SAME mechanism (a basemap group promoted above
// `data-raster`), just probed with a layer type this hermetic harness can actually paint.
//
// M8 fix (Opus 5.5 review): `main`'s default theme is now DARK (`DEFAULT_SEL.theme`), not "auto"
// resolving to paper — every `gotoLayersScores`/`gotoScoresWithEcoregion` navigation below passes
// `&theme=light` explicitly so the PAPER pixel expectations (`BASEMAP_RGB`, `BLENDED_RASTER_RGB`,
// both defined for the paper theme in `map-hermetic.ts`) still hold.
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
import { SCORE_RASTER_OPACITY } from "../src/lib/map/layers/raster";
import {
  BASEMAP_RGB,
  RASTER_RGB,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
} from "./map-hermetic";

/** the theme's flat background colour (`src/lib/map/colors.ts#MAP_BACKGROUND_PAPER`) — what shows
 * through once EVERY basemap layer (including `basemap-land`'s opaque water fill) is hidden. Not
 * imported directly (this file stays outside `src/lib/map` on purpose, matching every other e2e
 * fixture's own literal-colour convention, e.g. `map-hermetic.ts#BASEMAP_RGB`). */
const MAP_BACKGROUND_PAPER_RGB = [234, 238, 243];

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
  // M8 fix: explicit `theme=light` -- `main`'s default is now dark, and every pixel expectation in
  // this file assumes the PAPER fixture colours.
  await page.goto(`/?proj=mercator&theme=light${search}`);
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

  // M4 fix (Opus 5.5 review): this test used to also assert
  // `queryRenderedFeatures({layers:["r_lyr"]}).length >= 0` — VACUOUS (a `.length` is never
  // negative, so this could never fail regardless of what actually rendered). Deleted; the real,
  // non-vacuous proof that the raster is still there (just underneath) is the PIXEL probe in the
  // very next test, and `getLayer("r_lyr")` staying defined is asserted directly where it matters
  // (the eye-toggle test below).
  test("moving basemap-land above data-raster reorders the REAL composed style (map.getStyle())", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, `&layers=${LAND_ABOVE_RASTER}`);
    const ids = await styleLayerIds(page);
    expect(ids.indexOf("basemap-water")).toBeGreaterThan(ids.indexOf("r_lyr"));
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

  // B1 fix (Opus 5.5 review): the "Data" row's opacity SCALES the raster's own spec opacity
  // (`SCORE_RASTER_OPACITY`, 0.6) — it never replaces it. A 35%-opacity slider therefore reads
  // back a 0.6 x 0.35 = 0.21 final raster-opacity, NOT the bare 0.35 a replacing implementation
  // would have produced (this test's own math WAS "RASTER_RGB*0.35 + BASEMAP_RGB*0.65" before this
  // fix — i.e. it used to lock in the B1 bug at the e2e level too).
  test("dimming data-raster to 35% opacity probes a DIFFERENTLY blended pixel than the 60% default (SCALED, not replaced)", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const token = DEFAULT_ORDER.map((id) => (id === "data-raster" ? "data-raster:o35" : id)).join(
      ",",
    );
    await gotoLayersScores(page, `&layers=${token}`);
    const scaledOpacity = SCORE_RASTER_OPACITY * 0.35; // 0.6 x 0.35 = 0.21
    const expected = [0, 1, 2].map(
      (i) => RASTER_RGB[i] * scaledOpacity + BASEMAP_RGB[i] * (1 - scaledOpacity),
    );
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

  // M3 fix (Opus 5.5 review): "only the Data row's eye is pixel-proven" -- the three tests below
  // give the OTHER rows the same real, non-vacuous proof: a rendered-feature-count drop to exactly
  // 0 (never removed -- `getLayer` still resolves), or a pixel handoff to the next thing underneath.
  function zoneFeatureCount(page: Page, layerId = "programarea_ln") {
    return page.evaluate(
      (id) => window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: [id] }).length,
      layerId,
    );
  }

  test("M3: the Zone outlines row's eye hides programarea_ln's rendered features (>0 -> 0), never removes the layer", async ({
    page,
  }) => {
    // deliberately the DEFAULT `unit=cell` (never `unit=programarea`): `zoneUnitsFromBoot` always
    // draws the outline regardless of the selected spatial unit, and `gotoLayersScores` waits for
    // `r_lyr`, which only exists in cell mode (M5's own motivating issue: `raster: null` in zone
    // mode) -- this test only cares about the outline, so cell mode keeps the helper reusable.
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBeGreaterThan(0);

    await page.getByRole("switch", { name: "Zone outlines visible on the map" }).click();

    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBe(0);
    expect(await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("programarea_ln"))).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });

  test("M3: the Selection row's eye hides the picked cell's selection-line ring (>0 -> 0), never removes the layer", async ({
    page,
  }) => {
    // no collectConsoleErrors()/zero-console-errors assertion here (unlike the other M3 cases in
    // this file): a `sel=cell:` selection mounts ScoresLens.svelte's cell-flower `$effect`
    // (fetches the clicked cell's species composition through the real engine), which this
    // fixture deliberately blocks via `blockWasm()` -- caught by the effect's own `.catch()`
    // (`cellFlowerRows` -> null), but on chromium the underlying blocked fetch ALSO reaches the
    // page as an unhandled "TypeError: Failed to fetch" pageerror, independent of the caught
    // rejection. Same root cause, same convention as `e2e/scores.zonesTableHeader.spec.ts`'s own
    // comment (there it is firefox's "NetworkError..."); that noise is a property of the flower
    // panel's engine call, not of the Selection row's eye toggle this test asserts.
    // a real cell selection, framed on-screen (`queryRenderedFeatures` queries the CURRENT
    // viewport) -- the same cell/camera pair `scripts/verify.mjs`'s own "scores sel=cell:1500000"
    // state already uses, on this exact v7 grid.
    await gotoLayersScores(page, "&sel=cell:1500000&map=-156.375,50.575,8");
    const ringCount = (layerId: string) =>
      page.evaluate(
        (id) => window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: [id] }).length,
        layerId,
      );
    await expect.poll(() => ringCount("selection-line"), { timeout: 20_000 }).toBeGreaterThan(0);

    await page.getByRole("switch", { name: "Selection visible on the map" }).click();

    await expect.poll(() => ringCount("selection-line"), { timeout: 20_000 }).toBe(0);
    expect(await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("selection-line"))).toBe(
      true,
    );
  });

  test("M3: the Land & water row's eye hides the basemap fill, showing the theme's plain background colour through", async ({
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

    // hide BOTH the raster (so the basemap fill would otherwise be the topmost visible thing) AND
    // basemap-land, via the panel's own switches -- proving the BACKGROUND shows through once
    // nothing else paints, not merely "the pixel changed to something."
    await page.getByRole("switch", { name: "Data visible on the map" }).click();
    await page.getByRole("switch", { name: "Land & water visible on the map" }).click();

    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        message: "expected the theme's plain background colour once both Data and Land & water were hidden",
        timeout: 20_000,
      })
      .toBe(MAP_BACKGROUND_PAPER_RGB.join(","));
    expect(await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("basemap-water"))).toBe(
      true,
    );
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
