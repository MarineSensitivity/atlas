// R3-W8 item 5 (Ben, 2026-09-25, verbatim): "some care should be given to not wiping out existing
// selections that have been explicitly added to Places, but then a most recently selected slot
// that can be updated with subsequent selection." `src/lib/state/subjects.ts#reportSubjects`'s own
// header documents WHY this is a property of the callers (the map-click handler only ever writes
// `sel.sel`, never `sel.pl`) rather than something the pure function itself could enforce -- this
// spec is the real-browser proof of that property: adding a place, then clicking a scored cell,
// must never remove the place from the explicit list.
//
// Reuses the exact hermetic fixture e2e/scores.popup.spec.ts already proved a real click resolves
// against (a 48x48 test05r grid, `cell_tile0.parquet`) -- a synthetic `map.fire("click", ...)`
// drives the SAME production code path (`state.svelte.ts#handleMapClick`) a real pixel click would.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration, BUCKET } from "./hermetic";
import { routeBasemapStyle, routeGlyphs } from "./map-hermetic";
import { cellLonLat, type GridSpec } from "../src/lib/grid/grid";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

const VER = "v7";

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

const COMPOSITE_KEY = "extrisk_bird_ecoregion_rescaled";

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
  await page.goto("/?proj=mercator");
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

async function fireMapClick(page: Page, lngLat: { lng: number; lat: number }) {
  await page.evaluate((ll) => {
    (
      window as unknown as {
        __atlasMap: { handle: { map: { fire(type: string, props: object): void } } };
      }
    ).__atlasMap.handle.map.fire("click", { lngLat: ll, point: { x: 0, y: 0 } });
  }, lngLat);
}

// cell_id 500 -- an arbitrary cell far from CELL_1 (used elsewhere) so this spec's own click is
// independently identifiable in a failure message, inside cell_tile0.parquet's real coverage.
const CLICK_CELL = cellLonLat(500, GRID, true);

test.describe("R3-W8 item 5: a map click never wipes the explicit Places list", () => {
  test("add a place, click a scored cell: the place survives (#pl= unchanged)", async ({
    page,
  }) => {
    await gotoScores(page);

    // R3-W8 item 5: Places folded into the Report pane as its own (default) tab.
    await page.locator("#rail-region button[aria-label='Report']").click();
    await page.getByRole("button", { name: "Places", exact: true }).click();
    await page.getByRole("button", { name: "Enter coordinates" }).click();
    const textarea = page.getByLabel("Coordinates, bounding box, or WKT/GeoJSON");
    await expect(textarea).toBeVisible();
    await textarea.fill("-124.5, 40.0, -123.0, 41.5");
    await page.getByRole("button", { name: "Add place" }).click();

    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/#pl=/);
    const hashAfterAdd = await page.evaluate(() => location.hash);

    // the real click: drives state.svelte.ts's own handleMapClick, the SAME production path a
    // pixel click on the map takes.
    await fireMapClick(page, { lng: CLICK_CELL.lon, lat: CLICK_CELL.lat });
    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });

    // the seeded fault this proves red on (places-list-wiped-by-click): the click must set
    // `sel=cell:...` WITHOUT touching `pl=` at all -- the explicit place is untouched, not merely
    // "still decodable to the same geometry" (a byte-identical hash is the stronger, exact claim).
    const hashAfterClick = await page.evaluate(() => location.hash);
    expect(hashAfterClick).toContain(hashAfterAdd.match(/pl=[^&]*/)?.[0]);

    // and the Table/Report still report on the explicit list, not the just-clicked cell
    // (reportSubjects()'s own "a non-empty list always wins" rule, tests/state/subjects.test.ts).
    await page.locator("#rail-region button[aria-label='Table']").click();
    await expect(page.locator("h2, h3").filter({ hasText: "Species for 1 place" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
