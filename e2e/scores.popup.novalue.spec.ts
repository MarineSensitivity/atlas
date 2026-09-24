// D3 (Opus 5.5 eyes-on assessment, 2026-09-24, atlas-refs/"2026-09-24 eyes-on UI assessment
// (Opus 5.5) on 15d6e4c.md"): "clicking outside the scored area misleads in three places" — the
// owner's report on a Utah (land) click: a popup "Cell 2711027 · lon -113.526, lat 38.932 ·
// {30-word layer title}: no value", the Flower panel "No flower data is published … in this
// release" (blames the data), and the Table panel "The species table could not be loaded." (reads
// as a failure). This file covers the POPUP half — (a) a click on a cell with no value opens a
// ONE-line "No scored cell here" + coordinates, never a cell id or the layer title; the previously
// selected scored cell stays selected. Same fixture family as e2e/scores.popup.spec.ts (real
// engine, real 48x48 test grid, real cell_tile0.parquet), reused locally rather than shared so this
// file has no import surface another agent's edit to that spec could break.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { safeRoute } from "./routeSafety";
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
  // a deliberately LONG description, matching the eyes-on review's own worked example — the fix
  // must never print this in a no-value popup.
  layers: [
    {
      metric_key: COMPOSITE_KEY,
      label:
        "Primary productivity: Oregon State Vertically Generalized Production Model (VGPM) from satellite ocean color, 2014 to 2023",
      category: "composite",
      order: 1,
    },
  ],
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

const SHORT_LABEL = "score"; // D4: the manifest's own short label for COMPOSITE_KEY

/** overrides `routeBucket`'s own manifest fixture (`{ver, capabilities: {}}`, no `metrics`) — same
 * convention as `e2e/layers.spec.ts`'s M6 block (`routeManifestWithMetrics`), registered AFTER
 * `routeBucket` so it wins (Playwright tries routes in reverse registration order). D4 needs this:
 * without a published short label, `showCellPopup`'s fallback chain correctly (and unavoidably)
 * shows the long `boot.layers[].label` — this fixture is what proves the SHORT one wins when one
 * IS published, matching a real release (v7 publishes `manifest.metrics[]` for every metric). */
async function routeManifestWithShortLabel(page: Page) {
  await page.route(
    `${BUCKET}${VER}/manifest.json`,
    safeRoute((route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ver: VER,
          capabilities: {},
          metrics: [{ metric_key: COMPOSITE_KEY, label: SHORT_LABEL }],
        }),
      }),
    ),
  );
}

async function gotoScores(page: Page) {
  await routeBucket(page, VER, BOOT);
  await routeManifestWithShortLabel(page);
  await routeCellTile(page); // ONLY tile=0 — a click resolving to any other tile 404s (routeBucket's own catch-all), the real "off-grid/unscored" condition this file tests.
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

function popupText(page: Page) {
  return page.locator(".atlas-popup .maplibregl-popup-content").innerText();
}

const CELL_1 = cellLonLat(1, GRID, true); // tile 0 — a real, scored cell
// row 40 / col 40 -> tile 3 (nAcross=2: tileOf math in grid.ts) — routeCellTile above never mocks
// this tile's parquet, so it 404s through routeBucket's catch-all: a genuinely "no value" cell.
const OFF_TILE_CELL_ID = 39 * GRID.nc + 40;
const CELL_OFF_TILE = cellLonLat(OFF_TILE_CELL_ID, GRID, true);

test.describe("D3: the click popup outside the scored area (Opus 5.5 eyes-on, 2026-09-24)", () => {
  test("a click with no value opens a ONE-line 'No scored cell here' popup + coordinates — never a cell id, never the layer title", async ({
    page,
  }) => {
    await gotoScores(page);
    await fireMapClick(page, { lng: CELL_OFF_TILE.lon, lat: CELL_OFF_TILE.lat });

    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => popupText(page), { timeout: 15_000 }).toContain("No scored cell here");
    // `.innerText()` on `.maplibregl-popup-content` also picks up the close button's own "×" glyph
    // (a sibling inside the same content box) — `startsWith` isolates the popup's OWN text line
    // from that unrelated control, same as scores.popup.spec.ts's own `toContain` assertions do.
    const text = await popupText(page);
    expect(
      text.startsWith(
        `No scored cell here · lon ${CELL_OFF_TILE.lon.toFixed(3)}, lat ${CELL_OFF_TILE.lat.toFixed(3)}`,
      ),
    ).toBe(true);
    expect(text).not.toContain(String(OFF_TILE_CELL_ID));
    expect(text).not.toContain("Primary productivity");
    expect(text).not.toContain("Cell "); // never a cell id line at all
  });

  test("the previously selected SCORED cell stays selected (the URL's sel= is unchanged) after a no-value click", async ({
    page,
  }) => {
    await gotoScores(page);
    // select a real, scored cell first.
    await fireMapClick(page, { lng: CELL_1.lon, lat: CELL_1.lat });
    await expect.poll(() => popupText(page), { timeout: 15_000 }).toContain(`${SHORT_LABEL}: 50`);
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe("cell:1");

    // now click somewhere with no value.
    await fireMapClick(page, { lng: CELL_OFF_TILE.lon, lat: CELL_OFF_TILE.lat });
    await expect.poll(() => popupText(page), { timeout: 15_000 }).toContain("No scored cell here");

    // the URL's selection must NOT have moved to the off-tile cell.
    expect(new URL(page.url()).searchParams.get("sel")).toBe("cell:1");
  });

  test("no selection yet, then a no-value click: nothing becomes selected (sel= stays absent)", async ({
    page,
  }) => {
    await gotoScores(page);
    expect(new URL(page.url()).searchParams.get("sel")).toBeNull();

    await fireMapClick(page, { lng: CELL_OFF_TILE.lon, lat: CELL_OFF_TILE.lat });
    await expect.poll(() => popupText(page), { timeout: 15_000 }).toContain("No scored cell here");

    expect(new URL(page.url()).searchParams.get("sel")).toBeNull();
  });

  test("a SCORED cell click still writes the selection and shows the SHORT manifest label + value, never the long description (D4)", async ({
    page,
  }) => {
    await gotoScores(page);
    await fireMapClick(page, { lng: CELL_1.lon, lat: CELL_1.lat });
    await expect.poll(() => popupText(page), { timeout: 15_000 }).toContain(`${SHORT_LABEL}: 50`);
    expect(new URL(page.url()).searchParams.get("sel")).toBe("cell:1");
    const text = await popupText(page);
    expect(
      text.startsWith(
        `Cell 1 · lon ${CELL_1.lon.toFixed(3)}, lat ${CELL_1.lat.toFixed(3)} · ${SHORT_LABEL}: 50`,
      ),
    ).toBe(true);
    // D4: the popup's own defect — `boot.layers[].label` is the LONG description text, and the
    // owner's report showed it printing verbatim in a one-line popup.
    expect(text).not.toContain("Primary productivity");
  });
});
