// atlas-2 Step 4, the committed SEEDED FAULT for the Web Locks rule (`docs/spikes/S1.md` rule 3).
//
// `select.ts` takes the lock with `navigator.locks.request(name, { ifAvailable: true }, cb)`. Drop
// the option and a contended request does not answer "busy" -- it QUEUES, and the second tab never
// paints. S1 measured that at 6001-6024 ms on chromium, firefox AND webkit, i.e. the full timeout,
// never resolving early.
//
// This spec injects exactly that fault (the harness's `plainLock` switch forwards to a
// LockManager with no `ifAvailable`) and asserts the HANG happens, bounded by a hard timeout. It is
// the proof that `opfs.spec.ts`'s second-tab case would be red without the option -- a check that
// cannot fail is not a check. The assertion is specific: `outcome === "timeout"`, never "it threw
// somehow", so an unrelated failure cannot masquerade as the fault being reproduced.
//
// **chromium + firefox only** (fix round 2, defect 3). A demonstration has to be deterministic or
// it is noise: on a loaded machine WebKit tears the whole browser context down while a page sits in
// a deliberately never-resolving `evaluate`, and the spec dies with "Target page, context or
// browser has been closed" -- twice, in two different places, surviving one attempted cure.
// Counting that as "the hang" would be unsound, because a context closing is also exactly what a
// CRASH looks like, and this spec's entire value is that its red means one specific thing. Nothing
// is lost by restricting it: the rule under test is `navigator.locks`, a browser API this app does
// not implement, and `docs/spikes/S1.md` already measured the same hang on all three engines
// (6001-6024 ms). The REAL OPFS specs in `opfs.spec.ts` still run on all three, unchanged.
import { blockExtensionCdn, expect, test } from "./persistent";

const HANG_MS = 6_000;

test("(seeded fault) a plain locks.request without ifAvailable hangs the second tab", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit tears the context down around a never-resolving evaluate under load; a seeded-fault demo must be deterministic (see this file's header)",
  );
  await blockExtensionCdn(context);
  await page.goto("/");
  await page.waitForFunction(() => !!window.__opfsTest);
  await page.evaluate(() => window.__opfsTest.purgeAll()); // see opfs.spec.ts's beforeEach

  // tab 1 takes (and holds) the lock. On WebKit the OPFS open fails and the tier falls back, but
  // the Web LOCK is a separate API that is held either way -- which is precisely what makes this
  // fault reproducible on all three engines.
  const boot1 = (await page.evaluate(() => window.__opfsTest.init())) as { kind: string };
  console.log(`[plain-lock] tab1 boot = ${JSON.stringify(boot1)}`);

  const page2 = await context.newPage();
  await page2.goto("/");
  await page2.waitForFunction(() => !!window.__opfsTest);

  const faulted = await page2.evaluate(async (ms) => {
    const started = performance.now();
    const attempt = window.__opfsTest
      .init({ plainLock: true })
      .then(() => ({ outcome: "resolved", ms: performance.now() - started }));
    const timeout = new Promise<{ outcome: string; ms: number }>((resolve) =>
      setTimeout(() => resolve({ outcome: "timeout", ms: performance.now() - started }), ms),
    );
    return Promise.race([attempt, timeout]);
  }, HANG_MS);
  console.log(`[plain-lock] tab2 WITH the fault = ${JSON.stringify(faulted)}`);
  expect(
    faulted.outcome,
    "without ifAvailable the second tab queues behind tab1's lock and never answers",
  ).toBe("timeout");

  // Close the faulted tab BEFORE opening another one. Its in-page `init({plainLock:true})` promise
  // is still pending forever, holding a QUEUED lock request; leaving that tab alive alongside a
  // third page made WebKit close the whole context out from under `page3.goto()` (observed once in
  // a full three-engine run). Nothing is awaited on it, so closing it loses nothing.
  await page2.close();

  // ... and a fresh tab, with the shipped option, answers immediately.
  const page3 = await context.newPage();
  await page3.goto("/");
  await page3.waitForFunction(() => !!window.__opfsTest);
  const ok = await page3.evaluate(async (ms) => {
    const started = performance.now();
    const attempt = window.__opfsTest
      .init()
      .then((r) => ({ outcome: "resolved", ms: performance.now() - started, r }));
    const timeout = new Promise<{ outcome: string; ms: number }>((resolve) =>
      setTimeout(() => resolve({ outcome: "timeout", ms: performance.now() - started }), ms),
    );
    return Promise.race([attempt, timeout]);
  }, HANG_MS);
  console.log(`[plain-lock] tab3 WITHOUT the fault (${browserName}) = ${JSON.stringify(ok)}`);
  expect(ok.outcome, "with ifAvailable the second tab answers at once, from memory").toBe(
    "resolved",
  );

  await page3.close();
});
