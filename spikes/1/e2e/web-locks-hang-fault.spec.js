import { test, expect } from "@playwright/test";

// Seeded-fault proof for the Web Locks `ifAvailable` requirement itself (same discipline as
// second-tab-hang-fault.spec.js and CLAUDE.md's "every gate ships with a seeded fault; a check that
// cannot fail is not a check"). The subplan/master-plan D3 mechanism requires `ifAvailable: true`
// specifically because a plain `navigator.locks.request(name, cb)` (no options) queues and does not
// invoke its callback until the lock is free -- i.e. it hangs for as long as tab1 holds the lock.
// This test proves the harness can actually SEE that hang (bounded by its own hard timeout, not an
// indefinite stall of the runner). Runs the same on every engine -- navigator.locks does not depend
// on OPFS being available (WebKit included).
//
// fix round 2 (reviewer finding N2): round 1 used test.fail(true, ...) to turn the expected-hang
// outcome into a "pass". That is a BLANKET expectation: ANY failure (a 404 on SOURCE_URL, tab1 never
// really acquiring the lock, a different exception) would also have counted green. Fixed: no
// test.fail() -- the seeded fault is now asserted POSITIVELY (outcome === "timeout", elapsed >= the
// guard duration) as an ordinary passing test, which only passes when the hang actually, specifically
// reproduces.
const PKG = "132";
const SOURCE_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/tables/taxon.parquet";
const TIMEOUT_MS = 6_000;

test("seeded fault: a plain locks.request (no ifAvailable) hangs while tab1 holds the lock", async ({
  page,
  context,
  browserName,
}) => {
  test.setTimeout(TIMEOUT_MS + 10_000);

  const dbName = "atlas-spike-weblocks-noifavail.duckdb";

  await page.goto(`/?pkg=${PKG}`);
  await page.waitForFunction(() => !!window.spike);
  const r1 = await page.evaluate(
    async ({ dbName, sourceUrl }) => window.spike.acquireLockCreateAndHold(dbName, sourceUrl),
    { dbName, sourceUrl: SOURCE_URL },
  );
  // the precondition this test actually needs is "tab1 holds the lock" -- acquireLockCreateAndHold
  // holds the lock unconditionally regardless of whether the nested OPFS create succeeds (round 1's
  // WebKit fix), so r1.acquired is true on every engine even where OPFS itself is broken. Assert that
  // precondition explicitly (not just "some result came back") so a fault that stops tab1 from
  // acquiring the lock at all shows up as ITS OWN failure here, distinct from the hang under test.
  expect(r1.acquired, "tab1 must hold the lock for this scenario to mean anything").toBe(true);
  if (browserName === "webkit") {
    expect(
      r1.opfsError,
      "WebKit's tab1 OPFS create must fail with the recorded, pre-existing error",
    ).toMatch(/operation failed for an unknown transient reason/);
  } else {
    expect(r1.opfsError, "tab1's OPFS create must not have failed").toBeUndefined();
    expect(r1.n).toBe(37067);
  }
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

  // seeded fault, asserted positively: without ifAvailable, tab2's locks.request queues and does NOT
  // resolve until the in-page timeout fires -- this IS the bug ifAvailable exists to avoid. Any other
  // outcome (resolves early, or a different error) is a real failure of this test, not a pass.
  expect(result.outcome, "without ifAvailable the second tab must hang until the timeout").toBe(
    "timeout",
  );
  expect(
    result.ms,
    "the in-page timer must report at least the full guard duration (nothing resolved earlier)",
  ).toBeGreaterThanOrEqual(TIMEOUT_MS);
  expect(
    elapsedMs,
    "the outer/Node-side elapsed time must also be at least the full guard duration",
  ).toBeGreaterThanOrEqual(TIMEOUT_MS);
});
