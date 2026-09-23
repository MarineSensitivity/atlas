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
