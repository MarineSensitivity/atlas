import { test, expect } from "@playwright/test";
import { OCEAN_POINTS, readOceanPixel, isPainted } from "./probe";

// atlas-0 Step 4, S2 gate. S2 review fix round 1 (Opus review of atlas-0, finding F5): with
// titiler-v8.marinesensitivity.org unreachable, 4 of 5 specs from the previous round timed out at
// 30s waiting for raster tiles, so nothing about the maplibre-gl 6.10 pin's ACTUAL claim (the
// worker correctly parses vector tiles) could be verified -- and the `?url` seeded fault's
// `test.fail()` was accepting that 30s firstDataFrame timeout as "the expected failure", never
// reaching its own `expect(zonesFeatureCount)` check at all. Two structural fixes:
//
// 1. THE GATE IS SPLIT IN TWO. What the pin rests on (vector tiles parse) needs S3 only -- it has
//    nothing to do with titiler/raster. "VECTOR GATE" below runs against `?seed=vector-only`
//    (src/app.ts composeStyle(boot, {includeRaster:false})), which never creates a raster source
//    at all, so zero titiler requests happen, ever. "RASTER + TIMING GATE" is the titiler-dependent
//    half (ocean-pixel probes, firstDataFrame <= 2.5s) and is `test.skip()`-ed with a named reason
//    when a one-shot reachability probe (below) finds titiler unreachable -- reported as SKIPPED,
//    never as a false pass and never as an opaque 30s timeout.
// 2. NO MORE `test.fail()`. Every seeded-fault test below is a NORMAL test that must genuinely
//    PASS: it first asserts (with a real, unwrapped `expect()`) that its own trigger actually fired
//    (e.g. the fault's worker really did 404, the fault's vector-feature count really is 0) --  if
//    the trigger didn't fire, the test fails for real, not "for the wrong reason" -- and only THEN
//    wraps the one assertion that's supposed to fail in a try/catch and asserts that it threw. This
//    is what "pins" each fault to its actual cause: a monolithic `test.fail()` accepts ANY failure
//    anywhere in the test body (a 30s timeout included), which is exactly what let round 2's
//    seeded fault "pass" while titiler was down without ever reaching its real assertion.

const TITILER_HEALTHZ = "https://titiler-v8.marinesensitivity.org/healthz";

async function probeTitiler(timeoutMs = 5000): Promise<{ reachable: boolean; reason: string }> {
  try {
    const res = await fetch(TITILER_HEALTHZ, { signal: AbortSignal.timeout(timeoutMs) });
    return { reachable: res.ok, reason: `GET ${TITILER_HEALTHZ} -> HTTP ${res.status}` };
  } catch (e) {
    return { reachable: false, reason: `GET ${TITILER_HEALTHZ} failed: ${(e as Error).message}` };
  }
}

// one-shot, at module load (top-level await -- this file is ESM, package.json has "type":
// "module"), so every describe/test below can read the result synchronously. Re-probed once per
// worker process, not once per test.
const titiler = await probeTitiler();
console.log(`titiler reachability probe: reachable=${titiler.reachable} (${titiler.reason})`);

// shared by every fault below: assert `fn` throws, without ever letting that expected throw
// satisfy anything OTHER than this one check. Unlike `test.fail()`, a genuine failure ANYWHERE
// else in the test (including this helper's own "did it throw" assertion) still fails the test for
// real -- nothing here silently accepts an unrelated failure.
function expectThrows(fn: () => void, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  expect(threw, message).toBe(true);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// (a) VECTOR GATE -- no titiler dependency at all. This is what the maplibre-gl 6.10 pin's
// `?worker&url` wiring actually needs to prove: the worker parses vector tiles. Always runs.
// ───────────────────────────────────────────────────────────────────────────────────────────────
test.describe("S2 VECTOR GATE (S3 only, no titiler dependency)", () => {
  test("?seed=vector-only: zones vector data renders, zero worker/shared 404s, zero duckdb/wasm, table + flower render", async ({
    page,
  }) => {
    const duckdbWasmRequests: string[] = [];
    const workerResponses: { url: string; status: number }[] = [];
    const titilerRequests: string[] = [];
    page.on("request", (req) => {
      if (/duckdb|wasm/i.test(req.url())) duckdbWasmRequests.push(req.url());
      if (/titiler-v8/i.test(req.url())) titilerRequests.push(req.url());
    });
    page.on("response", (res) => {
      if (/maplibre-gl-(worker|shared)/i.test(res.url())) {
        workerResponses.push({ url: res.url(), status: res.status() });
      }
    });
    await page.route("**/*.wasm", (route) => route.abort());
    await page.route("**/duckdb*", (route) => route.abort());

    await page.goto("/?seed=vector-only");

    // bounded wait, NOT gated on the success condition: zonesPainted (src/app.ts) only latches
    // when queryRenderedFeatures().length > 0, so a real vector-parsing regression would leave it
    // stuck undefined forever -- waiting on it alone (unbounded, or bounded but then re-thrown)
    // turns a named regression into an opaque "Timeout Xms exceeded" with no useful message. This
    // wait is capped at 10s and its OWN timeout is swallowed; the actual assertion just below
    // reads the real recorded value either way and names the layer.
    await page
      .waitForFunction(
        () => window.__s2?.marks?.zonesPainted !== undefined || window.__s2?.marks?.idle !== undefined,
        undefined, // page.waitForFunction(fn, arg, options) -- the options go THIRD, not second
        // (found by running this harness: `.waitForFunction(fn, {timeout:N})` silently passes the
        // options object as `arg` instead, so every such call in this file used to fall through to
        // Playwright's 30s TEST timeout instead of the intended bound -- see RESULTS.md fix round 3)
        { timeout: 10_000 },
      )
      .catch(() => {});

    const zonesFeatureCount = await page.evaluate(() => window.__s2.zonesFeatureCount ?? 0);
    const worker404s = workerResponses.filter((r) => r.status === 404);
    // the message names BOTH the layer and any worker/shared 404 in one place -- this is the
    // assertion the pin actually rests on, and it's the FIRST one to fail (subsequent expect()
    // calls below never execute once this throws), so its message has to be self-sufficient: a
    // regression here must never surface as a bare "0 !>= 1" with no clue why.
    expect(
      zonesFeatureCount,
      `zones-line queryRenderedFeatures() returned ${zonesFeatureCount} features after waiting up to 10s ` +
        `(source "zones", layer "zones-line"); worker/shared responses: ${JSON.stringify(workerResponses)}` +
        (worker404s.length ? `; 404s: ${JSON.stringify(worker404s)}` : "; no worker/shared 404s"),
    ).toBeGreaterThanOrEqual(1);

    // this IS the other half of the assertion the pin rests on: never 0 titiler requests were made this run.
    expect(titilerRequests, `?seed=vector-only must never request titiler: ${titilerRequests.join(", ")}`).toEqual(
      [],
    );

    expect(
      worker404s,
      `maplibre worker/shared requests that 404'd: ${JSON.stringify(workerResponses)}`,
    ).toEqual([]);

    expect(
      duckdbWasmRequests,
      `unexpected duckdb/wasm requests: ${duckdbWasmRequests.join(", ")}`,
    ).toEqual([]);

    const rowCount = await page.locator("#program-area-table tbody tr").count();
    expect(rowCount).toBe(20);

    const petalCount = await page.locator(".petal").count();
    expect(petalCount).toBeGreaterThanOrEqual(7);
    expect(petalCount).toBeLessThanOrEqual(8);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// (b) RASTER + TIMING GATE -- needs titiler. Skipped (not failed, not timed out) when the
// reachability probe above found titiler unreachable.
// ───────────────────────────────────────────────────────────────────────────────────────────────
test.describe("S2 RASTER + TIMING GATE (needs titiler)", () => {
  test.skip(!titiler.reachable, `titiler unreachable: ${titiler.reason}`);

  test("shell paints raster ocean points; firstDataFrame <= 2.5s, zero duckdb/wasm before it", async ({
    page,
  }) => {
    const blockedRequests: string[] = [];
    const duckdbRequests: { url: string; at: number }[] = [];
    await page.route("**/*.wasm", (route) => {
      blockedRequests.push(route.request().url());
      return route.abort();
    });
    await page.route("**/duckdb*", (route) => {
      blockedRequests.push(route.request().url());
      return route.abort();
    });
    page.on("request", (req) => {
      if (/duckdb|wasm/i.test(req.url())) duckdbRequests.push({ url: req.url(), at: Date.now() });
    });

    const gotoAt = Date.now();
    await page.goto("/");
    await page.waitForFunction(() => window.__s2?.marks?.firstDataFrame !== undefined, undefined, {
      timeout: 10_000,
    });

    const marks = await page.evaluate(() => window.__s2.marks);
    const firstDataFrameMs = marks.firstDataFrame - marks.scriptStart;
    expect(firstDataFrameMs, `firstDataFrame was ${firstDataFrameMs}ms`).toBeLessThanOrEqual(2500);

    const cutoffWallMs = gotoAt + marks.firstDataFrame;
    const duckdbBeforeFirstDataFrame = duckdbRequests.filter((r) => r.at <= cutoffWallMs);
    expect(
      duckdbBeforeFirstDataFrame,
      `duckdb/wasm requests before firstDataFrame: ${duckdbBeforeFirstDataFrame.map((r) => r.url).join(", ")}`,
    ).toEqual([]);
    expect(blockedRequests, `unexpected wasm/duckdb requests: ${blockedRequests.join(", ")}`).toEqual([]);

    for (const pt of OCEAN_POINTS) {
      const px = await readOceanPixel(page, pt);
      expect(
        isPainted(px),
        `${pt.label} (${pt.lon},${pt.lat}) is unpainted: rgba(${px.r},${px.g},${px.b},${px.a})`,
      ).toBe(true);
    }
  });
});

// ── seeded faults ─────────────────────────────────────────────────────────────────────────────
//
// Every fault below is a NORMAL test (no `test.fail()`): it asserts its own trigger fired with a
// real `expect()` (a genuine, unexcused failure if it didn't), then uses `expectThrows()` to pin
// the ONE assertion that's supposed to fail to exactly that assertion. This is the S2 analogue of
// the root's `tests/fixtures/size-budget-static-duckdb/` fixture proof, made stricter per fix
// round 1: a check that can pass for the wrong reason is not a check either.

test.describe("seeded fault: duckdb-named asset fetched before first frame", () => {
  test("?seed=duckdb-fetch: request fires, and the zero-duckdb-requests assertion fails", async ({
    page,
  }) => {
    const duckdbRequests: string[] = [];
    await page.route("**/*.wasm", (route) => route.abort());
    await page.route("**/duckdb*", (route) => route.abort());
    page.on("request", (req) => {
      if (/duckdb/i.test(req.url())) duckdbRequests.push(req.url());
    });

    await page.goto("/?seed=duckdb-fetch");
    // the fetch fires synchronously at module load, well before any render -- no titiler
    // dependency, so a short fixed wait is enough (not gated on firstDataFrame).
    await page.waitForTimeout(500);

    // TRIGGER -- must genuinely pass.
    expect(
      duckdbRequests.length,
      "expected ?seed=duckdb-fetch to trigger at least one duckdb-named request",
    ).toBeGreaterThan(0);

    // PINNED -- only this specific assertion is allowed to fail.
    expectThrows(
      () => expect(duckdbRequests).toEqual([]),
      `expected the zero-duckdb-requests assertion to fail; requests were ${JSON.stringify(duckdbRequests)}`,
    );
  });
});

test.describe("seeded fault: unpainted canvas (style with no layers)", () => {
  test("?seed=blank-style: canvas painted-pixel assertion fails at both ocean points", async ({
    page,
  }) => {
    await page.goto("/?seed=blank-style");
    // no titiler dependency: a blank style has no sources at all, so "idle" fires immediately.
    await page.waitForFunction(() => window.__s2?.marks?.idle !== undefined, undefined, {
      timeout: 10_000,
    });

    for (const pt of OCEAN_POINTS) {
      const px = await readOceanPixel(page, pt);
      expectThrows(
        () => expect(isPainted(px)).toBe(true),
        `expected ${pt.label} (${pt.lon},${pt.lat}) pixel-painted assertion to fail under a blank style; got rgba(${px.r},${px.g},${px.b},${px.a})`,
      );
    }
  });
});

test.describe("seeded fault: S3 + titiler responses delayed 3s", () => {
  test.skip(!titiler.reachable, `titiler unreachable: ${titiler.reason}`);

  test("3s response delay: firstDataFrame budget assertion fails", async ({ page }) => {
    let sawDelayedResponse = false;
    await page.route(
      (url) => url.hostname === "s3.us-east-1.amazonaws.com" || url.hostname === "titiler-v8.marinesensitivity.org",
      async (route) => {
        const t0 = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (Date.now() - t0 >= 2900) sawDelayedResponse = true;
        await route.continue();
      },
    );

    await page.goto("/");
    await page.waitForFunction(() => window.__s2?.marks?.firstDataFrame !== undefined, undefined, {
      timeout: 20_000, // generous: this test's whole point is that firstDataFrame arrives LATE
    });
    const marks = await page.evaluate(() => window.__s2.marks);
    const firstDataFrameMs = marks.firstDataFrame - marks.scriptStart;

    // TRIGGER
    expect(sawDelayedResponse, "expected at least one S3/titiler response to be delayed ~3s").toBe(
      true,
    );

    // PINNED
    expectThrows(
      () => expect(firstDataFrameMs).toBeLessThanOrEqual(2500),
      `expected firstDataFrame <= 2.5s to fail; firstDataFrame was ${firstDataFrameMs}ms`,
    );
  });
});

test.describe("seeded fault: worker asset loaded via ?url, not ?worker&url", () => {
  test("fault-worker-url.html: worker's own module import 404s, zero vector features, and the >=1 assertion fails", async ({
    page,
  }) => {
    // src/main-fault-worker-url.ts (built via fault-worker-url.html, a real second `vite build`
    // entry -- see vite.config.ts's rollupOptions.input, since the worker URL is a build-time
    // resolution, not a runtime `?seed=` toggle) is byte-for-byte the same app as the real entry
    // EXCEPT its worker is imported with `?url` alone, which is exactly round 1's wiring. The
    // worker file itself statically imports "./maplibre-gl-shared.mjs"; `?url` copies it verbatim
    // without rewriting that import, so it 404s at runtime and the worker never parses a vector
    // tile.
    //
    // `?seed=vector-only` on TOP of the fault entry (both are read independently: the entry file
    // decides the worker URL, the `?seed=` query param decides the style -- see src/app.ts) --
    // found while running this: without it, this test's page still composed the RASTER layer too,
    // and with titiler genuinely unreachable (not just slow), MapLibre's raster tile fetches each
    // took long enough to time out at the OS/browser level that the whole test blew Playwright's
    // 30s default test timeout before ever reaching its own assertions -- the exact "opaque
    // timeout instead of a named failure" failure mode fix round 1 exists to eliminate, just
    // relocated from firstDataFrame to a page-teardown timeout. `?seed=vector-only` removes the
    // raster source entirely, so this fault test has no titiler dependency at all, full stop.
    const workerResponses: { url: string; status: number }[] = [];
    page.on("response", (res) => {
      if (/maplibre-gl-(worker|shared)/i.test(res.url())) {
        workerResponses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto("/fault-worker-url.html?seed=vector-only");
    // bounded wait, NOT gated on success -- see the VECTOR GATE comment above for why. This
    // variant genuinely never reaches zonesPainted/idle (the worker crashed), so this always waits
    // out the full 10s; that's expected and is why this test intentionally does not use
    // firstDataFrame at all (which round 2's version of this test did -- exactly the mechanism the
    // reviewer flagged as letting the fault "pass" for the wrong reason while titiler was down).
    await page
      .waitForFunction(
        () => window.__s2?.marks?.zonesPainted !== undefined || window.__s2?.marks?.idle !== undefined,
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500); // let a just-completed 404 response land

    const zonesFeatureCount = await page.evaluate(() => window.__s2.zonesFeatureCount ?? 0);
    const worker404s = workerResponses.filter((r) => r.status === 404);

    // TRIGGERS -- both must genuinely pass. If either doesn't, this test fails for real (not
    // excused by anything below) -- this is exactly the "pin every expected failure to its cause"
    // fix: previously a titiler-driven 30s timeout satisfied a blanket `test.fail()` without ever
    // reaching these checks.
    expect(
      worker404s,
      `expected a maplibre worker/shared 404 under ?url wiring; got ${JSON.stringify(workerResponses)}`,
    ).not.toEqual([]);
    expect(
      zonesFeatureCount,
      "expected zero zones-line features under the broken ?url wiring",
    ).toBe(0);

    // PINNED -- only this one assertion (the one the real VECTOR GATE also makes) is expected to fail.
    expectThrows(
      () =>
        expect(
          zonesFeatureCount,
          `zones-line queryRenderedFeatures() returned ${zonesFeatureCount} features (source "zones", layer "zones-line")`,
        ).toBeGreaterThanOrEqual(1),
      `expected the >=1 vector-feature assertion to fail; zonesFeatureCount was ${zonesFeatureCount}, worker404s was ${JSON.stringify(worker404s)}`,
    );
  });
});
