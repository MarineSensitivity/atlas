import { test, expect } from "@playwright/test";

// Seeded-fault proof for the second-tab hard-timeout gate (same discipline as the size-budget
// static-import fixture and CLAUDE.md's "every gate ships with a seeded fault; a check that cannot
// fail is not a check"). ?hangSecondTab=1 makes window.spike.openSecondHandle (src/main.js) skip its
// own in-page race and return a promise that never resolves -- simulating "the in-page hang guard is
// missing". This test's OUTER guard (the same Promise.race shape as second-tab.spec.js) must still
// catch it within bounded time and the `expect` below must FAIL: proof that a real hang is reported
// as a failure, not left to hang the run.
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

  // this assertion is EXPECTED to fail: it is the same assertion second-tab.spec.js makes, run
  // against a deliberately-hung in-page attempt, to prove the outer guard resolves (bounded time,
  // not a real hang) and that the resulting outcome trips the same expect() a real hang would.
  expect(elapsedMs).toBeLessThan(OUTER_GUARD_MS + 1_000); // guard itself does not hang the test runner
  expect(result.outcome, "second tab must not hang (seeded fault: this must fail)").not.toBe(
    "outer-hang-guard",
  );
});
