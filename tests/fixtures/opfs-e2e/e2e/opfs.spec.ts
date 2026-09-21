// atlas-2 Step 4 GATE: `docs/spikes/S1.md`'s persistence spec, promoted from the spike harness to
// the real `src/lib/engine/store/*`. Every case runs with `extensions.duckdb.org` blocked
// THROUGHOUT (the self-hosted mirror serves `parquet`), against one real public object --
// `marine-atlas/v9/tables/taxon.parquet`, 37,067 rows -- fetched once per case.
//
// WebKit and the fallback matrix. `docs/spikes/S1.md` measured Playwright's WebKit 26.6 as having
// NO working OPFS at all (`navigator.storage.getDirectory()` rejecting inside a worker). On the
// SAME WebKit build, driven from a real PERSISTENT profile (`persistent.ts`) instead of the
// ephemeral context the spike used, OPFS works and persists here -- see this step's section in
// `docs/engine.md`. So no engine is hardcoded as "the broken one": chromium and firefox MUST reach
// the OPFS tier (a regression there is a failure), and WebKit is allowed either outcome but must
// then satisfy the contract for whichever one it reached -- the documented fallback, asserted
// SPECIFICALLY (memory tier, `reason: "opfs-unavailable"`, exactly one `opfs_fallback`, identical
// answers), or the full OPFS contract. "The app never REQUIRES OPFS" (plan D3) is the property that
// has to hold either way.
import { blockExtensionCdn, expect, S3_GLOB, test } from "./persistent";

const ROWS = 37067;
const V9_FILE = "v9.s1.dv1.4.3.duckdb";

test.beforeEach(async ({ context, page }) => {
  await blockExtensionCdn(context);
  await page.goto("/");
  await page.waitForFunction(() => !!window.__opfsTest);
  // Start from a known-empty OPFS. A per-test `userDataDir` is NOT enough on every engine:
  // measured here, WebKit reuses one origin storage directory across separate persistent
  // profiles and even across separate `playwright test` runs, so a file another spec wrote was
  // still there. (Harmless for the product -- it is the same origin -- but it would make these
  // specs depend on each other.)
  await page.evaluate(() => window.__opfsTest.purgeAll());
});

type Page = import("@playwright/test").Page;
type Boot = { kind: string; reason: string; file: string | null };

/** every spec's first assertion: the real object really loaded. A 404 or a blocked CDN must fail
 * HERE, as itself, never be absorbed by a later "the cache did not work" assertion. */
async function firstLoad(page: Page, init: Record<string, unknown> = {}) {
  const boot = (await page.evaluate((o) => window.__opfsTest.init(o), init)) as Boot;
  const count = await page.evaluate(() => window.__opfsTest.loadAndCount());
  expect(count.n, "the real v9 taxon.parquet must have loaded").toBe(ROWS);
  return { boot, count };
}

/**
 * Which tier this engine actually reached, and the assertion that goes with it. chromium and
 * firefox MUST reach OPFS. WebKit may legitimately not (see the header); when it does not, THE
 * DOCUMENTED FALLBACK is asserted specifically right here -- never "any failure" -- so an unrelated
 * fault (a 404, a blocked mirror, a broken lock) can never be absorbed as "WebKit's known gap".
 */
async function tierOf(page: Page, boot: Boot, browserName: string): Promise<"opfs" | "memory"> {
  if (browserName !== "webkit") {
    expect(boot.kind, `${browserName} must reach the OPFS tier`).toBe("opfs");
    return "opfs";
  }
  if (boot.kind === "opfs") return "opfs";
  expect(boot.reason).toBe("opfs-unavailable");
  expect(boot.file).toBeNull();
  expect(await page.evaluate(() => window.__opfsTest.events())).toEqual([
    { name: "opfs_fallback", params: { reason: "opfs-unavailable" } },
  ]);
  return "memory";
}

test("reload with S3 blocked still answers a real query from the persisted tables", async ({
  page,
  context,
  browserName,
}) => {
  const { boot, count } = await firstLoad(page);
  console.log(`[persist] boot=${JSON.stringify(boot)} firstLoad=${count.ms.toFixed(1)}ms`);

  // `firstLoad` already asserted 37,067 rows came back on whichever tier won -- that IS "the
  // fallback changes nothing a user can see".
  if ((await tierOf(page, boot, browserName)) === "memory") return;

  expect(boot.file).toBe(V9_FILE);
  const files = await page.evaluate(() => window.__opfsTest.listFiles());
  expect(files.map((f) => f.file)).toContain(V9_FILE);

  // reload WITHOUT a graceful close: what survives is whatever the per-register CHECKPOINT wrote.
  await page.reload();
  await page.waitForFunction(() => !!window.__opfsTest);
  await context.route(S3_GLOB, (route) => route.abort());

  const boot2 = (await page.evaluate(() => window.__opfsTest.init())) as { kind: string };
  expect(boot2.kind, "the reloaded tab takes the lock back and reopens the file").toBe("opfs");
  const again = await page.evaluate(() => window.__opfsTest.loadAndCount());
  console.log(`[persist] after reload (S3 blocked) = ${JSON.stringify(again)}`);
  expect(again.n, "answered from the persisted table, with the bucket unreachable").toBe(ROWS);
  expect(await page.evaluate(() => window.__opfsTest.events())).toEqual([]);
});

test("CHECKPOINT moves the tables into the db file instead of leaving them in the WAL", async ({
  page,
  browserName,
}) => {
  // WHAT THIS GATE HAD TO BECOME, and why. The step's brief predicted that removing CHECKPOINT
  // would make "the reload find no table". MEASURED (chromium/firefox/webkit, duckdb-wasm 1.32.0):
  // it does not. duckdb-wasm prepares `<path>.wal` in OPFS alongside the database
  // (`prepareDBFileHandle` asks for both) and REPLAYS it on the next open, so an uncheckpointed
  // table still comes back after a reload -- the reload gate stays green with every CHECKPOINT
  // removed, which means it cannot be that rule's seeded fault.
  //
  // CHECKPOINT is still a real rule (`docs/spikes/S1.md` 6, and the plan's "CHECKPOINT after each
  // batch and on visibilitychange -> hidden"): it is what puts the bytes in the DATABASE. Without
  // it the durable copy lives only in a WAL -- which this app's own stale sweep and self-heal
  // delete with their database, and which no tab that did not write it replays. So THIS is the
  // assertion that pins it, and `checkpoint: false` is its seeded fault, committed rather than
  // patched in by hand.
  const { boot } = await firstLoad(page);
  if ((await tierOf(page, boot, browserName)) === "memory") return;
  await page.evaluate(() => window.__opfsTest.close());
  const withCheckpoint = await page.evaluate(() => window.__opfsTest.entries());
  console.log(`[checkpoint] ON  -> ${JSON.stringify(withCheckpoint)}`);

  await page.evaluate(() => window.__opfsTest.purgeAll());
  await page.evaluate(() => window.__opfsTest.init({ checkpoint: false }));
  expect((await page.evaluate(() => window.__opfsTest.loadAndCount())).n).toBe(ROWS);
  await page.evaluate(() => window.__opfsTest.close());
  const without = await page.evaluate(() => window.__opfsTest.entries());
  console.log(`[checkpoint] OFF -> ${JSON.stringify(without)}`);

  const db = (es: { name: string; bytes: number }[]) =>
    es.find((e) => e.name === V9_FILE)?.bytes ?? 0;

  // The DATABASE file is the discriminator, and a stark one: ~3.2-3.4 MB checkpointed against
  // 12,288 B (an empty header) not checkpointed, on all three engines. The `.wal` is NOT a
  // discriminator -- duckdb-wasm PREALLOCATES it at a fixed size (7,332,7xx B either way), so its
  // length says nothing about whether it is carrying the data.
  expect(db(withCheckpoint), "with CHECKPOINT the table is IN the database file").toBeGreaterThan(
    500_000,
  );
  expect(db(without), "without CHECKPOINT the database file stays an empty header").toBeLessThan(
    100_000,
  );
});

test("a second tab answers from MEMORY within the same time budget and never touches the OPFS file", async ({
  page,
  context,
  browserName,
}) => {
  const { boot, count } = await firstLoad(page);
  if ((await tierOf(page, boot, browserName)) === "memory") return;

  const page2 = await context.newPage();
  const consoleTexts: string[] = [];
  page2.on("console", (m) => consoleTexts.push(m.text()));
  await page2.goto("/");
  await page2.waitForFunction(() => !!window.__opfsTest);

  const boot2 = (await page2.evaluate(() => window.__opfsTest.init())) as {
    kind: string;
    reason: string;
    file: string | null;
    openedPaths: (string | null)[];
  };
  const second = await page2.evaluate(() => window.__opfsTest.loadAndCount());
  console.log(
    `[second tab] boot=${JSON.stringify(boot2)} ms=${second.ms.toFixed(1)} (tab1 ${count.ms.toFixed(1)})`,
  );

  expect(boot2.kind).toBe("memory");
  expect(boot2.reason, "the ordinary second-tab path, not a failure").toBe("lock-held");
  expect(boot2.file).toBeNull();
  expect(second.n).toBe(ROWS);
  // "never touches the OPFS file", asserted structurally: the ONLY database this tab opened was the
  // in-memory one. The console check from spikes/1 is kept as a second, weaker witness.
  expect(boot2.openedPaths).toEqual([null]);
  expect(consoleTexts.some((t) => t.includes("createSyncAccessHandle"))).toBe(false);
  expect(
    await page2.evaluate(() => window.__opfsTest.events()),
    "a second tab is transparent: no opfs_fallback",
  ).toEqual([]);

  // --- the time budget (atlas-2 phase review, ruling 3) ---------------------------------------
  // The single sample this replaced was a measurement of the machine, not of the tier. Two
  // assertions now, the same shape as `tests/perf.ts` uses in the unit suite:
  //
  //  (a) BEST-OF-N against a loose absolute budget. `init()` builds a whole fresh DuckDB (worker +
  //      wasm) and re-fetches the parquet on every sample, so each sample is a real cold answer;
  //      the minimum is the honest estimate, and N makes "every sample was descheduled" unlikely.
  //      The budget's job is to catch a HANG (the seeded plain-lock fault never resolves at all),
  //      not to police a slow runner. S1 measured 1010.9 ms (chromium) / 2371 ms (firefox).
  //  (b) a RATIO against tab 1's own cold load on this same machine, in this same run. That is
  //      what "within the same time budget" actually claims: the memory tier must not be
  //      categorically slower than the OPFS tier. Load slows both, so the ratio survives it.
  const N = 5;
  const samples: number[] = [second.ms];
  for (let i = 1; i < N; i++) {
    await page2.evaluate(() => window.__opfsTest.init());
    const s = await page2.evaluate(() => window.__opfsTest.loadAndCount());
    expect(s.n, "every sample is a real answer, not an empty one").toBe(ROWS);
    samples.push(s.ms);
  }
  const best2 = Math.min(...samples);
  console.log(
    `[second tab] best ${best2.toFixed(1)} ms of [${samples.map((s) => s.toFixed(1)).join(", ")}]` +
      ` (tab1 cold ${count.ms.toFixed(1)} ms, ratio ${(best2 / count.ms).toFixed(2)}x)`,
  );
  expect(best2, "a second tab must ANSWER, not hang").toBeLessThan(15_000);
  expect(
    best2 / count.ms,
    "the memory tier answers within the same order as the OPFS tier's cold load",
  ).toBeLessThan(8);
  await page2.close();
});

test("a changed digest re-materializes exactly that table", async ({ page, browserName }) => {
  const { boot } = await firstLoad(page, { digest: "T1" });
  if ((await tierOf(page, boot, browserName)) === "memory") return;
  // a second, unrelated table so "exactly that one" means something
  await page.evaluate(() => window.__opfsTest.loadTile(1012));
  const before = await page.evaluate(() => window.__opfsTest.tables());
  expect(before.find((t) => t.name === "v9/tables/taxon.parquet")?.digest).toBe("T1");

  await page.reload();
  await page.waitForFunction(() => !!window.__opfsTest);
  // same release, same file -- only the PUBLISHED digest moved (what a re-publish looks like)
  await page.evaluate(() => window.__opfsTest.init({ digest: "T2" }));
  const afterReconcile = await page.evaluate(() => window.__opfsTest.tables());
  console.log(`[digest] after reconcile: ${JSON.stringify(afterReconcile.map((t) => t.name))}`);
  expect(
    afterReconcile.map((t) => t.name),
    "the stale table is dropped at session start; the tile is untouched",
  ).toEqual(["v9/serve/cell_model/tile=1012/data_0.parquet"]);

  const again = await page.evaluate(() => window.__opfsTest.loadAndCount());
  expect(again.n).toBe(ROWS);
  expect(
    (await page.evaluate(() => window.__opfsTest.tables())).find(
      (t) => t.name === "v9/tables/taxon.parquet",
    )?.digest,
    "re-materialized under the new digest",
  ).toBe("T2");
});

test("a deliberately corrupted file self-heals: deleted, memory fallback, one opfs_fallback", async ({
  page,
  browserName,
}) => {
  const { boot } = await firstLoad(page);
  if ((await tierOf(page, boot, browserName)) === "memory") return;
  await page.evaluate(() => window.__opfsTest.close());
  await page.evaluate((f) => window.__opfsTest.corrupt(f), V9_FILE);

  await page.reload();
  await page.waitForFunction(() => !!window.__opfsTest);
  const boot2 = (await page.evaluate(() => window.__opfsTest.init())) as {
    kind: string;
    reason: string;
  };
  const events = await page.evaluate(() => window.__opfsTest.events());
  const files = await page.evaluate(() => window.__opfsTest.listFiles());
  console.log(`[corrupt] boot=${JSON.stringify(boot2)} events=${JSON.stringify(events)}`);

  expect(boot2.kind).toBe("memory");
  expect(events, "exactly one opfs_fallback, with a reason").toHaveLength(1);
  expect(events[0].name).toBe("opfs_fallback");
  expect(typeof events[0].params.reason).toBe("string");
  expect(
    files.map((f) => f.file),
    "the bad file is gone",
  ).not.toContain(V9_FILE);

  // and nothing user-visible changed: the same query still answers.
  const again = await page.evaluate(() => window.__opfsTest.loadAndCount());
  expect(again.n).toBe(ROWS);
});

test("storage denied -> identical answers, no error surfaced", async ({ page }) => {
  const denied = await firstLoad(page, { opfsDenied: true });
  expect(denied.boot.kind).toBe("memory");
  expect(denied.boot.reason).toBe("opfs-unavailable");
  expect(denied.count.n, "the same answer as the OPFS tier gives").toBe(ROWS);
  expect(
    await page.evaluate(() => window.__opfsTest.events()),
    "one analytics event -- and nothing a user could see",
  ).toEqual([{ name: "opfs_fallback", params: { reason: "opfs-unavailable" } }]);
  expect(await page.evaluate(() => window.__opfsTest.listFiles())).toEqual([]);
});

test("the budget evicts least-recently-used tiles first", async ({ page, browserName }) => {
  // taxon.parquet is 1,033,168 B and every tile here is a copy of it. An 18 MB quota is a
  // 3,774,873 B budget: the pinned table plus TWO tiles fit (3,099,504) and a third does not
  // (4,132,672) -- deliberately sized so the eviction has a CHOICE of victim, which is what makes
  // "least-recently-used" a real assertion rather than "the only tile there was".
  const { boot } = await firstLoad(page, { quota: 18 * 1024 * 1024 });
  console.log(`[budget] boot=${JSON.stringify(boot)}`);
  if ((await tierOf(page, boot, browserName)) === "memory") return;
  await page.evaluate(() => window.__opfsTest.loadTile(1));
  await page.evaluate(() => window.__opfsTest.loadTile(2));
  const mid = await page.evaluate(() => window.__opfsTest.tables());
  console.log(`[budget] after two tiles: ${JSON.stringify(mid.map((t) => t.name))}`);

  // touch tile 1 so tile 2 is now the least recently used
  await page.evaluate(() => window.__opfsTest.loadTile(1));
  await page.evaluate(() => window.__opfsTest.loadTile(3));

  const names = (await page.evaluate(() => window.__opfsTest.tables())).map((t) => t.name);
  console.log(`[budget] after the third tile: ${JSON.stringify(names)}`);
  expect(names, "the pinned whole-object table is never evicted").toContain(
    "v9/tables/taxon.parquet",
  );
  expect(names).toContain("v9/serve/cell_model/tile=3/data_0.parquet");
  expect(names, "tile 2 was the least recently used").not.toContain(
    "v9/serve/cell_model/tile=2/data_0.parquet",
  );
  expect(names, "tile 1 was touched more recently and survives").toContain(
    "v9/serve/cell_model/tile=1/data_0.parquet",
  );
});

test("purgeRestricted removes only the named versions' files", async ({ page, browserName }) => {
  const { boot } = await firstLoad(page, { ver: "v9" });
  if ((await tierOf(page, boot, browserName)) === "memory") return;
  await page.evaluate(() => window.__opfsTest.close());
  // a second release's file, written the same way
  await page.evaluate(() => window.__opfsTest.init({ ver: "v7" }));
  const v7 = await page.evaluate(() => window.__opfsTest.loadAndCount());
  expect(v7.n, "v7's own taxon.parquet is a real object too").toBeGreaterThan(0);
  await page.evaluate(() => window.__opfsTest.close());

  const before = (await page.evaluate(() => window.__opfsTest.listFiles())).map((f) => f.file);
  expect(before.sort()).toEqual([V9_FILE, "v7.s1.dv1.4.3.duckdb"].sort());

  const removed = await page.evaluate(() => window.__opfsTest.purgeRestricted(["v9"]));
  const after = (await page.evaluate(() => window.__opfsTest.listFiles())).map((f) => f.file);
  console.log(`[purge] removed=${JSON.stringify(removed)} remaining=${JSON.stringify(after)}`);
  expect(removed).toEqual([V9_FILE]);
  expect(after, "the public release's file is untouched").toEqual(["v7.s1.dv1.4.3.duckdb"]);
});

test('"keep data on this device" off means memory only, and the existing files are deleted', async ({
  page,
  browserName,
}) => {
  const { boot } = await firstLoad(page);
  if ((await tierOf(page, boot, browserName)) === "memory") return;
  await page.evaluate(() => window.__opfsTest.close());
  const before = (await page.evaluate(() => window.__opfsTest.listFiles())).map((f) => f.file);
  console.log(`[keep-data] before turning the setting off: ${JSON.stringify(before)}`);
  expect(before).toContain(V9_FILE);

  const off = (await page.evaluate(() => window.__opfsTest.init({ keepData: false }))) as {
    kind: string;
    reason: string;
  };
  expect(off).toMatchObject({ kind: "memory", reason: "setting-off" });
  expect(await page.evaluate(() => window.__opfsTest.listFiles())).toEqual([]);
  expect(
    await page.evaluate(() => window.__opfsTest.events()),
    "a deliberate setting is not a fallback event",
  ).toEqual([]);
  const count = await page.evaluate(() => window.__opfsTest.loadAndCount());
  expect(count.n).toBe(ROWS);
});
