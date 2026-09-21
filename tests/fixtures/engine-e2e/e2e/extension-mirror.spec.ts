import { expect, test } from "@playwright/test";

// atlas-2 Step 3 (Sonnet half): THE required gate -- "a Playwright spec (chromium, firefox,
// webkit) that boots the engine on a page, reads a small public parquet (marine-atlas/v9/tables/
// taxon.parquet, 37,067 rows) with **/extensions.duckdb.org/** BLOCKED and asserts the count."
//
// Run for BOTH platforms (docs/spikes/S1.md/S3.md: only `eh` was ever measured before this step --
// atlas-0's own gap, named explicitly in the atlas-2 plan hand-over). "eh" leaves both bundles on
// the table and lets real `selectBundle()` feature-detection choose (every engine measured in S1/S3
// picked `eh`); "mvp" narrows the offered bundle to force it, proving the mvp mirror independently
// works even though no browser here would pick it on its own.

const TAXON_ROWS = 37_067;

for (const platform of ["eh", "mvp"] as const) {
  test(`${platform}: reads taxon.parquet (${TAXON_ROWS} rows) with extensions.duckdb.org blocked`, async ({
    page,
  }) => {
    const blocked: string[] = [];
    await page.route("**/extensions.duckdb.org/**", (route) => {
      blocked.push(route.request().url());
      return route.abort();
    });

    await page.goto("/");
    await page.waitForFunction(() => "__engineTest" in window);

    const boot = await page.evaluate((p) => window.__engineTest.boot({ platform: p }), platform);
    expect(boot.ok, `boot failed: ${boot.error}`).toBe(true);

    const result = await page.evaluate(() => window.__engineTest.countTaxon());
    expect(result.ok, `countTaxon failed: ${result.error}`).toBe(true);
    expect(result.n).toBe(TAXON_ROWS);

    // the mirror worked BECAUSE extensions.duckdb.org was never actually reached for anything the
    // query needed -- any hit here would mean the same-origin repository silently didn't take.
    expect(blocked, `extensions.duckdb.org was hit: ${blocked.join(", ")}`).toEqual([]);
  });
}

test("marks: engine:boot, engine:load and engine:exec are recorded on window.__marks", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => "__engineTest" in window);
  await page.evaluate(() => window.__engineTest.boot({ platform: "eh" }));
  await page.evaluate(() => window.__engineTest.countTaxon());

  const names = await page.evaluate(() => window.__engineTest.marks().map((m) => m.name));
  expect(names).toContain("engine:boot");
  expect(names).toContain("engine:load");
  expect(names).toContain("engine:exec");
});
