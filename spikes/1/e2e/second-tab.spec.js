import { test, expect } from "@playwright/test";

// atlas-0 Step 4, S1 gate: "second tab while the first holds the file -> must fall back cleanly (Web
// Locks ifAvailable), never hang." Two hard timeouts guard against a real hang turning into a stuck
// CI job: an IN-PAGE race (openSecondHandle's own timeoutMs, src/main.js) and an OUTER race here, so
// even a hang inside the page's own Promise.race (e.g. the JS realm wedged) still resolves this test
// as a failure rather than blocking the run.
const PKGS = ["132", "latest", "next"];
const SOURCE_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/tables/taxon.parquet";
const IN_PAGE_TIMEOUT_MS = 8_000;
const OUTER_GUARD_MS = IN_PAGE_TIMEOUT_MS + 5_000;

for (const pkg of PKGS) {
  test(`second tab falls back cleanly, never hangs [pkg=${pkg}]`, async ({ page, context }) => {
    test.setTimeout(OUTER_GUARD_MS + 10_000);
    const dbName = `atlas-spike-secondtab-${pkg}.duckdb`;

    await page.goto(`/?pkg=${pkg}`);
    await page.waitForFunction(() => !!window.spike);
    await page.evaluate(
      async ({ dbName, sourceUrl }) => window.spike.createAndCount(dbName, sourceUrl),
      { dbName, sourceUrl: SOURCE_URL },
    );
    // first tab deliberately does NOT release() -- it holds the opfs file open while the second tab
    // probes it, which is exactly the scenario under test.

    const page2 = await context.newPage();
    await page2.goto(`/?pkg=${pkg}`);
    await page2.waitForFunction(() => !!window.spike);

    const started = Date.now();
    const result = await Promise.race([
      page2.evaluate(
        async ({ dbName, timeoutMs }) => window.spike.openSecondHandle(dbName, timeoutMs),
        { dbName, timeoutMs: IN_PAGE_TIMEOUT_MS },
      ),
      new Promise((resolve) =>
        setTimeout(() => resolve({ outcome: "outer-hang-guard" }), OUTER_GUARD_MS),
      ),
    ]);
    const elapsedMs = Date.now() - started;
    console.log(
      `[second-tab pkg=${pkg}] outcome=${result.outcome} elapsedMs=${elapsedMs}` +
        (result.message ? ` message=${result.message}` : ""),
    );

    await page.evaluate(() => window.spike.release()).catch(() => {});
    await page2.close();

    // a hang (either guard firing) is a hard failure, distinct from a clean rejection or (if the
    // engine somehow allows concurrent opens) a clean second open.
    expect(result.outcome, "second tab must not hang").not.toBe("timeout");
    expect(result.outcome, "outer hang guard must not fire").not.toBe("outer-hang-guard");
    expect(elapsedMs).toBeLessThan(OUTER_GUARD_MS);
  });
}
