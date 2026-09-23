// M2 (docs/usability.md §4/§3.2): "Viridis/Cividis/Magma: grey Program Areas; no legend on cells."
// Picking a palette a release has not published `boot.palettes` stops for (today: everything but
// spectral_r) painted every Program Area flat `lightgrey` and replaced the floating legend with
// "This release has not published a legend ramp for this palette yet" -- on BOTH the zone
// choropleth and the raster (cell) legend, even though titiler was already painting the score
// tiles correctly server-side in that palette. Root cause + fix: src/lens/scores/zoneFill.ts,
// src/lens/scores/raster.ts and src/lib/raster/ramps.ts's own `paletteStopsWithFallback()`.
//
// This spec proves the fix on a REAL rendered map, in both the modes the assessment tried: the
// zone choropleth (`?unit=programarea`, `programarea_fill` painted per-zone) and the raster/cell
// legend (`?unit=cell`, the floating `ScoresLegend`). Same fixture set as e2e/scores.outlines.spec.ts
// (a NEW file, per this round's rules -- that one is owned by another round).
import { expect, test, type Page } from "@playwright/test";
import {
  collectConsoleErrors,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";
import {
  BOOT_FIXTURE,
  SCORE_COG_URL,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
  routeZonesPmtiles,
} from "./map-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

// same ambient shape as e2e/map.spec.ts / e2e/scores.outlines.spec.ts (their own shared comment:
// kept byte-for-byte so the specs cannot drift on what `window.__atlasMap` looks like), plus the
// `getCanvas`/`project` this spec's own pixel probe needs (already part of the shared shape).
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

/** the shared 4-feature Program Area fixture (map-hermetic.ts), augmented with one metric on
 * every zone (the choropleth branch needs a value per zone to paint at all -- the SAME shape
 * e2e/scores.outlines.spec.ts's own `bootFixture()` uses) AND a `by_subregion.FULL` COG/rescale
 * (the raster/cell-legend branch needs a rescale to build a legend at all -- without one,
 * `rasterLegend()` returns `{stops: [], unavailable: false}`, a "raster" legend with nothing in
 * it, which is a DIFFERENT bug from M2's and not what this spec is proving). */
function bootFixture() {
  return {
    ...BOOT_FIXTURE,
    layers: [
      {
        metric_key: "score",
        label: "Score",
        category: "composite",
        order: 1,
        by_subregion: { FULL: { cog: SCORE_COG_URL, rescale: [0, 90] as [number, number] } },
      },
    ],
    zones: {
      ...BOOT_FIXTURE.zones,
      programarea: BOOT_FIXTURE.zones.programarea.map((z, i) => ({
        ...z,
        metrics: { score: 10 + i * 20 },
      })),
    },
  };
}

async function gotoScores(page: Page, search: string) {
  await blockWasm(page);
  await routeBucket(page, "v7", bootFixture());
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(`/?proj=mercator${search}`);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

function layerFeatureCount(page: Page, layerId: string, sourceId: string) {
  return page.evaluate(
    ([id, src]) => {
      const map = window.__atlasMap!.handle.map;
      if (!map.getLayer(id)) return -1;
      if (!map.isSourceLoaded(src)) return -1;
      return map.queryRenderedFeatures({ layers: [id] }).length;
    },
    [layerId, sourceId] as const,
  );
}

/** the WebGL pixel at GAA's own centre (e2e/fixtures/map/zones.geojson: lon -96..-84, lat 24..30 —
 * 3 degrees, a real margin, from every edge), the same probe technique e2e/map.spec.ts's own
 * `readPixel` uses (`preserveDrawingBuffer`, spike S2's pin). */
function readGaaPixel(page: Page) {
  return page.evaluate(() => {
    const map = window.__atlasMap!.handle.map;
    const canvas = map.getCanvas();
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const dpr = canvas.width / canvas.clientWidth;
    const p = map.project([-90, 27]);
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
  });
}

/** "grey" per this fix's own bug: `ZONE_FILL_DEFAULT_COLOR` (`lightgrey`, zoneFill.ts) is
 * `rgb(211,211,211)`, and "grey" more generally means the three channels sit close together. A
 * real viridis stop is never within 20 of grey on every channel AND never has all three channels
 * within 10 of each other -- both would have to hold for this to be a false positive. */
function isGreyish([r, g, b]: readonly number[]): boolean {
  const nearLightgrey = Math.abs(r - 211) < 20 && Math.abs(g - 211) < 20 && Math.abs(b - 211) < 20;
  const channelsClose = Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && Math.abs(r - b) < 10;
  return nearLightgrey || channelsClose;
}

/** the number of DISTINCT colours in `.ramp`'s own gradient (Legend.svelte: `background:
 * linear-gradient(to right, ${stops.map(color).join(", ")})`) -- ">= 2" is "a real multi-stop
 * ramp", not the single flat note the pre-fix "unavailable" branch showed instead (that branch
 * never renders `.ramp` at all, so this also implicitly proves the ramp branch is the one that
 * rendered). Reads the computed style, not the raw attribute, so a CSS engine that reformats the
 * gradient string cannot produce a false negative. */
async function legendGradientColorCount(page: Page): Promise<number> {
  const bg = await page
    .locator('[data-testid="scores-legend"] .ramp')
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  const colors = bg.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/g) ?? [];
  return new Set(colors).size;
}

test.describe("M2: Viridis paints and has a legend, not flat grey", () => {
  test("zone choropleth (?unit=programarea&pal=viridis): programarea_fill renders non-grey pixels, real per-zone colours, and a real legend", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoScores(page, "&unit=programarea&pal=viridis");

    await expect
      .poll(() => layerFeatureCount(page, "programarea_fill", "programarea_src"), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // let the WebGL frame actually paint the fill before reading it back.
    await page.waitForTimeout(300);
    const pixel = await readGaaPixel(page);
    expect(pixel, "no WebGL context / readback failed").not.toBeNull();
    expect(
      isGreyish(pixel!),
      `expected a real viridis colour at GAA's centre, got rgba(${pixel!.join(",")}) -- the pre-fix bug painted every zone lightgrey (211,211,211)`,
    ).toBe(false);

    // a real legend, not the "not published yet" note (M2's other half of the same bug).
    const legend = page.locator('[data-testid="scores-legend"]');
    await expect(legend).toBeVisible();
    await expect(legend).not.toContainText("has not published a legend ramp");
    await expect(legend.locator(".legend")).toBeVisible();
    expect(await legendGradientColorCount(page)).toBeGreaterThanOrEqual(2);

    expect(errors).toEqual([]);
  });

  test("raster (cell) legend under Viridis is a real gradient, not 'unavailable'", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoScores(page, "&unit=cell&pal=viridis");

    const legend = page.locator('[data-testid="scores-legend"]');
    await expect(legend).toBeVisible();
    await expect(legend).not.toContainText("has not published a legend ramp");
    await expect(legend.locator(".legend")).toBeVisible();
    expect(await legendGradientColorCount(page)).toBeGreaterThanOrEqual(2);

    expect(errors).toEqual([]);
  });
});
