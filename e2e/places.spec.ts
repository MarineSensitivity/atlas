// atlas-6 places: the gates that need a real browser but no live release data (no `app/boot.json`
// fixture is served here on purpose -- routeBucket's own header: "not published until atlas-1") --
// EXCEPT the fresh-profile round-trip test below, which is exactly the one case that needs a real
// release (a real boot.json + a tiny real `cell` parquet tile) to prove anything: the share link
// must reproduce not just the same geometry but the same COMPUTED cell count/composite.
// HERMETIC, same convention as e2e/shell.*.spec.ts: every bucket/tile origin is routed to a
// fixture, so no spec here ever reaches the live network.
//
// atlas-8 step 2: widened to all three engines (measured green on chromium/webkit/firefox);
// kept serial (a real MapLibre instance is expensive to boot repeatedly).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  BUCKET,
  collectRequests,
  gotoPublicShell,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";

test.describe.configure({ mode: "serial" });

async function openPlaces(page: Page) {
  await gotoPublicShell(page);
  await page.waitForSelector("#rail-region .rail", { state: "attached" });
  await page.locator("#rail-region button[aria-label='Places']").click();
}

async function addByCoordinates(page: Page, text = "-124.5, 40.0, -123.0, 41.5") {
  await page.getByRole("button", { name: "Enter coordinates" }).click();
  const textarea = page.getByLabel("Coordinates, bounding box, or WKT/GeoJSON");
  await expect(textarea).toBeVisible();
  await textarea.fill(text);
  await page.getByRole("button", { name: "Add place" }).click();
  await expect(page.locator(".place-row").first()).toBeVisible();
}

test("keyboard-only: Enter coordinates creates a place, rename, then remove -- drawing is never the only way", async ({
  page,
}) => {
  await openPlaces(page);

  // --- create by coordinates, keyboard only ------------------------------------------------------
  const coordButton = page.getByRole("button", { name: "Enter coordinates" });
  await coordButton.focus();
  await expect(coordButton).toBeFocused();
  await page.keyboard.press("Enter");

  const textarea = page.getByLabel("Coordinates, bounding box, or WKT/GeoJSON");
  await expect(textarea).toBeVisible();
  await textarea.focus();
  await page.keyboard.type("-124.5, 40.0, -123.0, 41.5");

  const addButton = page.getByRole("button", { name: "Add place" });
  await addButton.focus();
  await page.keyboard.press("Enter");

  const row = page.locator(".place-row").first();
  await expect(row).toBeVisible();

  // the place round-trips through #pl= -- URL-is-the-view (CLAUDE.md), never a second, local copy.
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#pl=g1\./);

  // --- rename, keyboard only ----------------------------------------------------------------------
  const renameInput = page.getByLabel("Rename place").first();
  await renameInput.focus();
  // atlas-8 step 2 finding: `Home` then `Shift+End` (the original sequence) reliably selects the
  // existing text on Chromium/Firefox, but WebKit's synthetic-keyboard-event handling for this
  // input did not update the DOM selection the same way -- the later `type()` call then INSERTED
  // rather than REPLACED, landing on a mixed "bounding boxMy Renamed Place" value (measured).
  // `ControlOrMeta+A` (select-all) is both simpler and the one keyboard shortcut every engine here
  // agrees on for this input's whole content, and it is still keyboard-only.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("My Renamed Place");
  await page.keyboard.press("Tab"); // blur -> onchange fires
  await expect(renameInput).toHaveValue("My Renamed Place");

  // --- remove, keyboard only ----------------------------------------------------------------------
  const deleteButton = page.getByRole("button", { name: "Delete place" }).first();
  await deleteButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".place-row")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
});

test("a hostile feature name renders as text -- never fires and never becomes markup", async ({
  page,
}) => {
  await openPlaces(page);
  await addByCoordinates(page);

  const dialogs: string[] = [];
  page.on("dialog", (d) => dialogs.push(d.message()));

  const renameInput = page.getByLabel("Rename place").first();
  await renameInput.fill("<img src=x onerror=alert(1)>");
  await renameInput.blur();

  // rendered as the LITERAL 29 characters in a plain <input> value -- an injected onerror would
  // have to actually be parsed as an <img> element to fire, which a text input value never does.
  await expect(renameInput).toHaveValue("<img src=x onerror=alert(1)>");
  await page.waitForTimeout(50);
  expect(dialogs).toEqual([]);
});

test("axe: zero serious/critical findings with the Places panel AND the coordinate dialog open", async ({
  page,
}) => {
  await openPlaces(page);
  await page.getByRole("button", { name: "Enter coordinates" }).click();
  await expect(page.getByLabel("Coordinates, bounding box, or WKT/GeoJSON")).toBeVisible();

  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
});

// atlas-8 phase review M8 (SC 3.3.1 Error Identification): docs/accessibility.md cites
// `CoordinateDialog.svelte:60`'s `role="alert"` refusal as evidence, but no test asserted a
// refusal actually renders as one in a real browser -- `tests/geo/upload/messages.test.ts` covers
// only the refusal COPY (`coords.ts`'s `R()` builders), never the live `role="alert"` wiring.
test("an unrecognized coordinate entry refuses as a role=alert, verbatim what/why/fix", async ({
  page,
}) => {
  await openPlaces(page);
  await page.getByRole("button", { name: "Enter coordinates" }).click();
  const textarea = page.getByLabel("Coordinates, bounding box, or WKT/GeoJSON");
  await expect(textarea).toBeVisible();
  await textarea.fill("this is not a coordinate");
  await page.getByRole("button", { name: "Add place" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(
    'This text doesn\'t read as a bounding box, a list of coordinates or WKT/GeoJSON: "this is not a coordinate".',
  );
  await expect(alert).toContainText("four comma-separated numbers");
  // never a submission: no place row is created from the refused text.
  await expect(page.locator(".place-row")).toHaveCount(0);
});

test("the hash is absent from every request the browser makes during the whole flow", async ({
  page,
}) => {
  const urls = collectRequests(page);
  await openPlaces(page);
  await addByCoordinates(page);
  await page.locator(".places-footer").getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("heading", { name: "Share" })).toBeVisible();

  // a browser never SENDS the fragment in a request by spec; the second-order check is that no
  // URL this app itself built (a fetch, an analytics payload logged as a request) carries the
  // literal g1-encoded payload either.
  const hash = await page.evaluate(() => location.hash.replace(/^#pl=/, ""));
  expect(hash.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url).not.toContain(hash);
  }
});

// --- fresh-profile round trip (fix round 1, Opus review item 4) --------------------------------
//
// A tiny, REAL release: a custom 48x48 test grid (one `cell_model`-partition tile, `tile=0`, so a
// single parquet file covers it), a `cell` tile with every cell `in_usa` (D7b's clip keeps them
// all) and one component metric column (`extrisk_test_ecoregion_rescaled`, matching
// METRIC_PATTERN), plus empty `taxon`/`zone_taxon`/`taxonomy` tables `AnalysisSources.coreTables()`
// always loads. Generated once with the `duckdb` CLI (same tool `scripts/parity/run.mjs` already
// depends on) and checked in as `e2e/fixtures/places/*.parquet` -- the same "generate once, commit
// the binary" convention as `e2e/fixtures/scores/zones20.pmtiles`. The default coordinate box
// `addByCoordinates()` already uses (`-124.5, 40.0, -123.0, 41.5`) sits well inside this grid's
// extent (lon -125..-122.6, lat 39.6..42) with margin on every side, so no cell the polygon touches
// falls outside the fixture's registered range.
const PLACES_FIXTURES = new URL("./fixtures/places/", import.meta.url);
const CELL_TILE0 = readFileSync(fileURLToPath(new URL("cell_tile0.parquet", PLACES_FIXTURES)));
const TAXON = readFileSync(fileURLToPath(new URL("taxon.parquet", PLACES_FIXTURES)));
const ZONE_TAXON = readFileSync(fileURLToPath(new URL("zone_taxon.parquet", PLACES_FIXTURES)));
const TAXONOMY = readFileSync(fileURLToPath(new URL("taxonomy.parquet", PLACES_FIXTURES)));

const ROUNDTRIP_VER = "v7"; // public per hermetic.ts's VERSIONS_FIXTURE -- no preview session needed

const ROUNDTRIP_BOOT = {
  schema: 1,
  ver: ROUNDTRIP_VER,
  built_at: "2026-09-22T00:00:00Z",
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
  units: [], // "no drawable unit published" -- already the pre-atlas-1 fallback path (boot.ts)
  layers: [
    {
      metric_key: "extrisk_test_ecoregion_rescaled",
      label: "Test component",
      category: "component",
      order: 1,
    },
  ],
};

/** every `{ver}/app/**` object this fixture publishes, by the path `dataUrl()`/`sources.ts` build. */
const ROUNDTRIP_FILES: Record<string, Buffer> = {
  [`${ROUNDTRIP_VER}/app/taxon.parquet`]: TAXON,
  [`${ROUNDTRIP_VER}/app/zone_taxon.parquet`]: ZONE_TAXON,
  [`${ROUNDTRIP_VER}/app/taxonomy.parquet`]: TAXONOMY,
  [`${ROUNDTRIP_VER}/app/cell/tile=0/data_0.parquet`]: CELL_TILE0,
};

async function routeRoundtripReleaseFiles(page: Page) {
  await page.route(
    (url) => url.href.startsWith(BUCKET) && url.href.includes("/app/"),
    (route) => {
      const path = route.request().url().slice(BUCKET.length);
      const body = ROUNDTRIP_FILES[path];
      // not one of THIS fixture's own objects (e.g. app/boot.json) -- fall through to routeBucket's
      // handler, registered before this one (Playwright tries newest-registered first; `fallback()`
      // hands off to the next match rather than this handler's own 404 shadowing the real boot.json).
      if (!body) return route.fallback();
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body });
    },
  );
}

/** the real engine, unblocked (this spec file never calls `blockWasm`) -- a real DuckDB-WASM boots
 * against the fixture above, exactly as it would against a real release. */
async function gotoPlacesWithRoundtripRelease(page: Page, path = "/") {
  await routeBucket(page, ROUNDTRIP_VER, ROUNDTRIP_BOOT);
  await routeRoundtripReleaseFiles(page);
  await routeSession(page, null);
  await routeSealFixture(page);
  await page.goto(path);
  await waitForHydration(page);
  await page.locator("#rail-region button[aria-label='Places']").click();
}

/** the ResultsPanel's own rendered numbers for the one selected place -- read from the DOM (no new
 * instrumentation hook), so the round trip is checked exactly the way a person would see it. */
async function readResultsPanel(page: Page): Promise<{ coverageNote: string; composite: string }> {
  // select the row ONLY if it is not already selected (`Places.svelte`'s `selectRow()` TOGGLES,
  // so clicking an already-selected row -- the case right after `addByCoordinates()`, whose
  // `writePlaces()` auto-selects the place it just added -- would deselect it and never render
  // ResultsPanel at all). And click the row's ICON, not the row-select button's own center: the
  // button also contains the rename `<input>` (`onclick={(e) => e.stopPropagation()}`, so a
  // person can select text without selecting the row), which covers most of the button's width --
  // a bare `.row-select.click()` in the fresh-profile context (nothing pre-selected there) lands on
  // the input and silently never fires `selectRow()`.
  const rowSelect = page.locator(".place-row .row-select").first();
  if ((await rowSelect.getAttribute("aria-pressed")) !== "true") {
    await rowSelect.locator(".icon").click();
  }
  const coverageNote = page.locator(".coverage-note");
  const composite = page.locator(".composite-figure strong");
  // a real DuckDB-WASM cold boot (worker + module + extension mirror) is slow the first time.
  await expect(coverageNote).toBeVisible({ timeout: 30_000 });
  await expect(composite).toBeVisible({ timeout: 30_000 });
  return {
    coverageNote: (await coverageNote.textContent())?.trim() ?? "",
    composite: (await composite.textContent())?.trim() ?? "",
  };
}

test("fresh-profile round trip: copying the link and opening it elsewhere recomputes the SAME cell count and composite", async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  test.setTimeout(120_000); // two real DuckDB-WASM cold boots, not the usual hermetic mock
  await gotoPlacesWithRoundtripRelease(page);
  await addByCoordinates(page); // the default box, well inside the fixture grid (see header comment)

  const original = await readResultsPanel(page);
  // a sanity check that this is a REAL computation, not two vacuously-equal blanks/NaNs. The
  // template's own whitespace/line breaks land in `textContent` verbatim, so this only requires
  // the digits and "cells" to appear, not an exact single-space rendering of the sentence.
  expect(original.coverageNote.replace(/\s+/g, " ")).toMatch(/[\d,]+ of [\d,]+ cells/);
  expect(Number(original.composite)).not.toBeNaN();

  // "copy the link": the analysed geometry's own #pl= (ShareDialog's copyLink() builds the SAME
  // string from `fit.hash`, which for a place this small is exactly the live #pl= already --
  // fitPlacesToUrl's silent tier never has to run the ladder).
  const hash = await page.evaluate(() => location.hash);
  expect(hash).toMatch(/^#pl=g1\./);

  // fresh profile: a brand-new browser context shares no storage, no session and no module-level
  // engine cache with the first -- opening the link here is a genuinely independent recomputation.
  const context2 = await browser.newContext();
  try {
    const page2 = await context2.newPage();
    await gotoPlacesWithRoundtripRelease(page2, `/${hash}`);
    const reopened = await readResultsPanel(page2);

    expect(reopened.coverageNote).toBe(original.coverageNote);
    expect(reopened.composite).toBe(original.composite);
  } finally {
    await context2.close();
  }
});
