import { test, expect } from "@playwright/test";

// atlas-0 Step 4, S1 fix round 1: master plan D3's actual mechanism -- "one tab holds it (Web
// Locks), everyone else and every failure mode runs in memory" -- not the raw db.open() race
// second-tab.spec.js measures. Fixed pkg=132 (a well-behaved candidate): the Web Locks mechanism
// itself does not depend on which duckdb-wasm build is pinned, only on navigator.locks and, for
// tab1's OPFS create, on OPFS itself (see the WebKit notes below and in RESULTS.md). Every tab
// contends for one fixed lock name (`atlas-opfs:<dbName>`) and NEVER opens the opfs:// path itself
// without holding that lock first.
const PKG = "132";
const SOURCE_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/tables/taxon.parquet";

test("Web Locks ifAvailable: tab2 answers from memory while tab1 holds the lock, without ever touching OPFS", async ({
  page,
  context,
}) => {
  const dbName = "atlas-spike-weblocks-fallback.duckdb";

  await page.goto(`/?pkg=${PKG}`);
  await page.waitForFunction(() => !!window.spike);
  const r1 = await page.evaluate(
    async ({ dbName, sourceUrl }) => window.spike.acquireLockCreateAndHold(dbName, sourceUrl),
    { dbName, sourceUrl: SOURCE_URL },
  );
  console.log("[web-locks] tab1 acquireLockCreateAndHold =", JSON.stringify(r1));
  // tab1 must hold the lock regardless of whether its own OPFS create succeeded (it does on
  // chromium/firefox here; it does not on WebKit -- see RESULTS.md -- but the lock itself is a
  // separate API from OPFS and must still be held either way).
  expect(r1.acquired, "tab1 must acquire the lock (nobody else holds it yet)").toBe(true);

  const page2 = await context.newPage();
  const consoleTexts = [];
  page2.on("console", (m) => consoleTexts.push(m.text()));
  await page2.goto(`/?pkg=${PKG}`);
  await page2.waitForFunction(() => !!window.spike);
  const r2 = await page2.evaluate(
    async ({ dbName, sourceUrl }) => window.spike.probeLockAndAnswer(dbName, sourceUrl),
    { dbName, sourceUrl: SOURCE_URL },
  );
  console.log("[web-locks] tab2 probeLockAndAnswer (tab1 still holds) =", JSON.stringify(r2));

  expect(r2.lockAcquired, "tab2 must see the lock as unavailable while tab1 holds it").toBe(false);
  expect(r2.n).toBe(37067);
  expect(
    consoleTexts.some((t) => t.includes("createSyncAccessHandle")),
    "tab2's in-memory fallback must never attempt opfs:// at all (no createSyncAccessHandle call)",
  ).toBe(false);

  await page.evaluate(() => window.spike.releaseHeldLock());
  await page2.close();
});

test("Web Locks: once tab1 releases gracefully, a fresh tab acquires the lock and reads the real persisted file", async ({
  page,
  context,
  browserName,
}) => {
  // WebKit here has a pre-existing, real OPFS failure (navigator.storage.getDirectory() rejects
  // with UnknownError inside the duckdb worker -- confirmed independent of duckdb-wasm/pin, see
  // RESULTS.md), so tab1 never actually persists a real file and this tab's later real-file read
  // fails too. Expected here, not attributed to the pin.
  test.fail(
    browserName === "webkit",
    "WebKit: OPFS itself is unavailable in this environment (see RESULTS.md); tab1 can hold the lock but never persists a real file for this step to read back.",
  );

  const dbName = "atlas-spike-weblocks-release.duckdb";

  await page.goto(`/?pkg=${PKG}`);
  await page.waitForFunction(() => !!window.spike);
  const r1 = await page.evaluate(
    async ({ dbName, sourceUrl }) => window.spike.acquireLockCreateAndHold(dbName, sourceUrl),
    { dbName, sourceUrl: SOURCE_URL },
  );
  console.log("[web-locks release] tab1 acquireLockCreateAndHold =", JSON.stringify(r1));
  expect(r1.acquired).toBe(true);
  expect(r1.opfsError, "tab1's OPFS create must not have failed").toBeUndefined();
  expect(r1.n).toBe(37067);

  const released = await page.evaluate(() => window.spike.releaseHeldLock());
  expect(released, "releaseHeldLock() must report it actually released something").toBe(true);

  const page2 = await context.newPage();
  await page2.goto(`/?pkg=${PKG}`);
  await page2.waitForFunction(() => !!window.spike);
  const r2 = await page2.evaluate(
    async ({ dbName, sourceUrl }) => window.spike.probeLockAndAnswer(dbName, sourceUrl),
    { dbName, sourceUrl: SOURCE_URL },
  );
  console.log("[web-locks release] tab2 probeLockAndAnswer (after graceful release) =", JSON.stringify(r2));
  expect(r2.lockAcquired, "a fresh tab must acquire the lock once it is released").toBe(true);
  expect(r2.n).toBe(37067);
  await page2.close();
});

test("Web Locks: an abruptly-closed tab (page.close(), no graceful release) still frees the lock", async ({
  page,
  context,
  browserName,
}) => {
  test.fail(
    browserName === "webkit",
    "WebKit: OPFS itself is unavailable in this environment (see RESULTS.md); tab1 can hold the lock but never persists a real file for this step to read back.",
  );

  const dbName = "atlas-spike-weblocks-abrupt.duckdb";

  await page.goto(`/?pkg=${PKG}`);
  await page.waitForFunction(() => !!window.spike);
  const r1 = await page.evaluate(
    async ({ dbName, sourceUrl }) => window.spike.acquireLockCreateAndHold(dbName, sourceUrl),
    { dbName, sourceUrl: SOURCE_URL },
  );
  console.log("[web-locks abrupt] tab1 acquireLockCreateAndHold =", JSON.stringify(r1));
  expect(r1.acquired).toBe(true);
  expect(r1.opfsError).toBeUndefined();

  await page.close(); // abrupt: no releaseHeldLock() call, no graceful teardown

  const page2 = await context.newPage();
  await page2.goto(`/?pkg=${PKG}`);
  await page2.waitForFunction(() => !!window.spike);
  const r2 = await page2.evaluate(
    async ({ dbName, sourceUrl }) => window.spike.probeLockAndAnswer(dbName, sourceUrl),
    { dbName, sourceUrl: SOURCE_URL },
  );
  console.log("[web-locks abrupt] tab2 probeLockAndAnswer (after abrupt close) =", JSON.stringify(r2));
  expect(r2.lockAcquired, "closing the holding tab (even abruptly) must free its lock").toBe(true);
  expect(r2.n).toBe(37067);
  await page2.close();
});
