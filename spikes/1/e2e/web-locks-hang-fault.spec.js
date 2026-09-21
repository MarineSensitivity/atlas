import { test, expect } from "@playwright/test";

// Seeded-fault proof for the Web Locks `ifAvailable` requirement itself (same discipline as
// second-tab-hang-fault.spec.js and CLAUDE.md's "every gate ships with a seeded fault; a check that
// cannot fail is not a check"). The subplan/master-plan D3 mechanism requires `ifAvailable: true`
// specifically because a plain `navigator.locks.request(name, cb)` (no options) queues and does not
// invoke its callback until the lock is free -- i.e. it hangs for as long as tab1 holds the lock.
// This test proves the harness can actually SEE that hang (bounded by its own hard timeout, not an
// indefinite stall of the runner) and is expected to fail: it is what "no ifAvailable" looks like,
// which is exactly the bug `ifAvailable: true` exists to avoid. Runs the same on every engine --
// navigator.locks does not depend on OPFS being available (WebKit included).
const PKG = "132";
const SOURCE_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/tables/taxon.parquet";
const TIMEOUT_MS = 6_000;

test("seeded fault: a plain locks.request (no ifAvailable) hangs while tab1 holds the lock", async ({
  page,
  context,
}) => {
  test.fail(
    true,
    "seeded/expected: without { ifAvailable: true } a second tab's locks.request queues and never " +
      "resolves while tab1 holds the lock -- this is exactly the bug ifAvailable exists to avoid. " +
      "Must go red if this ever starts resolving promptly (would mean the seeded fault stopped " +
      "reproducing).",
  );
  test.setTimeout(TIMEOUT_MS + 10_000);

  const dbName = "atlas-spike-weblocks-noifavail.duckdb";

  await page.goto(`/?pkg=${PKG}`);
  await page.waitForFunction(() => !!window.spike);
  await page.evaluate(
    async ({ dbName, sourceUrl }) => window.spike.acquireLockCreateAndHold(dbName, sourceUrl),
    { dbName, sourceUrl: SOURCE_URL },
  );
  // tab1 deliberately never releases -- holds the lock for the rest of this test.

  const page2 = await context.newPage();
  await page2.goto(`/?pkg=${PKG}`);
  await page2.waitForFunction(() => !!window.spike);

  const started = Date.now();
  const result = await page2.evaluate(
    async ({ dbName, timeoutMs }) => window.spike.probeLockNoIfAvailable(dbName, timeoutMs),
    { dbName, timeoutMs: TIMEOUT_MS },
  );
  const elapsedMs = Date.now() - started;
  console.log(
    `[web-locks-hang-fault] outcome=${result.outcome} elapsedMs=${elapsedMs} (in-page ms=${result.ms})`,
  );

  await page.evaluate(() => window.spike.releaseHeldLock()).catch(() => {});

  // this is the SAME assertion a clean "never hangs" gate would make -- it is expected to fail here
  // (see test.fail() above) because the seeded fault (no ifAvailable) really does hang until the
  // timeout.
  expect(result.outcome, "without ifAvailable the second tab must not hang (seeded fault: this must fail)").not.toBe(
    "timeout",
  );
});
