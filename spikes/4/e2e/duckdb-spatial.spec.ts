// atlas-0 S4 spike, part (b) — does duckdb-wasm's `spatial` extension load, and does `ST_Read`
// work on a registered .gpkg, on BOTH @duckdb/duckdb-wasm 1.32.0 and the current `next` dist-tag?
// Measurement-only: both "yes" and "no" are valid outcomes here (S1 decides the actual pin), so
// these tests assert structure (the harness ran and returned a well-formed result), not a
// particular yes/no — the actual answer is recorded verbatim in RESULTS.md from the console.log
// lines and from bytes fetched, per fixture per version.
import { test, expect } from "@playwright/test";

const FIXTURES = ["gulf_rectangle", "aleutian_dateline", "multipolygon", "utm_zone", "coastline_40k"] as const;
const VERSIONS = ["1.32.0", "next"] as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__spike4 !== undefined);
});

for (const version of VERSIONS) {
  for (const fixture of FIXTURES) {
    test(`duckdb-wasm ${version}: spatial + ST_Read(${fixture}.gpkg)`, async ({ page }) => {
      let totalNetworkBytes = 0;
      const perUrl: Record<string, number> = {};
      page.on("response", async (resp) => {
        try {
          const buf = await resp.body();
          perUrl[resp.url()] = buf.length;
          totalNetworkBytes += buf.length;
        } catch {
          // opaque/aborted responses (e.g. a worker's own nested fetches) — not fatal to the measurement
        }
      });

      const r = await page.evaluate(
        ([v, url]) => (window as any).__spike4.testGpkg(v, url),
        [version, `/${fixture}.gpkg`] as const,
      );

      console.log(`duckdb ${version} / ${fixture}.gpkg: totalNetworkBytes=${totalNetworkBytes}`, JSON.stringify(r));
      console.log(`  per-url bytes:`, JSON.stringify(perUrl));

      // structural assertions only — the actual spatialInstallLoadOk / rowCount / errorText yes-or-no
      // is the finding, recorded in RESULTS.md, not asserted here.
      expect(typeof r.spatialInstallLoadOk).toBe("boolean");
      expect(r.errorText === null || typeof r.errorText === "string").toBe(true);
      if (r.spatialInstallLoadOk && r.errorText === null) {
        expect(r.rowCount, `${version}/${fixture} ST_Read row count`).toBe(1);
      }
    });
  }
}
