import { test, expect } from "@playwright/test";

// Seeded-fault proof for the second-tab hard-timeout gate (same discipline as the size-budget
// static-import fixture and CLAUDE.md's "every gate ships with a seeded fault; a check that cannot
// fail is not a check"). ?hangSecondTab=1 makes window.spike.openSecondHandle (src/main.js) skip its
// own in-page race and return a promise that never resolves -- simulating "the in-page hang guard is
// missing". This test's OUTER guard (the same Promise.race shape as second-tab.spec.js) must still
// catch it within bounded time -- proof that a real hang is reported as a failure, not left to hang
// the run.
//
// fix round 2 (reviewer finding N2): round 1 used test.fail(true, ...) and asserted the OPPOSITE of
// what actually happens (expecting NOT "outer-hang-guard", which is a blanket "any failure counts"
// expectation). Fixed: no test.fail() -- assert the actual, specific seeded outcome positively
// (outcome === "outer-hang-guard", bounded elapsed time) as an ordinary passing test. This scenario
// never touches SOURCE_URL/network at all (?hangSecondTab=1 is a pure in-page simulated hang), so
// there is no 404 path to worry about here, but the positive assertion is still the correct fix: it
// only passes when the SPECIFIC guard fires, not for an arbitrary different failure.
const IN_PAGE_TIMEOUT_MS = 8_000;
const OUTER_GUARD_MS = IN_PAGE_TIMEOUT_MS + 5_000;

test("seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging", async ({
  page,
}) => {
  test.setTimeout(OUTER_GUARD_MS + 10_000);
  await page.goto(`/?pkg=132&hangSecondTab=1`);
  await page.waitForFunction(() => !!window.spike);

  const started = Date.now();
  const result = await Promise.race([
    page.evaluate(
      async ({ timeoutMs }) => window.spike.openSecondHandle("unused.duckdb", timeoutMs),
      { timeoutMs: IN_PAGE_TIMEOUT_MS },
    ),
    new Promise((resolve) =>
      setTimeout(() => resolve({ outcome: "outer-hang-guard" }), OUTER_GUARD_MS),
    ),
  ]);
  const elapsedMs = Date.now() - started;
  console.log(`[second-tab-hang-fault] outcome=${result.outcome} elapsedMs=${elapsedMs}`);

  // seeded fault, asserted positively: the in-page attempt never resolves at all (?hangSecondTab=1),
  // so the OUTER guard must be the one that fires -- proving it actually catches a real hang, bounded
  // in time. Any other outcome is a real failure of this test.
  expect(result.outcome, "the outer hang guard must be the one that resolves this").toBe(
    "outer-hang-guard",
  );
  expect(elapsedMs, "must be caught at (not before) the guard duration").toBeGreaterThanOrEqual(
    OUTER_GUARD_MS,
  );
  expect(elapsedMs, "guard itself must not hang the test runner").toBeLessThan(
    OUTER_GUARD_MS + 1_000,
  );
});
