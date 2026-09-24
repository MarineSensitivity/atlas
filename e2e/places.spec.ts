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
  collectConsoleErrors,
  collectRequests,
  gotoPublicShell,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";
import {
  BOOT_FIXTURE,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeZonesPmtiles,
} from "./map-hermetic";

test.describe.configure({ mode: "serial" });

async function openPlaces(page: Page, path = "/") {
  await gotoPublicShell(page, path);
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

// --- m6 (atlas-8 review round 2): the Places pick highlight, drawn outline and "show analysis
// cells" layer had NO rendered-feature assertion anywhere -- `selection-line`/`selection-fill`
// (map/style.ts#selectionLayers, source id "selection") is the ONE layer all three actually paint
// through (placesMap.svelte.ts's `outline`/`cells`, folded into Shell.svelte's `placesSelection`),
// so each test below polls `queryRenderedFeatures` on it exactly the way
// e2e/places.deeplink-outline.spec.ts's own gate does for the (different) deep-link-restore case.

async function selectionLineFeatureCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = window.__atlasMap!.handle.map;
    if (!map.getLayer("selection-line")) return -1;
    if (!map.isSourceLoaded("selection")) return -1;
    return map.queryRenderedFeatures({ layers: ["selection-line"] }).length;
  });
}

test("a drawn/entered place renders its outline as a real selection-line feature (m6)", async ({
  page,
}) => {
  // `map=` frames the camera on the SAME box `addByCoordinates()`'s default draws (its own
  // centre/zoom), matching `e2e/places.deeplink-outline.spec.ts`'s own header note (a real deep
  // link legitimately carries a camera too) -- the shell's DEFAULT camera (FALLBACK_FULL_STUDY_AREA,
  // globe projection, zoom 2.16 over the whole continental US) left `queryRenderedFeatures` a real,
  // reproducible false negative for a tiny (1.5deg) polygon: `selection-fill`/`selection-line` were
  // both present and loaded, the source genuinely carried the right geometry
  // (verified directly), but at that zoom the polygon rendered at too fine a scale for MapLibre to
  // ever report it as a hit -- 0 consistently, not a timing artifact (measured: still 0 after 24s+
  // of polling, isolated, no contention). This is the SAME class of false negative the `sel=cell:*`/
  // `sel=zone:MDA|CGA` fixes in `scripts/verify.mjs` needed a camera override for.
  await openPlaces(page, "/?map=-123.75,40.75,7");
  await addByCoordinates(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });

  await expect
    .poll(() => selectionLineFeatureCount(page), {
      message: "no selection-line feature rendered for the drawn/entered place's outline",
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});

/** `map-hermetic.ts`'s own `BOOT_FIXTURE`, extended with a `layers`/per-zone `metrics` block so
 * `programarea_fill` genuinely exists (not just `programarea_ln`) -- required for TWO independent
 * reasons found while wiring this test in, neither a hypothetical:
 *  1. `zoneAtPoint`'s hit-test (`installPickMode` -> `src/lib/map/interaction.ts`) only ever
 *     queries the LINE layer here regardless of fill presence (`Places.svelte`'s own `zoneUnits`
 *     prop is `zoneUnitsFromBoot(boot)` verbatim, `Shell.svelte` -- never the scores lens'
 *     fill-augmented copy, so `u.fill` is always unset) -- a click at a polygon's CENTROID is
 *     confirmably inside the fill yet never registers a pick; the click target below is a point ON
 *     the boundary LINE instead.
 *  2. `refreshOutline()` -> `renderedZoneOutline()` (`src/places/zoneOutline.ts`) queries BOTH
 *     `programarea_fill` AND `programarea_ln` UNCONDITIONALLY -- and MapLibre's whole-viewport
 *     `queryRenderedFeatures({layers})` (no point/bbox) THROWS "The layer '...' does not exist in
 *     the map's style" for a layer id absent from the CURRENT style, rather than silently skipping
 *     it (confirmed directly: the exact error surfaces as an uncaught exception inside the pick
 *     click handler when `programarea_fill` was never added). Without real per-zone metrics that
 *     throw fires on EVERY pick, before `mapStore.setOutline()` ever runs -- "Add to places (1)"
 *     appears (the pick itself succeeded) but no `selection-line` feature ever follows. No
 *     `palettes` needed: `zoneChoropleth()` falls back to a flat colour when none is published.
 */
const BOOT_FIXTURE_WITH_FILL = {
  ...BOOT_FIXTURE,
  zones: {
    programarea: BOOT_FIXTURE.zones.programarea.map((z, i) => ({
      ...z,
      metrics: { test_metric: 40 + i * 10 },
    })),
  },
  layers: [{ metric_key: "test_metric", label: "Test", category: "composite", order: 1 }],
};

async function gotoPlacesWithZones(page: Page): Promise<void> {
  await blockWasm(page);
  await routeBucket(page, "v7", BOOT_FIXTURE_WITH_FILL);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.goto("/?unit=programarea");
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  await page.locator("#rail-region button[aria-label='Places']").click();
}

test("Pick mode highlights the clicked zone as a real selection-line feature (m6)", async ({
  page,
}) => {
  await gotoPlacesWithZones(page);

  // BOTH layers must actually be rendered before Pick mode can hit-test/outline against them (see
  // gotoPlacesWithZones's own header for why both are load-bearing here, not just the line).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = window.__atlasMap!.handle.map;
          if (!map.getLayer("programarea_ln") || !map.getLayer("programarea_fill")) return -1;
          if (!map.isSourceLoaded("programarea_src")) return -1;
          return map.queryRenderedFeatures({ layers: ["programarea_ln"] }).length;
        }),
      { message: "the programarea_ln/programarea_fill layers never rendered", timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Pick mode" }).click();

  // a REAL click (page.mouse via the map <div>'s own bounding box), not a synthetic map.fire --
  // this exercises installPickMode's actual `map.on("click", ...)` handler. `#map`'s top-left is
  // the SAME origin `map.project()` returns coordinates in, so `{position}` needs no extra offset
  // math for wherever the Places panel happens to have pushed the map container. The click target
  // is a point ON the polygon's OWN boundary (`e2e/fixtures/map/zones.geojson`'s real GAA
  // rectangle, lon -96..-84 / lat 24..30 -- (-90, 30) is its top edge's exact midpoint), not its
  // centroid: `zoneAtPoint` here only ever queries the LINE layer (see this test's own goto
  // helper), and a click inside the polygon's interior never lands on it.
  const point = await page.evaluate(() => window.__atlasMap!.handle.map.project([-90, 30]));
  await page.locator("#map").click({ position: { x: point.x, y: point.y } });

  await expect(page.getByRole("button", { name: /Add to places \(1\)/ })).toBeVisible({
    timeout: 10_000,
  });

  await expect
    .poll(() => selectionLineFeatureCount(page), {
      message: "Pick mode's own highlight never rendered a selection-line feature",
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
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

// m6 (atlas-8 review round 2): "show analysis cells" is the THIRD selection-layer consumer with no
// rendered-feature assertion anywhere. Needs the SAME real engine as the round trip above --
// `toggleAnalysisCells()` (Places.svelte) round-trips through `placeCellsInStudyArea()`, a real
// DuckDB-WASM query, not a pure function this file's hermetic (no-`app/boot.json`) tests could
// exercise.
test("'show analysis cells' paints the covered cells as a real selection-line feature (m6)", async ({
  page,
}) => {
  test.setTimeout(60_000); // a real DuckDB-WASM cold boot, like the round trip above
  // `map=` frames the camera on the drawn box, same fix and same reason as the "drawn/entered
  // place" test above: the default FALLBACK_FULL_STUDY_AREA camera left `queryRenderedFeatures`
  // a real false negative for these small cell squares.
  await gotoPlacesWithRoundtripRelease(page, "/?map=-123.75,40.75,7");
  await addByCoordinates(page); // auto-selects the place it just added (writePlaces())

  const cellsPill = page.getByRole("button", { name: "Show analysis cells" });
  await expect(cellsPill).toBeEnabled({ timeout: 15_000 });
  await cellsPill.click();

  await expect
    .poll(() => selectionLineFeatureCount(page), {
      message: "'show analysis cells' never rendered a selection-line feature for any covered cell",
      timeout: 30_000, // a real placeCellsInStudyArea() round trip through the engine
    })
    .toBeGreaterThan(0);
});

// P8 item 4 (Opus docs review, app finding #5): `DataTable.svelte` always renders "Export CSV" and
// calls `onExport?.(rows)` -- `ResultsPanel.svelte` used to pass NEITHER of its two DataTables an
// `onExport`, so the button was silently dead. Needs the SAME real engine as the round trip above:
// a real `scoreResults.components` list is what the Components table (and its export) render from.
test("P8 item 4: 'Export CSV' on the place results' Components table actually downloads a file", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await gotoPlacesWithRoundtripRelease(page, "/?map=-123.75,40.75,7");
  await addByCoordinates(page);
  await readResultsPanel(page); // waits for a real composite -- the Components table is now rendered

  const exportBtn = page
    .locator(".results")
    .getByRole("button", { name: "Export visible rows as CSV" })
    .first();
  await expect(exportBtn).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), exportBtn.click()]);
  expect(download.suggestedFilename()).toMatch(/_components_\d{4}-\d{2}-\d{2}\.csv$/);
});

// P8 item 7, UPDATED for Q2 (0.10.52): this test used to assert that `UploadPanel.svelte`
// hardcoded its GeoPackage dependency's `runtime` to `null`, so every `.gpkg` was refused with a
// substitute "not supported yet" sentence, unconditionally -- the honest thing to say when
// `parseGeoPackage` could never actually read one. Q2 wired a REAL `GeoPackageRuntime` (the same
// DuckDB-WASM engine the scores boot, `lib/geo/upload/engineRuntime.ts`), so a `.gpkg` now
// genuinely reads and that assertion is now false: dropping one no longer says "not supported".
// This test now asserts the NEW truth instead of the old one -- a point-only GeoPackage is read
// successfully and refused by rule 3 (polygons only), the same as any other point-only file would
// be, never by the old, now-permanently-wrong "not supported"/"wait and retry" text. A polygon
// GeoPackage producing a real place + composite is proven end to end in Q2's own spec,
// `e2e/places.upload-geopackage.spec.ts` ("a real .gpkg is read end to end: polygon in, place +
// computed composite out") -- not duplicated here. Needs a REAL working engine to reach rule 3 at
// all (a real `INSTALL`/`LOAD spatial`), so this test uses `gotoPlacesWithRoundtripRelease`
// (below) rather than the plain hermetic `openPlaces`.
test("P8 item 7, updated for Q2: a real .gpkg reads -- a point-only one is refused by rule 3, never 'not supported yet'", async ({
  page,
}) => {
  test.setTimeout(120_000); // a real DuckDB-WASM cold boot AND a real ~23 MB third-party fetch
  page.on("dialog", (d) => d.accept()); // the GeoPackage consent prompt (window.confirm)

  await gotoPlacesWithRoundtripRelease(page);
  await page
    .locator(".upload input[type='file']")
    .setInputFiles(
      fileURLToPath(new URL("../tests/fixtures/upload/gpkg_point.gpkg", import.meta.url)),
    );

  const refusalPanel = page.locator(".upload .refusal");
  await expect(refusalPanel).toBeVisible({ timeout: 30_000 });
  await expect(refusalPanel).toContainText("a Point"); // notPolygon, rule 3
  // the OLD text this replaces -- must be gone, never merely joined by the new sentence.
  await expect(refusalPanel).not.toContainText("not supported yet");
  await expect(refusalPanel).not.toContainText("not running in this tab yet");
  await expect(refusalPanel).not.toContainText("Wait for the map's numbers");
  // the drop-zone's own accepted-format hint no longer claims GeoPackage doesn't work.
  await expect(page.locator(".dropzone")).not.toContainText("(not yet)");
});

// item 3b (atlas-8 review round 2): "Show analysis cells" could paint the PREVIOUS place's cells
// when the selection changed mid-load -- `toggleAnalysisCells()` (Places.svelte) snapshotted the
// place before its two `await`s and applied whatever came back unconditionally. `cellsToken` now
// keys the load on the place and drops a late result once the selection has moved on.
//
// FIXME (P9, orchestrator-requested, 2026-09-24): this test cannot force the race it claims to --
// investigated with millisecond-timestamped network/worker instrumentation, not guessed at:
// the ONE shared `cell/tile=0` fetch both places need completes ~1.5s before any `page.route()`
// registered at this test's own call site (after both places exist) can possibly hold it.
// The fixed 2.5s route delay only shifts UNRELATED scheduling -- it does not force the overlap --
// and against the current (correctly guarded) code, 4 of 6 repeat runs fail on BOTH chromium and
// webkit, not just webkit (measured: `--repeat-each=3` on each engine).
// A real fix needs a test-only hook into `toggleAnalysisCells()`'s own async gap (or a component-
// test harness this repo doesn't have yet), not another network/worker timing trick -- follow-up.
test.fixme("'show analysis cells' drops a late result once the selection moves to a different place (item 3b)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await gotoPlacesWithRoundtripRelease(page, "/?map=-123.75,40.5,6");
  await addByCoordinates(page, "-124.5, 40.0, -123.0, 41.5"); // place A -- auto-selected
  await addByCoordinates(page, "-124.9, 39.0, -124.6, 39.8"); // place B -- auto-selected instead
  await expect(page.locator(".place-row")).toHaveCount(2);

  // select place A (row 0) and delay the ONE cell tile this fixture publishes (both places' loads
  // read the same tile, `grid.tile.size === grid.nc`) so A's "show analysis cells" load is still
  // in flight when the selection below moves to B.
  await page.locator(".place-row .row-select").nth(0).locator(".icon").click();
  await page.route(
    (url) => /\/app\/cell\/tile=0\/data_0\.parquet$/.test(url.pathname),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: CELL_TILE0,
      });
    },
  );
  const cellsPill = page.getByRole("button", { name: "Show analysis cells" });
  await expect(cellsPill).toBeEnabled({ timeout: 15_000 });
  await cellsPill.click(); // place A's load starts, held ~2.5s by the route above

  // before it resolves, select place B instead (B's own toggle is never clicked)
  await page.locator(".place-row .row-select").nth(1).locator(".icon").click();

  // give A's held fetch time to resolve and (if the bug were back) paint its stale result
  await page.waitForTimeout(4000);

  // A's late result was dropped: the toggle never turns "on" under B's selection (B's own outline
  // still renders as an ordinary selection-line/-fill feature -- that IS correct, so this checks
  // for a CELL SQUARE specifically: `cellSquares.ts` gives every one a `pct` property an outline
  // feature never carries).
  await expect(cellsPill).toHaveAttribute("aria-pressed", "false");
  const staleCellSquares = await page.evaluate(() => {
    const map = window.__atlasMap!.handle.map;
    if (!map.getLayer("selection-fill")) return 0;
    return map
      .queryRenderedFeatures({ layers: ["selection-fill"] })
      .filter((f) => typeof (f as { properties?: { pct?: unknown } }).properties?.pct === "number")
      .length;
  });
  expect(staleCellSquares).toBe(0);
});

// item m4 (atlas-8 review round 2): `showCells` used to be `Places.svelte`'s own local `$state`,
// which reset to its default the instant the component unmounted -- switching to a different rail
// tool (Shell.svelte mounts Places lazily, keyed on `activeTool === "places"`) and back left the
// toggle reading "off" while `mapStore.cells` (a SEPARATE, store-level bucket) stayed painted, so
// the pill and the map disagreed. `showCells` now lives in `placesMap.svelte.ts`'s store, the SAME
// lifetime as `cells` -- both survive the panel's own mount/unmount.
test("the 'Show analysis cells' toggle survives a tool switch + remount, matching what stays painted (item m4)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await gotoPlacesWithRoundtripRelease(page, "/?map=-123.75,40.75,7");
  await addByCoordinates(page); // auto-selected

  const cellsPill = page.getByRole("button", { name: "Show analysis cells" });
  await expect(cellsPill).toBeEnabled({ timeout: 15_000 });
  await cellsPill.click();
  await expect(cellsPill).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await expect
    .poll(() => selectionLineFeatureCount(page), {
      message: "cells never painted before the tool switch",
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  // switch away -- Places.svelte (and its local component state, if any survived here) unmounts.
  await page.locator("#rail-region button[aria-label='Layers']").click();
  await expect(page.locator(".place-row")).toHaveCount(0); // the Places panel body is gone

  // switch back -- Places.svelte remounts from scratch.
  await page.locator("#rail-region button[aria-label='Places']").click();
  await expect(page.locator(".place-row")).toHaveCount(1);

  // the toggle still reads "on" (not reset to the component's own default), and the cells it
  // describes are still the ones painted -- store-backed state, not panel-local state.
  await expect(page.getByRole("button", { name: "Show analysis cells" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await selectionLineFeatureCount(page)).toBeGreaterThan(0);
});

// --- P7 ("drawn places vanish from the map after the second draw, and are 'not analysed yet'") ---
//
// Root cause 1 (Rule 1, "every place is drawn at all times"): `placesMap.svelte.ts`'s baseline
// used to be `model.ts#selectedGeomPlaceGeometry` -- exactly ONE place, whichever `sel.sel` named.
// Drawing a second place auto-selects it (`Places.svelte#writePlaces`), so the map's ONE visible
// outline moved onto the new place and the one drawn just before it silently vanished. Fixed by
// `model.ts#allGeomPlacesOutline` -- every `kind: "geom"` place, always -- and `composeOutline`
// becoming a UNION (an interaction override no longer displaces the baseline, only adds to it).
//
// Root cause 2 (Rule 1's "after ANY style re-composition", Rule 3's fault "the circle tool
// bypassing writePlaces"): terra-draw adds its OWN `td-*` sources/layers straight to the live map
// (draw.ts's own header), never through `composeStyle()` -- so `map/style.ts#applyStyle`'s
// `setStyle(diff:true)`, fired reactively on every finished draw (`writePlaces()` changes `sel.pl`),
// silently REMOVED them (MapLibre's diff drops anything in the current style but absent from the
// new one). Terra-draw's own next render then threw `TypeError: Cannot read properties of
// undefined (reading 'setData')` (its adapter calling `.setData()` on a source that no longer
// existed) -- an UNCAUGHT error, live-reproduced, that left the draw session unable to complete a
// second shape reliably. Fixed by `map/style.ts#preserveDrawLayers` -- `applyStyle()` now copies any
// live `td-`-prefixed source/layer the new style doesn't already carry back in, so MapLibre's diff
// never touches them.
//
// A REAL terra-draw session (real `pointerdown`/`pointerup` sequences on the map canvas, not a
// synthetic `map.fire`) -- the whole point of both bugs is what a real draw does to the live style.
test.describe("P7: places drawn in sequence stay on the map, survive a reload, and a delete only removes one", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** the canvas-offset-aware screen point for a lon/lat -- `page.mouse` needs viewport-absolute
   * coordinates, `map.project()` returns canvas-relative ones (same technique as
   * `e2e/places.pick.spec.ts#screenPointFor`, copied rather than imported: that helper is that
   * file's own local, not a shared export). */
  async function mapPoint(page: Page, lonLat: [number, number]) {
    return page.evaluate((ll) => {
      const map = window.__atlasMap!.handle.map;
      const rect = map.getCanvas().getBoundingClientRect();
      const p = map.project(ll);
      return { x: rect.left + p.x, y: rect.top + p.y };
    }, lonLat);
  }

  /** a small real triangle, drawn point by point then closed on its own first vertex -- terra-draw's
   * own polygon-finish gesture. Clicking "Done" afterwards (present whenever `drawMode` is set)
   * leaves the session settled before the NEXT shape starts, matching how a real user pauses between
   * two drawn places. */
  async function drawPolygonAt(page: Page, points: [number, number][]) {
    await page.getByRole("button", { name: "Polygon" }).click();
    for (const ll of points) {
      const p = await mapPoint(page, ll);
      await page.mouse.move(p.x, p.y, { steps: 3 });
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(250);
    }
    const first = await mapPoint(page, points[0]);
    await page.mouse.dblclick(first.x, first.y);
    await page.waitForTimeout(1500); // let the finish -> writePlaces -> style recompose settle
    const doneButton = page.getByRole("button", { name: "Done" });
    if (await doneButton.count()) {
      await doneButton.click();
      await page.waitForTimeout(300);
    }
  }

  /** click-move-click: terra-draw's circle-mode gesture (centre, then the edge that sets the
   * radius and finishes the shape). */
  async function drawCircleAt(page: Page, center: [number, number], edge: [number, number]) {
    await page.getByRole("button", { name: "Circle" }).click();
    await page.waitForTimeout(300);
    const c = await mapPoint(page, center);
    const e = await mapPoint(page, edge);
    await page.mouse.move(c.x, c.y, { steps: 5 });
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(400);
    await page.mouse.move(e.x, e.y, { steps: 8 });
    await page.waitForTimeout(200);
    await page.mouse.click(e.x, e.y);
    await page.waitForTimeout(1500);
  }

  // two real, well-separated shapes -- far enough apart that one camera cannot frame both without
  // the SAME false-negative `queryRenderedFeatures` risk `e2e/places.spec.ts`'s own "drawn/entered
  // place" test documents (a tiny polygon at too wide a zoom never registers as a hit); each is
  // checked under its OWN reframed camera instead.
  const SHAPE_A: [number, number][] = [
    [-143.3, 58.3],
    [-142.9, 57.0],
    [-139.5, 57.2],
  ];
  const SHAPE_A_CAMERA = "-141.5,58,7";
  const SHAPE_B_CENTER: [number, number] = [-120.6, 34.6];
  const SHAPE_B_EDGE: [number, number] = [-119.0, 34.6];
  const SHAPE_B_CAMERA = "-120,34.6,7";

  async function gotoWideDrawSession(page: Page) {
    await gotoPublicShell(page, "/?map=-130,46,3"); // wide enough to click BOTH shapes accurately
    await page.waitForSelector("#rail-region .rail", { state: "attached" });
    await page.locator("#rail-region button[aria-label='Places']").click();
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  }

  /** reloads fresh (a real page.goto, not an in-session pan) at `camera` carrying `hash` --
   * `window.__atlasMap`'s own declared shape (shared across every e2e file that uses it) has no
   * `flyTo`/`jumpTo`, so reframing the camera goes through the SAME `?map=` mechanism a real shared
   * link already uses -- which is also exactly what "reload the page with the resulting #pl=" means.
   * `activeTool` is ephemeral chrome, never URL state (Places.svelte's own comment) -- a fresh load
   * always starts on "Layers", so this re-opens Places every time, matching what a person clicking
   * a shared link and then opening the Places panel would see. */
  async function gotoFramedOn(page: Page, camera: string, hash: string) {
    await page.goto(`/?map=${camera}${hash}`);
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    await page.locator("#rail-region button[aria-label='Places']").click();
  }

  test("draw AK1 (polygon) then CA circle: both stay on the map, survive a reload, and deleting one leaves the other", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectConsoleErrors(page);
    await gotoWideDrawSession(page);

    await drawPolygonAt(page, SHAPE_A);
    await expect(page.locator(".place-row")).toHaveCount(1);

    await drawCircleAt(page, SHAPE_B_CENTER, SHAPE_B_EDGE);
    await expect(page.locator(".place-row")).toHaveCount(2);

    const hash = await page.evaluate(() => location.hash);
    // "~" is the codec's own place separator (placeCodec.ts), percent-escaped once more by
    // `formatSel`'s own URLSearchParams encoding -- "%7E", not a literal "~" -- both places really
    // are in the ONE shared hash.
    expect(hash).toMatch(/^#pl=g1\..*%7Eg1\./i);

    // --- both places' outlines render, each proven under its own camera -----------------------
    await gotoFramedOn(page, SHAPE_A_CAMERA, hash);
    await expect
      .poll(() => selectionLineFeatureCount(page), {
        message: "shape A's outline never rendered after both were drawn",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    await gotoFramedOn(page, SHAPE_B_CAMERA, hash);
    await expect
      .poll(() => selectionLineFeatureCount(page), {
        message: "shape B's outline never rendered after both were drawn",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await expect(page.locator(".place-row")).toHaveCount(2); // the reload reproduced BOTH rows too

    // --- delete shape A: shape B stays drawn, shape A's own spot goes empty --------------------
    await page.locator("#rail-region button[aria-label='Places']").click();
    await page.locator(".place-row .row-actions button[aria-label='Delete place']").first().click();
    await expect(page.locator(".place-row")).toHaveCount(1);
    const hashAfterDelete = await page.evaluate(() => location.hash);
    expect(hashAfterDelete).not.toContain("~"); // one place left -- no separator

    await gotoFramedOn(page, SHAPE_B_CAMERA, hashAfterDelete);
    await expect
      .poll(() => selectionLineFeatureCount(page), {
        message: "shape B vanished too after deleting shape A",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    await gotoFramedOn(page, SHAPE_A_CAMERA, hashAfterDelete);
    expect(await selectionLineFeatureCount(page)).toBe(0); // deleted shape A stays gone

    expect(errors).toEqual([]); // no uncaught terra-draw crash anywhere in this whole flow
  });

  // Rule 3's own fault: the circle tool's completion path must write through the SAME
  // `writePlaces()` the polygon tool does -- fault-registry entry "places-circle-bypasses-writeplaces"
  // reverts this to bypass it and must turn this red.
  test("the circle tool's completion path writes through the same writePlaces() as the polygon tool", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await gotoWideDrawSession(page);

    await drawCircleAt(page, SHAPE_B_CENTER, SHAPE_B_EDGE);

    await expect(page.locator(".place-row")).toHaveCount(1);
    const hash = await page.evaluate(() => location.hash);
    // a REAL g1 (geom) token -- proves the circle's finished geometry went through the SAME encoder
    // every other drawn/entered place does, not a different or skipped path.
    expect(hash).toMatch(/^#pl=g1\.Drawn(%2520|%20|\s)place%25201\./);
  });

  // P8 item 9 (P7 handback): `stopDraw()`'s `drawMode = drawMode ? "select" : null` was a no-op --
  // "Done" only ever renders while `drawMode` is truthy, so at the button's own click handler the
  // ternary always reassigned `"select"`, never `null`. "Done" therefore never disappeared, and the
  // draw session never released `mapStore.setInteractionOwned`'s claim on map clicks.
  test("clicking Done actually ends draw mode: the Done button disappears", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoWideDrawSession(page);
    await drawPolygonAt(page, SHAPE_A); // drawPolygonAt's own last step already clicks Done once

    // drawPolygonAt clicked Done already (if present) -- assert what that click should have done:
    // no "Done" button left anywhere in the panel, i.e. drawMode really is back to null.
    await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);

    // draw a SECOND shape from a clean (non-draw) state to prove the session was a full teardown,
    // not merely hidden chrome: starting a fresh Polygon still works after "Done".
    await drawCircleAt(page, SHAPE_B_CENTER, SHAPE_B_EDGE);
    const doneAgain = page.getByRole("button", { name: "Done" });
    await expect(doneAgain).toBeVisible();
    await doneAgain.click();
    await expect(doneAgain).toHaveCount(0);
  });

  // P9 (Opus docs re-check appendix finding A1, live-verified on 0.10.48): terra-draw fires its
  // `finish` event on a SELECT-MODE EDIT too (drag a corner), not only on a fresh draw -- the app
  // used to treat every finish as a new shape, so dragging a just-drawn rectangle's corner turned
  // one row ("Drawn place 1") into two ("Drawn place 1" unchanged + "Drawn place 2", the edit).
  // Fixed by keying finishes to terra-draw's own feature id (`drawFeatures.ts`): an edit of a
  // feature this session already drew now updates that SAME row instead.
  test("dragging a drawn shape's corner UPDATES the place -- never adds a duplicate", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await gotoWideDrawSession(page);

    // a real rectangle: click-move-click at opposite corners (terra-draw's default "click-move"
    // gesture, the same shape drawCircleAt already uses for circle mode).
    const CORNER_A: [number, number] = [-150, 52];
    const CORNER_B: [number, number] = [-140, 44];
    await page.getByRole("button", { name: "Rectangle" }).click();
    await page.waitForTimeout(300);
    const cornerA = await mapPoint(page, CORNER_A);
    const cornerB = await mapPoint(page, CORNER_B);
    await page.mouse.move(cornerA.x, cornerA.y, { steps: 5 });
    await page.mouse.click(cornerA.x, cornerA.y);
    await page.waitForTimeout(300);
    await page.mouse.move(cornerB.x, cornerB.y, { steps: 8 });
    await page.waitForTimeout(200);
    await page.mouse.click(cornerB.x, cornerB.y);
    await page.waitForTimeout(1500); // finish -> writePlaces -> select-mode settle

    await expect(page.locator(".place-row")).toHaveCount(1);
    await expect(page.locator(".place-row .row-name").first()).toHaveValue("Drawn place 1");
    const hashBefore = await page.evaluate(() => location.hash);
    const areaBefore = await page.locator(".place-row .row-stat").first().innerText();

    // select the just-drawn shape (terra-draw's select mode needs a click on the feature body,
    // not just `setMode("select")`, to actually select it for editing -- live-verified: "click
    // inside it" is the reviewer's own repro step) -- the screen-space midpoint of the two clicked
    // corners is guaranteed inside the rectangle regardless of Mercator distortion.
    const center = { x: (cornerA.x + cornerB.x) / 2, y: (cornerA.y + cornerB.y) / 2 };
    await page.mouse.move(center.x, center.y, { steps: 5 });
    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(300);

    // drag corner A outward with REAL pointer events (mousedown/move/up, not a synthetic map.fire).
    await page.mouse.move(cornerA.x, cornerA.y, { steps: 5 });
    await page.mouse.down();
    await page.mouse.move(cornerA.x - 60, cornerA.y - 60, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1000); // finish -> writePlaces settle

    // ONE row still, not two -- the bug this test catches appended "Drawn place 2" here.
    await expect(page.locator(".place-row")).toHaveCount(1);
    await expect(page.locator(".place-row .row-name").first()).toHaveValue("Drawn place 1");

    const hashAfter = await page.evaluate(() => location.hash);
    expect(hashAfter).not.toBe(hashBefore); // the SAME row's own geometry moved
    const areaAfter = await page.locator(".place-row .row-stat").first().innerText();
    expect(areaAfter).not.toBe(areaBefore); // the visible area actually changed
  });
});

// Rule 2 ("a newly drawn/added place is analysed automatically, so its row shows numbers, not
// 'not analysed yet'"): `rowFigures()` (Places.svelte) used to hard-code `composite: null` for
// EVERY `kind: "geom"` row, unconditionally -- Deliverable 5's own comment called this out as a
// placeholder nothing ever came back to wire up once the SQL twins existed. Now every geom place
// gets analysed the moment it exists (`results.ts#placeRowAnalysis` over a `placeScores` cache),
// not only the one row currently selected -- proven here by asserting place A's OWN row shows a
// composite while place B (added after it) is the one actually selected, so ONLY the list-level
// effect (never `ResultsPanel.svelte`'s own per-selection one) could have analysed it.
test("Rule 2: a drawn/entered place is analysed automatically WITHOUT being selected", async ({
  page,
}) => {
  test.setTimeout(60_000); // a real DuckDB-WASM cold boot, like the round trip above
  await gotoPlacesWithRoundtripRelease(page, "/?map=-123.75,40.5,6");
  await addByCoordinates(page, "-124.5, 40.0, -123.0, 41.5"); // place A -- auto-selected
  await addByCoordinates(page, "-124.9, 39.0, -124.6, 39.8"); // place B -- auto-selected instead
  await expect(page.locator(".place-row")).toHaveCount(2);

  // place A (row 0) is NOT selected right now (place B, the one added most recently, is) --
  // confirmed by aria-pressed, so a composite showing up on row 0 cannot be ResultsPanel's doing.
  await expect(page.locator(".place-row .row-select").nth(0)).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  const rowAChip = page.locator(".place-row").nth(0).locator(".chip").first();
  await expect(rowAChip).toHaveText(/composite/, { timeout: 30_000 });
  await expect(rowAChip).not.toHaveText("not analysed yet");
});

// P8 item 2 (P7 handback + Opus docs review finding #27): `zoneStatFromBoot` used to read
// `composite`/`score`/`pct_covered`/`coverage` off the TOP of a `boot.zones` row -- none of which a
// real release publishes. A real v7 Program-Area row (verified live,
// `s3://.../marine-atlas/v7/app/boot.json`, `zones.programarea[0]`) is
// `{ key, n_cells, area_km2, n_taxa, metrics: { ...score_extriskspcat_..._equalweights }, coverage:
// null }` -- so EVERY Program-Area row read "not analysed yet" forever, even fully published ones.
// No engine/DuckDB needed for this (`zoneStats.ts`'s own header: "Tier 0 -- it's already in
// boot.json"), so this fixture needs no release parquet, only a `boot.json` shaped like the real
// one.
test("P8 item 2: a Program Area row shows its published composite, read from the REAL v7 boot.json shape", async ({
  page,
}) => {
  const boot = {
    schema: 1,
    ver: "v7",
    grid_id: "usa05",
    grid: {
      nc: 3103,
      nr: 2006,
      xmin: 141.1,
      ymax: 74.75,
      resx: 0.05,
      resy: 0.05,
      lon360: true,
      tile: { size: 50 },
    },
    study_areas: [{ key: "FULL", label: "All US waters", lon: -101.3, lat: 46.9, zoom: 2.16 }],
    units: [],
    layers: [
      { metric_key: "extrisk_bird_ecoregion_rescaled", category: "component", order: 1 },
      {
        metric_key: "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
        label: "Combined score",
        category: "composite",
        order: 2,
      },
    ],
    zones: {
      programarea: [
        {
          key: "GAA",
          n_cells: 45790,
          area_km2: 875225.03,
          n_taxa: 2503,
          metrics: {
            extrisk_bird_ecoregion_rescaled: 42.39,
            score_extriskspcat_primprod_ecoregionrescaled_equalweights: 27.2,
          },
          coverage: null,
        },
      ],
    },
  };
  await routeBucket(page, "v7", boot);
  await routeSession(page, null);
  await routeSealFixture(page);
  await page.goto("/");
  await waitForHydration(page);
  await page.locator("#rail-region button[aria-label='Places']").click();

  await page.getByLabel("Add a Program Area").selectOption("GAA");
  await page.getByRole("button", { name: "Add this Program Area" }).click();

  const row = page.locator(".place-row").first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("27.2 composite");
  await expect(row).not.toContainText("not analysed yet");
});
