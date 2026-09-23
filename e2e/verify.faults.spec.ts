// atlas-8 step 2: the three seeded faults the pyramid names for the Playwright state matrix
// (scripts/verify.mjs) -- committed proof that its checks (assertLayout + the per-state raster/
// vector probes) can actually fail, the same "a check that cannot fail is not a check" rule every
// other gate in this repo carries. Chromium only (the WebGL probes' own convention, e2e/map.spec.ts).
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import {
  BOOT_FIXTURE,
  RASTER_RGB,
  SCORE_COG_URL,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeZonesPmtiles,
} from "./map-hermetic";
// scripts/verify.mjs's own exports -- the SAME functions the real state matrix runs, so a fault
// proven here is a fault the real matrix would have caught too (tests/map/no-fitbounds.test.ts's
// convention: "the gate and its seeded fault run the SAME code").
import { assertLayout, readPixel, zoneFeatureCount } from "../scripts/verify.mjs";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
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

async function gotoMap(page: Page) {
  await blockWasm(page);
  await routeBucket(page, "v7", BOOT_FIXTURE);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.goto("/");
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => window.__atlasMap!.handle.map.loaded(), undefined, {
    timeout: 15_000,
  });
}

test.describe("seeded fault: a raster source 404, DOM still fine", () => {
  test("assertLayout stays green; the raster probe is what catches it", async ({ page }) => {
    // the seeded fault: titiler answers every tile with 404, not a fixture PNG.
    await page.route("https://titiler-v8.marinesensitivity.org/**", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await gotoMap(page);

    await page.evaluate((cog) => {
      const api = window.__atlasMap!;
      api.handle.applyStyle(
        api.composeStyle({
          ...api.inputs(),
          projection: "mercator",
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
    await page.waitForTimeout(2_000); // give the (failing) tile requests a chance to settle

    // the DOM is fine: the shell painted, no crash, no horizontal overflow, every control on
    // screen -- a blank/missing raster is invisible to assertLayout by construction.
    const layoutProblems = await assertLayout(page);
    expect(
      layoutProblems,
      "assertLayout must NOT flag a 404 raster -- it only sees layout",
    ).toEqual([]);

    // the probe scripts/verify.mjs's own scoresRasterProbe uses IS what catches it: the pixel
    // reads as the basemap alone, never the raster colour.
    const px = await readPixel(page, -90, 26.5);
    expect(px, "no WebGL context to read back").not.toBeNull();
    expect(
      px!.slice(0, 3).join(","),
      "a 404'd raster must never read back as the raster colour",
    ).not.toBe(RASTER_RGB.join(","));
  });
});

test.describe("seeded fault: setStyle loses the zone layer", () => {
  test("zoneFeatureCount catches it; assertLayout does not", async ({ page }) => {
    await gotoMap(page);
    await expect.poll(() => zoneFeatureCount(page), { timeout: 15_000 }).toBeGreaterThan(0);

    // the seeded fault: apply a style that never asked composeStyle for the zone unit at all --
    // the same shape a piecemeal `addLayer()`/a dropped `zones` input would produce (docs/map.md:
    // "Never addLayer() piecemeal after load -- layers added that way can silently vanish across
    // a later style swap").
    await page.evaluate(() => {
      const api = window.__atlasMap!;
      api.handle.applyStyle(api.composeStyle({ ...api.inputs(), zones: [] }));
    });

    const layoutProblems = await assertLayout(page);
    expect(layoutProblems, "assertLayout has no way to see a missing vector layer").toEqual([]);

    const count = await zoneFeatureCount(page);
    expect(count, "the zone layer must be gone after the seeded setStyle").toBeLessThanOrEqual(0);
  });
});

test.describe("seeded fault: a panel pushed off-screen at 390 px", () => {
  test("assertLayout's per-control bounding-box check catches it", async ({ page }) => {
    await gotoMap(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // sanity: the real shell has no such problem before the fault is injected.
    expect(await assertLayout(page)).toEqual([]);

    // the seeded fault: push a REAL [data-control] element (the theme toggle, always present)
    // past the right edge of a 390 px viewport with a plain transform -- exactly the class of bug
    // an ancestor's `overflow:hidden` clipping a control produces, without ever tripping
    // `scrollWidth > clientWidth` on <html> (which is why the per-control box check exists at all,
    // not just the whole-document overflow check).
    await page.evaluate(() => {
      const el = document.querySelector('[data-control="theme"]') as HTMLElement | null;
      if (el) el.style.transform = "translateX(500px)";
    });

    const problems = await assertLayout(page);
    expect(problems.some((p) => p.includes('"theme"') && p.includes("off-screen"))).toBe(true);
  });
});
