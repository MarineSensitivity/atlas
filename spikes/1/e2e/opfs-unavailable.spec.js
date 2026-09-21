import { test, expect } from "@playwright/test";

// atlas-0 Step 4, S1 gate: "a private window (OPFS throws) -> in-memory fallback." OPFS access
// happens only inside the duckdb worker realm (grep-confirmed: `navigator.storage.getDirectory`
// appears only in the *.worker.js bundles, never in duckdb-browser.mjs, the main-thread module), and
// Playwright's page.addInitScript only reaches the page/Window realm, not a dedicated Worker's own
// realm. So "OPFS unavailable" is simulated here by rewriting the worker script's own network
// response to shim navigator.storage.getDirectory() to reject with a SecurityError, from inside the
// worker's own realm, before duckdb's code (which calls it) runs -- not a real private window (see
// RESULTS.md for why a real private window was not used for every engine).
const PKGS = ["132", "latest", "next"];
const SOURCE_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/tables/taxon.parquet";

for (const pkg of PKGS) {
  test(`falls back to in-memory when OPFS is unavailable [pkg=${pkg}]`, async ({ page }) => {
    await page.route("**/*.worker.js", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const shim =
        "navigator.storage.getDirectory = function(){ return Promise.reject(new DOMException('simulated: OPFS unavailable (private mode)', 'SecurityError')); };\n";
      await route.fulfill({ response, body: shim + body });
    });

    await page.goto(`/?pkg=${pkg}`);
    await page.waitForFunction(() => !!window.spike);
    const result = await page.evaluate(
      async ({ sourceUrl }) => window.spike.createInMemoryFallback(sourceUrl),
      { sourceUrl: SOURCE_URL },
    );
    console.log(`[opfs-unavailable pkg=${pkg}]`, JSON.stringify(result));

    expect(result.opfsError, "opfs open must have failed (simulated or real)").toBeTruthy();
    expect(result.n).toBeGreaterThan(0);
  });
}
