import { test, expect } from "@playwright/test";

// atlas-0 Step 4, S1 gate: "opens opfs://atlas-spike.duckdb READ_WRITE, CREATE TABLE t AS SELECT *
// FROM '<v9 taxon.parquet URL>', CHECKPOINT, closes; Playwright reloads the page in the same
// persistent context, reopens, asserts count(*) equals the first run with network blocked to S3."
// Must PASS for 132 and next (dev64), and must FAIL for latest (dev57) -- that's the proof the test
// can see the bug (npm `latest` creates the OPFS file and never writes it, path canonicalised
// opfs:// -> opfs:/).
//
// fix round 2 (reviewer finding N2): round 1 used test.fail(pkg === "latest", ...) /
// test.fail(browserName === "webkit", ...) to turn these two known-red cases into "expected
// failures". That is a BLANKET expectation -- it counts green no matter WHY the test failed, so if
// SOURCE_URL 404s (or any other unrelated fault) it would silently masquerade as "dev57's bug" /
// "WebKit's OPFS gap" and the thing this test exists to prove (persistence really breaks on dev57,
// specifically) would go unproven. Fixed: no test.fail() anywhere below. Each branch instead
// (a) asserts the source really loaded (n1 === 37067, not just "> 0") before touching the known-bad
// path, so a network/404 failure surfaces as ITS OWN distinct failure, not this one, and (b) asserts
// the SPECIFIC expected error text on the known-bad path, so any other error (or no error at all)
// makes the test fail for real.
const PKGS = ["132", "latest", "next"];
const SOURCE_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/tables/taxon.parquet";

for (const pkg of PKGS) {
  test(`persists opfs table across reload with S3 blocked [pkg=${pkg}]`, async ({
    page,
    browserName,
  }) => {
    const dbName = `atlas-spike-persist-${pkg}.duckdb`;

    await page.goto(`/?pkg=${pkg}`);
    await page.waitForFunction(() => !!window.spike);

    if (browserName === "webkit") {
      // WebKit here has a pre-existing, real OPFS failure independent of the duckdb-wasm pin --
      // navigator.storage.getDirectory() rejects with this exact UnknownError inside the duckdb
      // worker even in isolation (see RESULTS.md). Assert the SPECIFIC failure text, not "any
      // failure": a different error (e.g. a network/404 error reaching SOURCE_URL) must NOT be
      // mistaken for this known, pre-existing gap.
      await expect(
        page.evaluate(
          async ({ dbName, sourceUrl }) => window.spike.createAndCount(dbName, sourceUrl),
          { dbName, sourceUrl: SOURCE_URL },
        ),
        "WebKit's first createAndCount must reject with the recorded, pre-existing OPFS error",
      ).rejects.toThrow(/operation failed for an unknown transient reason/);
      return;
    }

    const n1 = await page.evaluate(
      async ({ dbName, sourceUrl }) => window.spike.createAndCount(dbName, sourceUrl),
      { dbName, sourceUrl: SOURCE_URL },
    );
    console.log(`[persistence pkg=${pkg}] first run count = ${n1}`);
    // exact row count, not just >0: proves the real v9 taxon.parquet actually loaded (a 404/network
    // fault would either throw above or return a wrong/zero count, either way failing HERE rather
    // than being absorbed by the reopen assertion below).
    expect(n1).toBe(37067);
    await page.evaluate(() => window.spike.release());

    // block ALL network to S3 before the reload: if the reopen needed to re-fetch anything, this
    // turns that into a hard failure instead of a false pass.
    await page.route("**s3.us-east-1.amazonaws.com/**", (route) => route.abort());
    await page.reload();
    await page.waitForFunction(() => !!window.spike);

    if (pkg === "latest") {
      // seeded/expected: 1.33.1-dev57.0 (npm dist-tag `latest`, resolved 2026-09-20) creates the
      // OPFS file+WAL but never writes to them, so the reopened db is missing table `t`. Assert the
      // SPECIFIC bug's error text -- if this pin ever gets fixed upstream (or dev57's alias points
      // somewhere else), the reopen would instead resolve (or throw something else), and this
      // assertion correctly goes red rather than silently staying green.
      await expect(
        page.evaluate(async ({ dbName }) => window.spike.reopenAndCount(dbName), { dbName }),
        "dev57's reopen must raise the specific 'table t does not exist' Catalog Error",
      ).rejects.toThrow(/Catalog Error: Table with name t does not exist/);
      return;
    }

    const n2 = await page.evaluate(async ({ dbName }) => window.spike.reopenAndCount(dbName), {
      dbName,
    });
    console.log(`[persistence pkg=${pkg}] reopened count = ${n2}`);
    expect(n2).toBe(n1);
  });
}
