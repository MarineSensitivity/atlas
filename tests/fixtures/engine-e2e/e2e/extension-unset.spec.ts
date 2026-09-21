import { expect, test } from "@playwright/test";

// atlas-2 Step 3 (Sonnet half): seeded fault -- "the extension mirror unset with the CDN blocked
// (the spec must fail, and say what the user-visible failure is)". Without `custom_extension_repository`
// pointed at the same-origin mirror, `read_parquet()`'s autoload goes to the now-blocked
// extensions.duckdb.org and crashes (docs/spikes/S3.md/S4.md: `RuntimeError: function signature
// mismatch`, a WASM-level crash surfaced through the extension-autoload path -- NOT a normal SQL
// error, but IS a rejected promise a surrounding try/catch catches, per the spike's own gate
// re-run). `engine.ts` normalizes whatever comes back into `EngineUnavailableError("data engine
// unavailable: ...")`, which is the user-visible failure this spec pins down.

test("without a mirror, extensions.duckdb.org blocked: the engine surfaces a clear failure, not a hang", async ({
  page,
}) => {
  await page.route("**/extensions.duckdb.org/**", (route) => route.abort());

  await page.goto("/");
  await page.waitForFunction(() => "__engineTest" in window);

  const boot = await page.evaluate(() =>
    window.__engineTest.boot({ platform: "eh", extensionRepository: null }),
  );
  expect(boot.ok, "boot succeeding with no mirror set is itself unexpected here").toBe(true);
  // boot() itself only runs SET custom_extension_repository when a repository IS given, so with
  // `null` it succeeds trivially -- the crash happens on the FIRST read_parquet(), inside countTaxon().

  const result = await page.evaluate(() => window.__engineTest.countTaxon());

  // THIS is the assertion that must go red if the failure ever silently stops surfacing (e.g. a
  // future duckdb-wasm version that hangs forever instead of rejecting): the call must come back
  // ok:false with a clear, user-facing message.
  expect(result.ok, "expected countTaxon() to fail without an extension mirror").toBe(false);
  expect(result.error).toMatch(/data engine unavailable/i);

  // the exact observed failure text, for docs/engine.md
  console.log(`[engine-e2e][extension-unset] observed failure: ${result.error}`);
});
