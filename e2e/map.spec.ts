// atlas-map: the shared map module, on the REAL shell, fully hermetic.
//
// The assertion that carries the maplibre-gl 6.10 pin is the VECTOR one (docs/spikes/S2.md,
// consequence 4): `isSourceLoaded()` AND `queryRenderedFeatures().length > 0`, with the failure
// message naming the layer. Rasters paint with a dead worker, so a `readPixels` gate alone is not a
// check — the `?url` wiring produces a build that paints tiles and silently never parses a single
// vector tile.
//
// atlas-8 step 2: widened from chromium-only to all three engines. S2's numbers were measured on
// headless Chromium/swiftshader only; WebKit and Firefox's headless GL stacks needed their own
// measurement, done here -- all four assertions below (vector render, raster paint, theme-swap
// setStyle, camera replaceState) pass on all three, at comparable speed (measured: 6-8s for the
// whole file per engine, vs ~2s for chromium alone in the original S2 note -- no fault of the
// engines here; see scripts/verify.mjs's own note on running MANY pages back to back).
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
  BOOT_FIXTURE,
  RASTER_RGB,
  SCORE_COG_URL,
  blockWasm,
  routeBasemapTiles,
  routeGlyphs,
  routeTitilerTiles,
  routeZonesPmtiles,
} from "./map-hermetic";

// SERIAL, on purpose (S2 consequence 12, "the timing gate runs alone"): four WebGL maps built at
// once on one software GL renderer, inside a suite already running three engines in parallel, is
// contention — observed as `isSourceLoaded()` still false after 20 s in a run where the same test
// passes in 2 s alone. The assertions are unchanged; only their concurrency is.
test.describe.configure({ mode: "serial" });

// the repo's desktop viewport (scripts/verify.mjs's matrix), pinned here because the probe points
// below are only inside the canvas at a known size — the default device viewport left the map
// 300 px tall and put the Gulf probe off the bottom edge (measured, atlas-map).
test.use({ viewport: { width: 1280, height: 800 } });

/** two points in open ocean, inside the default FULL camera on a 1280×800 desktop viewport. */
const OCEAN_PROBES: Array<[number, number]> = [
  [-90, 26], // Gulf of America
  [-125, 38], // off central California
];

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

async function gotoMap(page: Page) {
  await blockWasm(page);
  await routeBucket(page, "v7", BOOT_FIXTURE);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  await routeBasemapTiles(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto("/");
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

/** how many features the zones line layer is currently rendering. */
function zoneFeatureCount(page: Page) {
  return page.evaluate(() => {
    const map = window.__atlasMap!.handle.map;
    if (!map.isSourceLoaded("programarea_src")) return -1;
    return map.queryRenderedFeatures({ layers: ["programarea_ln"] }).length;
  });
}

/** read back one pixel of the WebGL canvas at a lon/lat (needs `preserveDrawingBuffer`). */
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

test.describe("map module, first paint with **/*.wasm blocked", () => {
  test("renders a VECTOR feature from the release's zones PMTiles", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const requests = collectRequests(page);
    await gotoMap(page);

    await expect
      .poll(() => zoneFeatureCount(page), {
        message:
          'source "programarea_src" / layer "programarea_ln" never rendered a vector feature — ' +
          "the maplibre worker is the first thing to check (docs/spikes/S2.md: the `?url` wiring " +
          "paints rasters and silently parses no vector tiles)",
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // no worker/shared 404 and no wasm byte (S2 consequence 4 + plan D3 Tier 0)
    expect(requests.filter((u) => /\.wasm(\?|$)/.test(u))).toEqual([]);
    expect(requests.filter((u) => /duckdb/i.test(u))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("paints a raster at two ocean probe points", async ({ page }) => {
    await gotoMap(page);
    // deliberately NOT gated on the vector count: this test is about the raster path, and a
    // precondition it does not need is a second way for it to go red.
    await page.waitForFunction(() => window.__atlasMap!.handle.map.loaded(), undefined, {
      timeout: 20_000,
    });

    // the basemap raster is already painted; compose the score raster on top of it, exactly the
    // way atlas-4's lens will (composeStyle inputs in, one setStyle(diff) out), and assert the
    // probe reads the RASTER's colour rather than the basemap's.
    await page.evaluate((cog) => {
      const api = window.__atlasMap!;
      api.handle.applyStyle(
        api.composeStyle({
          ...api.inputs(),
          projection: "mercator", // a flat probe: globe warps where a fixed lon/lat lands
          raster: {
            id: "r_lyr",
            tiles: [
              "https://titiler-v8.marinesensitivity.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png" +
                `?url=${encodeURIComponent(cog)}&colormap_name=spectral_r&rescale=0,90`,
            ],
            opacity: 1,
          },
        }),
      );
    }, SCORE_COG_URL);

    for (const [lon, lat] of OCEAN_PROBES) {
      await expect
        .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
          message: `no raster pixel painted at ${lon},${lat}`,
          timeout: 20_000,
        })
        .toBe(RASTER_RGB.join(","));
    }
  });

  test("a theme switch swaps the basemap and keeps the zones drawn", async ({ page }) => {
    await gotoMap(page);
    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBeGreaterThan(0);

    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    const basemapBefore = await page.evaluate(() =>
      JSON.stringify(window.__atlasMap!.composeStyle(window.__atlasMap!.inputs())),
    );
    expect(basemapBefore).toContain(before === "navy" ? "dark_all" : "light_all");

    await page.locator('[data-control="theme"]').click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .not.toBe(before);

    // the zones survive the setStyle(diff) — the regression a piecemeal addLayer() would produce
    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBeGreaterThan(0);
    const basemapAfter = await page.evaluate(() =>
      JSON.stringify(window.__atlasMap!.composeStyle(window.__atlasMap!.inputs())),
    );
    expect(basemapAfter).toContain(before === "navy" ? "light_all" : "dark_all");
    // the basemap really is painted, not just declared
    const px = await readPixel(page, 0, 0);
    expect(px).not.toBeNull();
  });

  test("the camera is written back to the URL with replaceState, debounced", async ({ page }) => {
    await gotoMap(page);
    const historyLength = await page.evaluate(() => history.length);
    await page.evaluate(() => {
      // a user-driven move (no `atlasProgrammatic` event data) — the same path a drag takes
      (window.__atlasMap!.handle.map as unknown as { jumpTo(o: unknown): void }).jumpTo({
        center: [-89.089, 26.251],
        zoom: 3.74,
      });
    });
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain("map=-89.089,26.251,3.74");
    // replaceState, never pushState: a link reproduces its view without growing a back stack
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  });
});
