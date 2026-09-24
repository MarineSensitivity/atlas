// usability B1 (docs/usability.md §3.4/§4): "place analyses race on shared DuckDB tables: coverage
// reads 0 / 100 / 200 %, and a place can show another place's scores". On the live 0.10.21 one box
// read "200.0 % of this place is inside the US study area (1,344 of 672 cells)", and an uploaded
// Monterey box showed the Gulf box's 31.3 composite under its own name.
//
// Two defects, one symptom, and a test for each shape of it -- every number a place shows must be
// the number it shows ALONE (measured first, in fresh profiles):
// - the Results panel never re-ran for a newly selected place (its effect read `place` only after an
//   `await`, so it never tracked it) -- "two places back to back";
// - two analyses on one engine interleaved on the shared `place_cell`/`cell` objects
//   (src/lib/analysis/exclusive.ts) -- "Show analysis cells" beside the same place's scores doubled
//   the cell set, and an upload's study-area check rewrote a running analysis' cells.
//
// The overlap is FORCED, not hoped for: the first place's `cell` tile is held at the route until the
// second operation has been started, then released -- so the two are guaranteed to be in flight on
// the engine at once, on every engine and every run. A real DuckDB-WASM boots against a tiny real
// release (e2e/fixtures/places-concurrency/generate.sql); nothing reaches the live network.
//
// tests/faults/places-analysis-shared-tables.patch removes the queue and must turn this red.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  BUCKET,
  routeBucket,
  routeSealFixture,
  routeSession,
  safeRoute,
  waitForHydration,
} from "./hermetic";

const HERE = new URL("./fixtures/places-concurrency/", import.meta.url);
const EMPTY = new URL("./fixtures/places/", import.meta.url); // empty taxon/zone_taxon/taxonomy
const read = (dir: URL, file: string) => readFileSync(fileURLToPath(new URL(file, dir)));

const VER = "v7"; // public per hermetic.ts's VERSIONS_FIXTURE -- no preview session needed
const HELD_TILE = 0; // place A's only `cell` tile

const BOOT = {
  schema: 1,
  ver: VER,
  built_at: "2026-09-23T00:00:00Z",
  id_field: "cell_id", // not "mdl_key": coreTables() then skips tables/model.parquet
  grid_id: "test05c",
  grid: {
    nc: 48,
    nr: 48,
    xmin: -125,
    ymax: 42,
    resx: 0.05,
    resy: 0.05,
    lon360: false,
    tile: { size: 24 },
  },
  study_areas: [],
  units: [],
  layers: [
    { metric_key: "extrisk_bird_ecoregion_rescaled", label: "Bird", category: "component" },
    { metric_key: "extrisk_fish_ecoregion_rescaled", label: "Fish", category: "component" },
  ],
};

const FILES: Record<string, Buffer> = {
  [`${VER}/app/taxon.parquet`]: read(EMPTY, "taxon.parquet"),
  [`${VER}/app/zone_taxon.parquet`]: read(EMPTY, "zone_taxon.parquet"),
  [`${VER}/app/taxonomy.parquet`]: read(EMPTY, "taxonomy.parquet"),
  ...Object.fromEntries(
    [0, 1, 2, 3].map((t) => [
      `${VER}/app/cell/tile=${t}/data_0.parquet`,
      read(HERE, `cell_tile${t}.parquet`),
    ]),
  ),
};

/** tile 0, rows 3-16 x cols 2-17: 224 cells, 154 inside the study area (generate.sql). */
const A_COORDS = "-124.93, 41.22, -124.18, 41.87";

const box = (x0: number, y0: number, x1: number, y1: number, name: string) =>
  JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
              [x0, y0],
            ],
          ],
        },
      },
    ],
  });

/** tile 3, rows 29-44 x cols 28-45: 288 cells, 270 inside. */
const B_UPLOAD = { name: "place-b.geojson", body: box(-123.62, 39.83, -122.77, 40.58, "B") };
/** tile 0 again (A's tile), columns 1-6 only: no cell inside -- refused by the study-area check. */
const D_UPLOAD = { name: "place-d.geojson", body: box(-124.97, 41.5, -124.73, 41.7, "D") };

interface Held {
  /** resolves when the held tile's request has reached the route -- the first analysis is now IN
   * the engine, holding its one connection. */
  requested: Promise<void>;
  release: () => void;
}

/** serve the fixture release; with `hold`, keep the FIRST request for tile `HELD_TILE` waiting. */
async function gotoRelease(page: Page, hold = false): Promise<Held> {
  let markRequested!: () => void;
  const requested = new Promise<void>((resolve) => (markRequested = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let holding = hold;
  await routeBucket(page, VER, BOOT);
  await page.route(
    (url) => url.href.startsWith(BUCKET) && url.href.includes("/app/"),
    safeRoute(async (route) => {
      const path = route.request().url().slice(BUCKET.length);
      const body = FILES[path];
      if (!body) return route.fallback(); // e.g. app/boot.json: routeBucket's handler
      if (holding && path === `${VER}/app/cell/tile=${HELD_TILE}/data_0.parquet`) {
        holding = false;
        markRequested();
        await released;
      }
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body });
    }),
  );
  if (!hold) release();
  await routeSession(page, null);
  await routeSealFixture(page);
  await page.goto("/");
  await waitForHydration(page);
  await page.locator("#rail-region button[aria-label='Places']").click();
  return { requested, release };
}

/** fills and submits the coordinate-entry form for place A WITHOUT waiting for its row --
 * P8 item 6 added an async study-area check to "Add place" (the SAME `checkTouchesStudyArea`
 * upload already ran), so under `hold`, submitting now itself reaches the held tile-0 route
 * BEFORE the place exists. Callers that need to interleave with that round trip use this instead
 * of `addA`; solo (unheld) callers can still use `addA` below. */
async function submitA(page: Page) {
  await page.getByRole("button", { name: "Enter coordinates" }).click();
  const textarea = page.getByLabel("Coordinates, bounding box, or WKT/GeoJSON");
  await expect(textarea).toBeVisible();
  await textarea.fill(A_COORDS);
  await page.getByRole("button", { name: "Add place" }).click();
}

async function addA(page: Page) {
  await submitA(page);
  await expect(page.locator(".place-row").first()).toBeVisible();
}

async function upload(page: Page, file: { name: string; body: string }) {
  await page.locator(".upload input[type='file']").setInputFiles({
    name: file.name,
    mimeType: "application/geo+json",
    buffer: Buffer.from(file.body),
  });
}

interface PanelReading {
  note: string;
  composite: string;
}

/** what the Results panel shows right now -- `null` while it is still computing. */
async function readPanel(page: Page): Promise<PanelReading | null> {
  const note = page.locator(".results .coverage-note");
  const composite = page.locator(".results .composite-figure strong");
  if (!(await note.count()) || !(await composite.count())) return null;
  return {
    note: ((await note.textContent()) ?? "").replace(/\s+/g, " ").trim(),
    composite: ((await composite.textContent()) ?? "").trim(),
  };
}

/** poll until the panel settles on `expected`; a red names what it showed instead. */
async function expectPanel(page: Page, expected: PanelReading) {
  await expect.poll(() => readPanel(page), { timeout: 45_000 }).toEqual(expected);
}

/** select row `i` (a no-op if it is already selected -- `selectRow()` TOGGLES); the icon, not the
 * button's centre, which the rename input covers (places.spec.ts's `readResultsPanel`). */
async function selectRow(page: Page, i: number) {
  const row = page.locator(".place-row .row-select").nth(i);
  if ((await row.getAttribute("aria-pressed")) !== "true") await row.locator(".icon").click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
}

/** the upload handler has started ("Reading…") -- plus a margin for its parse + study-area check to
 * reach the engine, which is still busy with the held analysis either way. */
async function uploadInFlight(page: Page) {
  await expect(page.locator(".upload .dropzone")).toContainText("Reading…");
  await page.waitForTimeout(1_500);
}

/** each place ALONE, in a fresh profile -- memoised per worker, not shared through test order:
 * every test below stands on its own (a failed test restarts its worker, and each red should be
 * seen, not skipped). */
let soloMemo: Promise<{ a: PanelReading; b: PanelReading }> | null = null;
function soloReadings(browser: Browser) {
  soloMemo ??= (async () => ({
    a: await soloReading(browser, addA),
    b: await soloReading(browser, (page) => upload(page, B_UPLOAD)),
  }))();
  return soloMemo;
}

async function soloReading(
  browser: Browser,
  add: (page: Page) => Promise<void>,
): Promise<PanelReading> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await gotoRelease(page);
    await add(page);
    await expect.poll(() => readPanel(page), { timeout: 45_000 }).not.toBeNull();
    return (await readPanel(page))!;
  } finally {
    await context.close();
  }
}

test("solo baselines: each place alone, in a fresh profile -- and they are the fixture's own counts", async ({
  browser,
}) => {
  test.setTimeout(150_000); // two real DuckDB-WASM cold boots
  const solo = await soloReadings(browser);
  // not vacuous: generate.sql's hand-derived counts, and two places that genuinely differ
  expect(solo.a.note).toContain("(154 of 224 cells)");
  expect(solo.b.note).toContain("(270 of 288 cells)");
  expect(solo.a.composite).not.toBe(solo.b.composite);
  expect(Number(solo.a.composite)).not.toBeNaN();
  expect(Number(solo.b.composite)).not.toBeNaN();
});

test("two places back to back: each row's coverage and composite equal its solo value", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000); // the solo readings (two cold boots) when this worker has none yet
  const solo = await soloReadings(browser);
  const held = await gotoRelease(page, true);
  // P8 item 6: adding A now itself runs an async study-area check (CoordinateDialog.svelte's
  // `checkTouchesStudyArea`, the SAME one upload already had) before the place exists -- so it is
  // THIS request, not the post-add scores effect's, that now reaches the held tile-0 route.
  // `submitA` (not `addA`) fires the click without waiting for A's row, which cannot appear until
  // this request is released below.
  await submitA(page);
  await held.requested; // A's own pre-add study-area check is on the engine now
  await upload(page, B_UPLOAD); // ... and B's study-area check joins it
  await uploadInFlight(page);
  held.release();

  await expect(page.locator(".place-row")).toHaveCount(2, { timeout: 45_000 });
  await selectRow(page, 1); // the upload selects itself; asserted, not assumed
  await expectPanel(page, solo.b);
  await selectRow(page, 0);
  await expectPanel(page, solo.a);
  await selectRow(page, 1);
  await expectPanel(page, solo.b);
});

test("scores and Show analysis cells for the SAME place at once never double its cells (the 200 %)", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000); // the solo readings (two cold boots) when this worker has none yet
  const solo = await soloReadings(browser);
  const held = await gotoRelease(page, true);
  // P8 item 6 changed what this test can force. Before it, adding A by coordinates was a pure UI
  // update (no engine round trip), so the post-add scores effect was GUARANTEED to be the first
  // (and only) thing to ever request tile 0 -- exactly what this test needed held while "Show
  // analysis cells" raced it for the SAME place. Now adding A ITSELF runs an async study-area
  // check first (the same one upload always had), so tile 0's one real fetch belongs to THAT
  // check, and it completes (getting cached) before A exists to be selected at all -- "Show
  // analysis cells" cannot be clicked yet (disabled: no geom place selected), and clicking it
  // later can never be forced to overlap a NETWORK fetch again: `Engine#load` dedupes by
  // (name, digest), so a second caller for the same tile is either queued behind the first (via
  // `exclusive()`, which serializes whole ANALYSES, not just fetches) or finds it already cached
  // -- there is no "still in flight" window left to hold. What `exclusive()` actually guards
  // (two ANALYSES of the same place never interleaving their SQL, whether or not either is
  // waiting on a network fetch) is still exercised here -- the post-add scores effect and the
  // click below are two independent `exclusive()` sequences for the SAME place, back to back --
  // it is just no longer deterministically FORCED to overlap a paused fetch the way the file's
  // own header describes. That determinism now lives entirely in
  // `tests/analysis/concurrentPlaces.test.ts`'s "the same place analysed twice at once (scores +
  // Show analysis cells) never doubles its cells" (a real DuckDB, `Promise.all`, no UI/network
  // timing at all) -- unaffected by this file's change, and still the deterministic proof.
  await submitA(page);
  await held.requested; // A's own pre-add study-area check is on the engine now
  held.release();
  await expect(page.locator(".place-row").first()).toBeVisible({ timeout: 45_000 });

  const cellsBtn = page.getByRole("button", { name: "Show analysis cells" });
  await expect(cellsBtn).toBeEnabled({ timeout: 45_000 });
  await cellsBtn.click();
  // still a real assertion, unrelated to the race: the click's OWN loading state fires
  // synchronously (`loadingCells = true` before the `await`), whether or not anything is cached.
  await expect(page.getByRole("button", { name: "Loading analysed cells…" })).toBeVisible();

  await expectPanel(page, solo.a);
  await expect(page.getByRole("button", { name: "Show analysis cells" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 45_000 },
  );
  expect(await readPanel(page)).toEqual(solo.a); // still A's own, after the toggle finished
});

test("an upload refused mid-analysis leaves the running place's numbers its own", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000); // the solo readings (two cold boots) when this worker has none yet
  const solo = await soloReadings(browser);
  const held = await gotoRelease(page, true);
  // P8 item 6: A's OWN addition now runs the async study-area check first (see the comment on the
  // "two places back to back" test above) -- `submitA`, not `addA`, since A's row cannot appear
  // until this request (now A's own pre-add check, not its post-add scores effect) is released.
  await submitA(page);
  await held.requested; // A's own pre-add study-area check is on the engine now
  await upload(page, D_UPLOAD); // D's check rewrites the SAME tile's cell set A is reading
  await uploadInFlight(page);
  held.release();

  await expect(page.locator(".upload .refusal")).toContainText(
    "does not touch any cell inside this release's US study area",
    { timeout: 45_000 },
  );
  await expect(page.locator(".place-row")).toHaveCount(1, { timeout: 45_000 });
  await expectPanel(page, solo.a);
});
