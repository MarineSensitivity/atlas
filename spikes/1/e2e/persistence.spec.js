import { test, expect } from "@playwright/test";

// atlas-0 Step 4, S1 gate: "opens opfs://atlas-spike.duckdb READ_WRITE, CREATE TABLE t AS SELECT *
// FROM '<v9 taxon.parquet URL>', CHECKPOINT, closes; Playwright reloads the page in the same
// persistent context, reopens, asserts count(*) equals the first run with network blocked to S3."
// Must PASS for 132 and next (dev64), and must FAIL for latest (dev57) -- that's the proof the test
// can see the bug (npm `latest` creates the OPFS file and never writes it, path canonicalised
// opfs:// -> opfs:/).
//
// fix round 1: the suite exits 1 by design (dev57 must fail), so the exit code alone cannot gate CI
// -- these two test.fail() calls turn the KNOWN reds into "expected failures" (Playwright still
// reports them, but counts them toward a passing/green run) so that exit code 0 means "candidates
// persist AND dev57 still shows the bug", and the suite goes red only if either of those two facts
// stops being true (dev57 starts passing, or WebKit's real OPFS starts working and something else
// breaks instead).
const PKGS = ["132", "latest", "next"];
const SOURCE_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/tables/taxon.parquet";

for (const pkg of PKGS) {
  test(`persists opfs table across reload with S3 blocked [pkg=${pkg}]`, async ({
    page,
    browserName,
  }) => {
    // WebKit here has a pre-existing, real OPFS failure independent of the duckdb-wasm pin --
    // navigator.storage.getDirectory() rejects with UnknownError inside the duckdb worker even in
    // isolation (see RESULTS.md). Expected fail, not attributed to any pin.
    test.fail(
      browserName === "webkit",
      "WebKit: OPFS itself is unavailable in this environment (see RESULTS.md); every pin fails identically here.",
    );
    // seeded fault: 1.33.1-dev57.0 (npm dist-tag `latest`, resolved 2026-09-20) creates the OPFS
    // file+WAL but never writes to them -- this is the exact bug S1 exists to catch. Must go red the
    // day this starts passing (that would mean dev57 got fixed upstream, or npm `latest` moved on).
    test.fail(
      pkg === "latest",
      "seeded/expected: 1.33.1-dev57.0 creates the OPFS file but never writes it -- proof this test can see the bug.",
    );

    const dbName = `atlas-spike-persist-${pkg}.duckdb`;

    await page.goto(`/?pkg=${pkg}`);
    await page.waitForFunction(() => !!window.spike);

    const n1 = await page.evaluate(
      async ({ dbName, sourceUrl }) => window.spike.createAndCount(dbName, sourceUrl),
      { dbName, sourceUrl: SOURCE_URL },
    );
    console.log(`[persistence pkg=${pkg}] first run count = ${n1}`);
    expect(n1).toBeGreaterThan(0);
    await page.evaluate(() => window.spike.release());

    // block ALL network to S3 before the reload: if the reopen needed to re-fetch anything, this
    // turns that into a hard failure instead of a false pass.
    await page.route("**s3.us-east-1.amazonaws.com/**", (route) => route.abort());
    await page.reload();
    await page.waitForFunction(() => !!window.spike);

    const n2 = await page.evaluate(async ({ dbName }) => window.spike.reopenAndCount(dbName), {
      dbName,
    });
    console.log(`[persistence pkg=${pkg}] reopened count = ${n2}`);
    expect(n2).toBe(n1);
  });
}
