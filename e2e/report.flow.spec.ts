// U6 (round 2): the top-bar "Report" button and the "report" rail tool do the obvious thing with
// what is currently selected (docs/usability.md M1) -- this is the end-to-end proof, one level up
// from tests/shell/report.test.ts's pure-function coverage of the same rule (reportAction(),
// src/shell/report.ts). HERMETIC, same convention as e2e/keyboard-walk.spec.ts's own "step 3" (whose
// `page.context().waitForEvent("page")` pattern for a `window.open()`-opened report this file
// reuses directly).
//
// Every place kind (zone/geom/upload) reaches "Done" under `blockWasm()` -- `loadPlaceData()`
// (src/report/data.ts) degrades every kind to a graceful `{scores:null, ...}` when the engine
// never boots, never a hang -- so this spec never needs a real DuckDB-WASM/Parquet fixture to
// prove "every place survived the hash", only that the COUNT and the NAMES did.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs } from "./map-hermetic";
import { hashFromPlaces } from "../src/places/model";
import type { GeomPlace, UploadPlace, ZonePlace } from "../src/lib/geo/placeCodec";

const VER = "v7"; // public per hermetic.ts's VERSIONS_FIXTURE -- no preview session needed

const BOOT = {
  ver: VER,
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  grid: { grid_id: "test05r" }, // no cell geometry -> the engine never boots (keyboard-walk's own note)
  release: { status: "release", access: "public" },
  units: [],
  zones: {
    programarea: [
      { key: "GAA", name: "Gulf of America", metrics: { composite: 73.4 } },
      { key: "MDA", name: "Mid Atlantic", metrics: { composite: 12.5 } },
    ],
  },
  datasets: [],
  layers: [],
};

const SQUARE: GeomPlace["geometry"] = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
};

async function gotoShell(page: Page, path: string): Promise<void> {
  // fixtures on the CONTEXT, not the page: a click may open report.html in a SECOND tab
  // (`window.open`), and a page-scoped `page.route()` would not follow it there.
  const ctx = page.context() as unknown as Page;
  await blockWasm(ctx);
  await routeBucket(ctx, VER, BOOT);
  await routeSession(ctx, null);
  await routeSealFixture(ctx);
  await routeBasemapStyle(ctx);
  await routeGlyphs(ctx);
  await page.goto(path);
  await waitForHydration(page);
}

test.describe("Report: a zone selected on the map", () => {
  test("Report opens report.html for that Program Area, in a new tab", async ({ page }) => {
    await gotoShell(page, "/?sel=zone:programarea:GAA");

    const [reportPage] = await Promise.all([
      page.context().waitForEvent("page"),
      page.locator('[data-control="report-top"]').click(),
    ]);
    await reportPage.waitForLoadState("domcontentloaded");

    // the URL carries the selection: report.html's own #pl= for exactly this one zone (the same
    // token TablePanel.svelte's "Report on selected" already builds -- z.pa.GAA).
    expect(reportPage.url()).toMatch(/report\.html/);
    expect(reportPage.url()).toContain(
      `#pl=${hashFromPlaces([{ kind: "zone", set: "pa", keys: ["GAA"] } satisfies ZonePlace])}`,
    );
    await expect(reportPage.locator("h1")).toHaveText("BOEM Marine Sensitivity Report");
    await expect(reportPage.locator(".progress-line").first()).toContainText("Done", {
      timeout: 15_000,
    });
    await expect(
      reportPage.locator("table", { hasText: "Mean component and overall scores" }),
    ).toContainText("Gulf of America");
    await reportPage.close();
  });
});

test.describe("Report: a place list present", () => {
  test("reports on every place in the list, in order, including one with a space in its name", async ({
    page,
  }) => {
    // three places, one of every kind the g1 codec carries -- deliberately including a NAME with a
    // space (the exact B2 regression shape: a drawn/typed/uploaded place's own `name`, corrupted by
    // the old zero-layer-encoded `#pl=${sel.pl}` splice, docs/usability.md).
    const places = [
      { kind: "zone", set: "pa", keys: ["MDA"] } satisfies ZonePlace,
      { kind: "geom", name: "Drawn place 1", geometry: SQUARE } satisfies GeomPlace,
      { kind: "upload", name: "upload-test", digest: "abc12345" } satisfies UploadPlace,
    ];
    const pl = hashFromPlaces(places);
    if (!pl) throw new Error("hashFromPlaces() returned no hash for a non-empty place list");
    // `pl` carries the g1 codec's OWN percent-escapes (model.ts's `reportHash()` header: a space
    // in a place name is already a literal "%20" INSIDE the token). A real deep link reaches the
    // address bar through `formatSel()` (one MORE layer of encoding, `URLSearchParams.toString()`)
    // so that `parseSel()`'s own single decode layer hands `sel.pl` back this exact string --
    // `encodeURIComponent` here is that same one layer, applied by hand for a deep link this test
    // builds directly rather than through the UI.
    await gotoShell(page, `/#pl=${encodeURIComponent(pl)}`);

    const [reportPage] = await Promise.all([
      page.context().waitForEvent("page"),
      page.locator('[data-control="report-top"]').click(),
    ]);
    await reportPage.waitForLoadState("domcontentloaded");

    // round-trips the SAME `pl` value, byte for byte -- not a second, hand-rolled re-encoding.
    const params = new URLSearchParams(new URL(reportPage.url()).hash.slice(1));
    expect(params.get("pl")).toBe(pl);

    // the B2 bug dropped 2 of 3 places silently ("Done — 1 place."); this must say all 3.
    await expect(reportPage.locator(".progress-line").first()).toContainText("Done — 3 places", {
      timeout: 15_000,
    });
    const tabs = reportPage.getByRole("tablist", { name: "Places" }).getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(tabs).toContainText(["Mid Atlantic", "Drawn place 1", "upload-test"]);
    await reportPage.close();
  });
});

test.describe("Report: nothing selected", () => {
  test("shows the chooser instead of a dead button, and opens no new tab", async ({ page }) => {
    await gotoShell(page, "/");

    let opened = false;
    page.context().on("page", () => (opened = true));
    await page.locator('[data-control="report-top"]').click();

    // the chooser (ReportTool.svelte, lazy) -- give it a moment to load, then assert its content,
    // never a bare `activeTool==="report"` internal check (that would pass even on the old
    // placeholder, which also just set `activeTool`).
    await expect(page.getByText("Pick an area to report on")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Draw, enter coordinates or upload a file" }),
    ).toBeVisible();

    // give a stray popup a moment to have shown up, then confirm it never did.
    await page.waitForTimeout(500);
    expect(opened).toBe(false);
  });
});
