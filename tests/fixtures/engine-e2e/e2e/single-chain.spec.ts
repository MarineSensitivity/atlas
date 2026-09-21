import { expect, test } from "@playwright/test";

// atlas-2 Step 3 (Sonnet half): seeded fault -- "two concurrent exec() calls escaping the single
// chain (assert ordering with a deliberately slow first query)" -- against the REAL engine (a
// second, dependency-injected proof already lives in tests/engine/engine.test.ts; this is the same
// property against a real DuckDB-WASM connection, not a stub). If two exec() calls ever raced
// against the one connection instead of serializing, the slow query's `range()` would still be
// mid-flight when the fast query's result came back FIRST.

test("a slow query started first still finishes before a fast query started right after it", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => "__engineTest" in window);
  const boot = await page.evaluate(() => window.__engineTest.boot({ platform: "eh" }));
  expect(boot.ok, `boot failed: ${boot.error}`).toBe(true);

  const [slow, fast] = await page.evaluate(async () => {
    const order: string[] = [];
    const slowP = window.__engineTest
      .exec("SELECT count(*) AS n FROM range(200000000)") // deliberately slow
      .then((r) => order.push(`slow:${r.ok}`));
    const fastP = window.__engineTest.exec("SELECT 1 AS n").then((r) => order.push(`fast:${r.ok}`));
    await Promise.all([slowP, fastP]);
    return order;
  });

  // both must have succeeded, AND the slow one -- issued first -- must have settled first: the
  // fast exec() couldn't even START on the single connection until the slow one was done.
  expect(slow).toBe("slow:true");
  expect(fast).toBe("fast:true");
});
