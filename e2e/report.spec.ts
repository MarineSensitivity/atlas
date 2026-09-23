import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { routeBucket, routeSealFixture, routeSession } from "./hermetic";
import { blockWasm } from "./map-hermetic";

// atlas-7 steps 2-4: report.html's own hermetic smoke suite. HERMETIC per this repo's convention
// (e2e/hermetic.ts): every bucket URL is `page.route`d to a fixture, never the live network.
//
// SCOPE (disclosed, not hidden): these specs exercise ZONE places only, whose scores/species/N
// cells/area come straight out of `boot.json` (model.ts#zoneComponents/#zoneScoreInput) with NO
// DuckDB-WASM query at all for scores. The species table DOES need the engine (`speciesForZone()`
// over `zone_taxon`), which needs a real DuckDB-WASM boot against real Parquet fixtures this suite
// does not build — `blockWasm()` (map-hermetic.ts) makes that failure fast and deterministic
// instead of a slow, real WASM boot followed by a 404, so every place's species section renders
// "No species found for this area." here (an artifact of this suite's fixtures, not a claim that
// the real pipeline finds none). A custom (drawn) place's engine-backed path — and the full PDF/
// DOCX/HTML-download/permalink-reproducibility checklist lines — are NOT covered by this file; see
// this phase's final report for the complete list of what is and is not gated here.
const BOOT_V9 = {
  ver: "v9",
  built_at: "2026-09-05T00:00:00Z",
  msens: "0.43.0",
  id_field: "mdl_key",
  grid: { grid_id: "global05" },
  release: { status: "prerelease", access: "restricted" },
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "Gulf of America",
        n_cells: 14238,
        area_km2: 600000,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 50,
          extrisk_fish_ecoregion_rescaled: 30,
          score_extriskspcat_primprod_ecoregionrescaled_equalweights: 40,
        },
      },
      {
        key: "ALA",
        name: "Alaska",
        n_cells: 45685,
        area_km2: 900000,
        metrics: {
          extrisk_bird_ecoregion_rescaled: 55,
          extrisk_fish_ecoregion_rescaled: 20,
        },
      },
    ],
  },
  tables: { cell: { href: "https://example.test/v9/tables/cell.parquet", digest: "d-cell" } },
  datasets: [
    { ds_key: "a", name_display: "A Dataset", citation: "A. Author 2026.", sort_order: 1 },
  ],
  palettes: {
    spectral_r: [
      "#9E0142",
      "#D53E4F",
      "#F46D43",
      "#FDAE61",
      "#FEE08B",
      "#FFFFBF",
      "#E6F598",
      "#ABDDA4",
      "#66C2A5",
      "#3288BD",
      "#5E4FA2",
    ],
  },
};

const BOOT_V7 = {
  ...BOOT_V9,
  ver: "v7",
  release: { status: "release", access: "public" },
};

// z.pa.GAA,ALA -- the g1 place codec's zone-place token, two Program Area keys.
const PL = "z.pa.GAA%2CALA";

async function gotoReport(
  page: import("@playwright/test").Page,
  opts: { ver: "v9" | "v7"; preview?: boolean; pl?: string },
) {
  await blockWasm(page);
  await routeBucket(page, opts.ver, opts.ver === "v9" ? BOOT_V9 : BOOT_V7);
  await routeSession(page, opts.preview ? { preview: true, ver: opts.ver } : null);
  await routeSealFixture(page);
  const pl = opts.pl ?? PL;
  await page.goto(`/report.html?ver=${opts.ver}#pl=${pl}`);
}

test.describe("report.html renders zone places from boot.json", () => {
  test("two Program Areas: header, table of scores and per-place flowers all render", async ({
    page,
  }) => {
    await gotoReport(page, { ver: "v9", preview: true });

    await expect(page.locator("h1")).toHaveText("BOEM Marine Sensitivity Report");
    await expect(page.locator(".report-chip")).toHaveText("v9 · prerelease · restricted");

    // the Table of Scores: one row per place, in submission order, Overall = plain mean of the
    // components PRESENT (model.ts's own rule -- GAA: (50+30+40)/3 = 40, ALA: (55+20)/2 = 37.5 -> 38).
    const table = page.locator("table", { hasText: "Mean component and overall scores" });
    const gaaRow = table.locator("tr", { hasText: "Gulf of America" });
    await expect(gaaRow).toContainText("40");
    const alaRow = table.locator("tr", { hasText: "Alaska" });
    await expect(alaRow).toContainText("38");

    // one flower figure per place (tabs on screen; both panels exist in the DOM regardless of
    // which is the active tab -- report.css's [hidden] rule, not a conditional {#if}).
    await expect(page.locator("figure.flower-panel")).toHaveCount(2);

    // species degrades to the documented empty case for this suite's fixtures (see file header).
    await expect(page.getByText("No species found for this area.").first()).toBeVisible();

    await expect(page.locator(".progress-line")).toContainText("Done");
  });

  test("the permalink round-trips ver and pl", async ({ page }) => {
    await gotoReport(page, { ver: "v9", preview: true });
    const link = page.locator(".report-header a");
    await expect(link).toHaveAttribute("href", /ver=v9/);
    await expect(link).toHaveAttribute("href", /pl=/);
  });
});

test.describe("D6 access gate + the PREVIEW banner/watermark (plan D6, master plan D6/D9)", () => {
  test("a restricted release on a preview session shows the gold banner and the print watermark", async ({
    page,
  }) => {
    await gotoReport(page, { ver: "v9", preview: true });
    await expect(page.locator(".preview-banner")).toContainText("PREVIEW");
    await expect(page.locator(".print-watermark")).toHaveText("PREVIEW");
  });

  test("a public release shows neither the banner nor the watermark", async ({ page }) => {
    await gotoReport(page, { ver: "v7", preview: false });
    await expect(page.locator(".preview-banner")).toHaveCount(0);
    await expect(page.locator(".print-watermark")).toHaveText("");
  });

  test("a restricted release on the PUBLIC host (no preview session) renders nothing to report on", async ({
    page,
  }) => {
    // v9 is restricted and there is no session -- the same D6 gate index.html's own inline script
    // enforces falls through to latest.txt (v7 here), which was never asked for as a place.
    await blockWasm(page);
    await routeBucket(page, "v7", BOOT_V7);
    await routeSession(page, null);
    await routeSealFixture(page);
    await page.goto(`/report.html?ver=v9#pl=${PL}`);
    // v7's boot has no GAA/ALA-matching report content for a request that named v9 explicitly and
    // was denied -- the document still renders (against v7, the fallback), just not a PREVIEW one.
    await expect(page.locator(".preview-banner")).toHaveCount(0);
  });
});

test.describe("exports", () => {
  test("Download HTML produces a self-contained file", async ({ page }) => {
    await gotoReport(page, { ver: "v9", preview: true });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download HTML" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^PREVIEW_MarineSensitivity_.*\.html$/);
  });

  test("Print stylesheet: the watermark is visible only under print media", async ({ page }) => {
    await gotoReport(page, { ver: "v9", preview: true });
    await expect(page.locator(".print-watermark")).not.toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".print-watermark")).toBeVisible();
    await expect(page.locator(".export-bar")).toBeHidden();
  });
});

test.describe("accessibility", () => {
  test("axe: zero serious/critical findings", async ({ page }) => {
    await gotoReport(page, { ver: "v9", preview: true });
    await expect(page.locator(".progress-line")).toContainText("Done");
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad).toEqual([]);
  });

  test("headings are hierarchical (one h1, every section a h2)", async ({ page }) => {
    await gotoReport(page, { ver: "v9", preview: true });
    await expect(page.locator("h1")).toHaveCount(1);
    const h2Texts = await page.locator("h2").allTextContents();
    expect(h2Texts.some((t) => t.includes("Introduction"))).toBe(true);
    expect(h2Texts.some((t) => t.includes("Table of Scores"))).toBe(true);
    expect(h2Texts.some((t) => t.includes("Summary of Species"))).toBe(true);
  });
});
