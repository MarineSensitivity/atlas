// atlas-4 fix round 3: the scores lens' click popup, real DuckDB-WASM, real Parquet fixtures — the
// owner's report: "the old Shiny app showed cell id, lon/lat and the scores on click" and this app
// showed nothing. Same convention as `e2e/report.spec.ts`'s "engine-backed paths" section: no
// `blockWasm()` here (the popup's value is read through the real engine), and the fixture is the
// SAME committed `e2e/fixtures/report/cell_tile0.parquet` that suite already exercises (a 48x48
// `test05r` grid, tile.size 24; every cell carries `extrisk_bird_ecoregion_rescaled = 50`).
//
// The click itself is fired synthetically — `handle.map.fire("click", {lngLat, point})` — rather
// than a real pixel-accurate mouse click: `mapClick()`'s cell branch (`src/lib/map/interaction.ts`)
// resolves the cell id from `lngLat` alone (grid arithmetic), and `point` only matters for the
// zone-hit branch this spec never exercises (`boot.units` is empty here) — so this drives the exact
// same production code path (`ScoresLens.svelte`'s own `handle.map.on("click", onClick)`) without
// depending on screen-pixel/projection math a headless run cannot guarantee.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration, BUCKET } from "./hermetic";
import { routeBasemapStyle, routeGlyphs } from "./map-hermetic";
import { cellLonLat, type GridSpec } from "../src/lib/grid/grid";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

const VER = "v7"; // public per hermetic.ts's VERSIONS_FIXTURE -- no preview session needed

const GRID: GridSpec = {
  gridId: "test05r",
  nc: 48,
  nr: 48,
  xmin: -125,
  ymax: 42,
  resx: 0.05,
  resy: 0.05,
  lon360: false,
  tileSize: 24,
};

// `boot.grid`'s WIRE shape (atlas-1's contract, `grid.ts#gridFromBoot`'s own header) -- nested
// `tile: {size}`, not `GridSpec`'s flattened `tileSize` -- kept as a SEPARATE literal so this
// fixture cannot silently drift from the real contract by reusing the internal type's shape.
const BOOT_GRID = {
  grid_id: GRID.gridId,
  nc: GRID.nc,
  nr: GRID.nr,
  xmin: GRID.xmin,
  ymax: GRID.ymax,
  resx: GRID.resx,
  resy: GRID.resy,
  lon360: GRID.lon360,
  tile: { size: GRID.tileSize },
};

const COMPOSITE_KEY = "extrisk_bird_ecoregion_rescaled"; // a real cell_tile0.parquet column (=50)

const BOOT = {
  ver: VER,
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  grid: BOOT_GRID,
  release: { status: "release", access: "public" },
  units: [],
  zones: {},
  datasets: [],
  layers: [{ metric_key: COMPOSITE_KEY, label: "Overall score", category: "composite", order: 1 }],
  // no by_subregion.FULL.cog on the composite row -> scoreRasterSpec() returns null -> no titiler
  // request at all, so this spec needs no raster tile fixture (raster.ts's own short-circuit).
};

const CELL_TILE0 = readFileSync(
  fileURLToPath(new URL("./fixtures/report/cell_tile0.parquet", import.meta.url)),
);

async function routeCellTile(page: Page) {
  await page.route(
    (url) => url.href === `${BUCKET}${VER}/app/cell/tile=0/data_0.parquet`,
    (route) =>
      route.fulfill({ status: 200, contentType: "application/octet-stream", body: CELL_TILE0 }),
  );
}

async function gotoScores(page: Page) {
  await routeBucket(page, VER, BOOT);
  await routeCellTile(page);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.goto("/?proj=mercator"); // mercator, not the globe default (flat probe, no engine tie)
  await waitForHydration(page);
  await page.waitForFunction(
    () => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap,
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __atlasMap: { handle: { map: { loaded(): boolean } } } }
      ).__atlasMap.handle.map.loaded(),
    undefined,
    { timeout: 15_000 },
  );
}

/** fires the real click event MapLibre's own `map.on("click", ...)` listener receives —
 * `ScoresLens.svelte`'s own handler reads only `e.lngLat`/`e.point`, both of which `Evented#fire`
 * merges straight onto the event object (maplibre-gl's own compatibility signature). */
async function fireMapClick(page: Page, lngLat: { lng: number; lat: number }) {
  await page.evaluate((ll) => {
    (
      window as unknown as {
        __atlasMap: { handle: { map: { fire(type: string, props: object): void } } };
      }
    ).__atlasMap.handle.map.fire("click", { lngLat: ll, point: { x: 0, y: 0 } });
  }, lngLat);
}

function popupText(page: Page) {
  return page.locator(".atlas-popup .maplibregl-popup-content").innerText();
}

// cell_id 1 (row 1, col 1 of the test05r grid) — inside cell_tile0.parquet's NW quadrant.
const CELL_1 = cellLonLat(1, GRID, true);

test.describe("scores lens — click popup (fix round 3, real engine)", () => {
  test("click a known cell -> popup shows cell id, lon/lat at 3 dp, and the tile's value", async ({
    page,
  }) => {
    await gotoScores(page);
    await fireMapClick(page, { lng: CELL_1.lon, lat: CELL_1.lat });

    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });
    // usability M9: the popup opens AT ONCE with "Loading value…", then is replaced in place once
    // the engine answers -- wait for the FINAL text (the fixture's real engine round trip is fast
    // but not synchronous) rather than reading whatever is on screen the instant it appears.
    await expect.poll(() => popupText(page), { timeout: 15_000 }).toContain("Overall score: 50");
    const text = await popupText(page);
    expect(text).toContain("Cell 1");
    expect(text).toContain(`lon ${CELL_1.lon.toFixed(3)}`);
    expect(text).toContain(`lat ${CELL_1.lat.toFixed(3)}`);
    // the exact fault this popup must never regress to: 2 dp instead of 3.
    expect(text).not.toContain(`lon ${CELL_1.lon.toFixed(2)},`);
  });

  // R3-B3 (Opus eyes-on review, 2026-09-25, phone-06-flower-half): the popup used to print the
  // raw CLICK point, while the panel (FlowerPanel.svelte's own "Cell ID: … (x:, y:)" title) always
  // printed the cell CENTRE for the SAME cell -- the two disagreed by whatever the click missed the
  // centre by ("lon -90.550, lat 28.601" in the popup vs. "-90.575, 28.625" in the panel). Clicking
  // a point inside the cell but off its centre must still read the centre, both places, since the
  // cell is the unit being described, not the pixel the pointer happened to land on.
  test("popup coordinates are the CELL CENTRE, not the raw click point, for an off-centre click", async ({
    page,
  }) => {
    await gotoScores(page);
    // still safely inside cell 1's 0.05deg box (half-width 0.025) so it resolves to the SAME cell.
    const offClick = { lng: CELL_1.lon + 0.01, lat: CELL_1.lat - 0.01 };
    await fireMapClick(page, offClick);

    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => popupText(page), { timeout: 15_000 }).toContain("Overall score: 50");
    const text = await popupText(page);
    expect(text).toContain("Cell 1");
    expect(text).toContain(`lon ${CELL_1.lon.toFixed(3)}`);
    expect(text).toContain(`lat ${CELL_1.lat.toFixed(3)}`);
    // the exact fault this must never regress to: the click point's own coordinates.
    expect(text).not.toContain(`lon ${offClick.lng.toFixed(3)}`);
    expect(text).not.toContain(`lat ${offClick.lat.toFixed(3)}`);
  });

  // fix list #12 (SC 4.1.3): the popup used to be a plain MapLibre div, never announced -- a
  // screen-reader user who somehow triggered a map click got no result at all. Fix: `showPopup`
  // (ScoresLens.svelte) also calls the shared `announce()`, with the SAME content as the popup's
  // own text (unescaped -- `announce()` sets a live region's text content, never innerHTML).
  // REVERTED (this fix alone) -> RED: the live region's text never changes on a map click.
  test("the popup's text is also announced through the shared live region", async ({ page }) => {
    await gotoScores(page);
    const live = page.locator('[role="status"]').first();
    await expect(live).toHaveText("");
    await fireMapClick(page, { lng: CELL_1.lon, lat: CELL_1.lat });
    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });
    await expect(live).toContainText("Cell 1", { timeout: 15_000 });
    await expect(live).toContainText(`lon ${CELL_1.lon.toFixed(3)}`);
    await expect(live).toContainText("Overall score: 50");
  });

  test("Esc closes the popup", async ({ page }) => {
    await gotoScores(page);
    await fireMapClick(page, { lng: CELL_1.lon, lat: CELL_1.lat });
    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("Escape");
    await expect(page.locator(".atlas-popup")).toHaveCount(0);
  });

  test("a second click replaces the first popup rather than stacking", async ({ page }) => {
    await gotoScores(page);
    await fireMapClick(page, { lng: CELL_1.lon, lat: CELL_1.lat });
    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });

    const CELL_2 = cellLonLat(2, GRID, true);
    await fireMapClick(page, { lng: CELL_2.lon, lat: CELL_2.lat });
    await expect(page.locator(".atlas-popup")).toHaveCount(1);
    await expect.poll(() => popupText(page), { timeout: 15_000 }).toContain("Cell 2");
  });

  // usability M9: "a cold cell click gives no feedback... no popup appeared within 3.5s" -- the
  // popup now opens AT ONCE with "Loading value..." and is filled in once the engine answers.
  test("the popup exists within 500ms of the click, even with the cell tile route delayed 3s", async ({
    page,
  }) => {
    await gotoScores(page);
    // Playwright matches routes in REVERSE registration order (hermetic.ts's own convention) --
    // this LATER registration for the SAME cell tile wins over `gotoScores`'s own `routeCellTile`,
    // delaying it long enough that "opens at once" can only be true if the popup never waits on it.
    await page.route(
      (url) => url.href === `${BUCKET}${VER}/app/cell/tile=0/data_0.parquet`,
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.fulfill({
          status: 200,
          contentType: "application/octet-stream",
          body: CELL_TILE0,
        });
      },
    );

    const clickedAt = Date.now();
    await fireMapClick(page, { lng: CELL_1.lon, lat: CELL_1.lat });
    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 500 });
    expect(Date.now() - clickedAt).toBeLessThan(500);
    await expect(page.locator(".atlas-popup")).toContainText("Loading value…");

    // and it DOES fill in, once the delayed fetch finally answers.
    await expect.poll(() => popupText(page), { timeout: 10_000 }).toContain("Overall score: 50");
  });
});
