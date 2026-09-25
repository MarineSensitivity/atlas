// Q2, 0.10.52: GeoPackage upload actually reads. Before this round `UploadPanel.svelte` hardcoded
// `runtime: null` unconditionally, so `parseGeoPackage` (`lib/geo/upload/parsers/geopackage.ts`)
// threw `geopackageNoRuntime` for EVERY `.gpkg`, no matter what -- "GeoPackage is not supported
// yet" since 0.10.47. This is the RED-FIRST proof: before the fix (`runtime: null` restored) this
// whole spec fails at the very first assertion (no `.place-row` ever appears, only a refusal); after
// it, a real `.gpkg` -- read through the SAME DuckDB-WASM engine the scores boot, its `spatial`
// extension fetched live from `extensions.duckdb.org` (S4 rule 2's deliberate non-mirrored, consented
// download, ~23 MB) -- produces a place with a real, computed composite.
//
// A REAL release, same convention as `places.spec.ts`'s "fresh-profile round trip" (the one other
// spec in this repo that needs a real DuckDB-WASM boot against real data rather than a hermetic
// mock): a tiny custom 48x48 test grid whose extent (lon -125..-122.6, lat 39.6..42, Northern
// CA/OR coast) is where every fixture `.gpkg` below is deliberately drawn. Duplicated here rather
// than imported from `places.spec.ts` (Q2 owns only this file + src/lib/geo/upload/**,
// src/places/UploadPanel.svelte, src/lib/engine/** this round) -- the setup is ~40 lines and
// keeping this spec self-contained is cheaper than coupling two rounds' files together.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { BUCKET, routeBucket, routeSealFixture, routeSession } from "./hermetic";

const PLACES_FIXTURES = new URL("./fixtures/places/", import.meta.url);
const CELL_TILE0 = readFileSync(fileURLToPath(new URL("cell_tile0.parquet", PLACES_FIXTURES)));
const TAXON = readFileSync(fileURLToPath(new URL("taxon.parquet", PLACES_FIXTURES)));
const ZONE_TAXON = readFileSync(fileURLToPath(new URL("zone_taxon.parquet", PLACES_FIXTURES)));
const TAXONOMY = readFileSync(fileURLToPath(new URL("taxonomy.parquet", PLACES_FIXTURES)));

const UPLOAD_FIXTURES = new URL("../tests/fixtures/upload/", import.meta.url);
const gpkgPath = (name: string) => fileURLToPath(new URL(name, UPLOAD_FIXTURES));

const VER = "v7"; // public per hermetic.ts's VERSIONS_FIXTURE -- no preview session needed

const BOOT = {
  schema: 1,
  ver: VER,
  built_at: "2026-09-24T00:00:00Z",
  id_field: "cell_id", // anything but "mdl_key" -- skips coreTables()'s tables/model.parquet load
  grid_id: "test05",
  grid: {
    nc: 48,
    nr: 48,
    xmin: -125,
    ymax: 42,
    resx: 0.05,
    resy: 0.05,
    lon360: false,
    tile: { size: 48 }, // side == nc: the whole grid is tile 0, so one fixture file covers it
  },
  study_areas: [],
  units: [],
  layers: [
    {
      metric_key: "extrisk_test_ecoregion_rescaled",
      label: "Test component",
      category: "component",
      order: 1,
    },
  ],
};

const FILES: Record<string, Buffer> = {
  [`${VER}/app/taxon.parquet`]: TAXON,
  [`${VER}/app/zone_taxon.parquet`]: ZONE_TAXON,
  [`${VER}/app/taxonomy.parquet`]: TAXONOMY,
  [`${VER}/app/cell/tile=0/data_0.parquet`]: CELL_TILE0,
};

async function gotoPlacesWithRealRelease(page: Page): Promise<void> {
  await routeBucket(page, VER, BOOT);
  await page.route(
    (url) => url.href.startsWith(BUCKET) && url.href.includes("/app/"),
    (route) => {
      const path = route.request().url().slice(BUCKET.length);
      const body = FILES[path];
      if (!body) return route.fallback(); // e.g. app/boot.json -- routeBucket's own handler
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body });
    },
  );
  await routeSession(page, null);
  await routeSealFixture(page);
  // this spec never calls blockWasm: a real DuckDB-WASM engine, and a REAL live fetch of the
  // spatial extension from extensions.duckdb.org (not mirrored, S4 rule 2), is the whole point.
  await page.goto("/");
  await page.waitForSelector("#rail-region .rail", { state: "attached" });
  // R3-W8 item 5: Places folded into the Report pane as its own (default) tab -- open the
  // Report rail tool, then make sure the Places tab is the one showing (defensive: correct
  // even if a PRIOR step on this page already switched to the Report tab).
  await page.locator("#rail-region button[aria-label='Report']").click();
  await page.getByRole("button", { name: "Places", exact: true }).click();
}

/** drop a fixture through the file input inside `.dropzone` -- "through the drop zone" the way a
 * person would, via its own file picker rather than a synthetic DragEvent (notoriously flaky under
 * Chromium headless, and no more "real" a path through this component's own code than the input
 * is: both raise the SAME `onDropZone`/`onInputChange` -> `handleFile()` call). */
async function dropGeoPackage(page: Page, fixtureName: string): Promise<void> {
  await page.locator(".dropzone input[type=file]").setInputFiles(gpkgPath(fixtureName));
}

/** the ResultsPanel's own rendered composite for the one SELECTED place -- read from the DOM, the
 * same helper `places.spec.ts`'s round trip uses (see its own header for the row-select caveat:
 * a newly-added place is already auto-selected, so a bare `.click()` would DEselect it). */
async function readComposite(page: Page): Promise<string> {
  const rowSelect = page.locator(".place-row .row-select").last();
  if ((await rowSelect.getAttribute("aria-pressed")) !== "true") {
    await rowSelect.locator(".icon").click();
  }
  const composite = page.locator(".composite-figure strong");
  await expect(composite).toBeVisible({ timeout: 60_000 }); // cold DuckDB boot + a live 23 MB fetch
  return (await composite.textContent())?.trim() ?? "";
}

test.describe.configure({ mode: "serial" }); // one page, one DuckDB boot, one spatial-extension fetch

test("a real .gpkg is read end to end: polygon in, place + computed composite out", async ({
  page,
}) => {
  test.setTimeout(180_000); // a real DuckDB-WASM cold boot AND a real ~23 MB third-party fetch
  page.on("dialog", (d) => d.accept()); // the GeoPackage consent prompt (window.confirm)

  await gotoPlacesWithRealRelease(page);
  await dropGeoPackage(page, "gpkg_polygon.gpkg");

  await expect(page.locator(".place-row")).toHaveCount(1, { timeout: 15_000 });
  // the feature's own "name" property (Q2's naming-options fix), not the file name "gpkg_polygon"
  // -- the row's name lives in the rename <input>'s VALUE, not its text content (places.spec.ts's
  // own "Rename place" convention).
  await expect(page.locator(".place-row").first().getByLabel("Rename place")).toHaveValue(
    "Q2 polygon",
  );

  const composite = await readComposite(page);
  expect(composite.length).toBeGreaterThan(0);
  expect(Number(composite)).not.toBeNaN(); // a REAL computation, not a blank/placeholder

  // --- a MultiPolygon reads as one place, both parts intact (same drop zone, same session) --------
  await dropGeoPackage(page, "gpkg_multipolygon.gpkg");
  await expect(page.locator(".place-row")).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator(".place-row").last().getByLabel("Rename place")).toHaveValue(
    "Q2 multipolygon",
  );

  // --- refusal paths: every one an HONEST message, not ST_Read's raw SQL error ----------------------
  // R3-CI: `getByRole("button", { name: "Dismiss" })` alone now resolves >1 element -- W6's two
  // "Place added." toasts (`Toast.svelte`'s `.toast-dismiss[aria-label="Dismiss"]`) from the two
  // successful uploads above are still on screen (each auto-dismisses after 5s, longer than this
  // spec takes to reach here) alongside this panel's own `.refusal button`. Confirmed by tracing
  // the code, not a UI defect: `UploadPanel.svelte`'s `finalize()` comment says a refusal never
  // calls `notify()` (only `onAdd`, i.e. success, does) -- so `.refusal` never carries a duplicate
  // toast of itself, and two toasts for two successful uploads is the intended "each upload
  // announces itself" behaviour. Scope to `.refusal` so this spec's Dismiss clicks never collide
  // with the toasts sitting behind them.
  await dropGeoPackage(page, "gpkg_point.gpkg");
  await expect(page.locator(".refusal")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".refusal")).toContainText("a Point"); // notPolygon
  await page.locator(".refusal").getByRole("button", { name: "Dismiss" }).click();

  // Measured (Q2): `sqlite_scan()` -- the ONLY way this parser can read a GeoPackage's own declared
  // SRS row -- cannot open a file registered via duckdb-wasm's `registerFileBuffer` at all ("Unable
  // to open database", its own SQLite engine doing its own file I/O rather than going through
  // DuckDB's virtual filesystem the way `ST_Read` does). That best-effort lookup therefore falls
  // through to `crs: null` for EVERY real upload today, and normalize.ts's magnitude test is what
  // actually refuses a projected `.gpkg` -- still refused, still honest, just `projectedCoordinates`
  // rather than the (currently unreachable outside a mocked test) `projectedCrs`.
  await dropGeoPackage(page, "gpkg_projected.gpkg");
  await expect(page.locator(".refusal")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".refusal")).toContainText("projected metres"); // projectedCoordinates
  await page.locator(".refusal").getByRole("button", { name: "Dismiss" }).click();

  // Same sqlite_scan limitation (see above) means `geopackageNoFeatureTable`'s own proactive check
  // cannot fire for real either -- it falls through, `ST_Read` itself then fails to open a dataset
  // with no vector layer, and normalizeUpload's catch-all turns that into `parseFailed`: still an
  // honest, non-crashing refusal (never a raw "IO Error: Could not open GDAL dataset"), just the
  // generic parse-failure bucket rather than the specific one. `geopackageNoFeatureTable` itself
  // stays covered by the mocked unit tests in tests/geo/upload/parsers.test.ts.
  await dropGeoPackage(page, "gpkg_no_features.gpkg");
  await expect(page.locator(".refusal")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".refusal")).toContainText("stopped part way through"); // parseFailed
  await page.locator(".refusal").getByRole("button", { name: "Dismiss" }).click();

  // the place count never moved for any of the three refused drops
  await expect(page.locator(".place-row")).toHaveCount(2);
});
