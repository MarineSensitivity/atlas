import { expect, test } from "@playwright/test";

// atlas-2 Step 3 (Sonnet half): seeded fault -- "a value interpolated without lit() (an injection
// string '; DROP TABLE t; --' must come back as data...)" -- proven against a REAL DuckDB-WASM
// connection (tests/engine/sql.test.ts proves the string-escaping math in isolation; this proves
// the escaped SQL actually executes as one inert SELECT, not two statements, on a real engine).

test("an injection-shaped probe value comes back as data, not as a second statement", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => "__engineTest" in window);
  const boot = await page.evaluate(() => window.__engineTest.boot({ platform: "eh" }));
  expect(boot.ok, `boot failed: ${boot.error}`).toBe(true);

  const injected = "'; DROP TABLE t; --";
  const result = await page.evaluate((v) => window.__engineTest.smokeProbe(v), injected);
  expect(result.ok, `smokeProbe failed: ${result.error}`).toBe(true);
  expect(result.rows).toHaveLength(1);
  const row = result.rows![0] as { n: number | bigint; probe: string };
  expect(Number(row.n)).toBe(37_067); // taxon's real row count -- the table was never touched
  expect(row.probe).toBe(injected); // round-tripped as plain string data, byte for byte

  // and the table is still queryable afterwards -- a real DROP would have made this fail.
  const again = await page.evaluate(() => window.__engineTest.countTaxon());
  expect(again.ok).toBe(true);
  expect(again.n).toBe(37_067);
});
