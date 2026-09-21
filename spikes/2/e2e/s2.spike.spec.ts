import { test, expect } from "@playwright/test";
import { OCEAN_POINTS, readOceanPixel, isPainted } from "./probe";

// atlas-0 Step 4, S2 gate ("2026-09-20 atlas app plan.md" / "atlas-0 scaffold + spikes.md" Step 4 +
// Review checklist), fix round 2:
//   - **/*.wasm and **/duckdb* blocked
//   - the map canvas has painted pixels at two known ocean points (gl.readPixels) -- RASTER data
//   - vector data ALSO renders: after the zones source loads, queryRenderedFeatures on the
//     zones-line layer returns >= 1 feature (fix round 2: round 1's gate only probed raster ocean
//     points, so it never noticed the worker silently never parsing a single vector tile -- see
//     RESULTS.md "fix round 2")
//   - no response for any maplibre worker/shared-chunk request is a 404 (fix round 2: this is
//     exactly what a broken worker wiring produces -- the worker's OWN internal import 404s, which
//     is invisible unless something is actually watching worker/shared asset responses)
//   - the Program-Area table has 20 rows
//   - the flower has 7-8 petals
//   - firstDataFrame <= 2.5s, with zero duckdb/wasm requests before it -- NOT the naive
//     "first render" mark, which fires on an empty background before any tile exists and so can
//     never go red (that was fix round 1's finding; see RESULTS.md "fix round 1"). firstDataFrame
//     is set inside src/app.ts's own "render" handler, re-checked every render tick, the first
//     time gl.readPixels at BOTH ocean probe points reads back a non-background colour.
//   - zero DuckDB bytes requested -- read literally as zero REQUESTS to a duckdb*-named URL, not
//     "zero bytes transferred": a request that gets aborted by the route block below still counts
//     as "requested" (page.on("request") fires before routing), which is exactly what lets the
//     seeded-fault spec below make this same assertion fail.

test.describe("S2: first paint without WASM", () => {
  test("shell paints the map + Program-Area table + flower; firstDataFrame + vector gate", async ({
    page,
  }) => {
    const blockedRequests: string[] = [];
    const duckdbRequests: { url: string; at: number }[] = [];
    // fix round 2: every response for a maplibre worker or shared-chunk asset -- this is how the
    // round 1 bug (worker's own "./maplibre-gl-shared.mjs" import 404ing) becomes visible to a
    // gate instead of silently only affecting vector rendering.
    const workerResponses: { url: string; status: number }[] = [];
    page.on("response", (res) => {
      if (/maplibre-gl-(worker|shared)/i.test(res.url())) {
        workerResponses.push({ url: res.url(), status: res.status() });
      }
    });

    // the gate's own network block: **/*.wasm and **/duckdb* never reach the network.
    await page.route("**/*.wasm", (route) => {
      blockedRequests.push(route.request().url());
      return route.abort();
    });
    await page.route("**/duckdb*", (route) => {
      blockedRequests.push(route.request().url());
      return route.abort();
    });
    // tracked independently of routing (with a wall-clock timestamp) so an aborted request still
    // counts as "requested", and so it can be checked against the firstDataFrame cutoff below.
    page.on("request", (req) => {
      if (/duckdb|wasm/i.test(req.url())) duckdbRequests.push({ url: req.url(), at: Date.now() });
    });

    const gotoAt = Date.now();
    await page.goto("/");
    await page.waitForFunction(() => window.__s2?.marks?.firstDataFrame !== undefined, {
      timeout: 10_000,
    });

    const marks = await page.evaluate(() => window.__s2.marks);

    // gate: firstDataFrame <= 2.5s. Report the honest number regardless of outcome.
    const firstDataFrameMs = marks.firstDataFrame - marks.scriptStart;
    expect(firstDataFrameMs, `firstDataFrame was ${firstDataFrameMs}ms`).toBeLessThanOrEqual(2500);

    // gate: zero duckdb/wasm requests BEFORE firstDataFrame (not just "ever" -- scoped per plan
    // fix round 1). gotoAt + mark is an approximation (mark is performance.now(), gotoAt is
    // Date.now() captured just before navigation resolves) -- good enough at this granularity, and
    // called out the same way in scripts/measure.mjs.
    const cutoffWallMs = gotoAt + marks.firstDataFrame;
    const duckdbBeforeFirstDataFrame = duckdbRequests.filter((r) => r.at <= cutoffWallMs);
    expect(
      duckdbBeforeFirstDataFrame,
      `duckdb/wasm requests before firstDataFrame: ${duckdbBeforeFirstDataFrame.map((r) => r.url).join(", ")}`,
    ).toEqual([]);
    expect(blockedRequests, `unexpected wasm/duckdb requests: ${blockedRequests.join(", ")}`).toEqual(
      [],
    );

    // gate: Program-Area table has 20 rows.
    const rowCount = await page.locator("#program-area-table tbody tr").count();
    expect(rowCount).toBe(20);

    // gate: the flower has 7-8 petals.
    const petalCount = await page.locator(".petal").count();
    expect(petalCount).toBeGreaterThanOrEqual(7);
    expect(petalCount).toBeLessThanOrEqual(8);

    // sanity (not separately gated at a time budget -- only firstDataFrame has one): zonesPainted
    // and idle both eventually fire.
    await page.waitForFunction(() => window.__s2?.marks?.zonesPainted !== undefined, {
      timeout: 10_000,
    });
    await page.waitForFunction(() => window.__s2?.marks?.idle !== undefined, { timeout: 10_000 });

    // gate: the map canvas has painted pixels at two known ocean points (re-confirmed directly
    // from the test side, independent of the in-page firstDataFrame check above).
    for (const pt of OCEAN_POINTS) {
      const px = await readOceanPixel(page, pt);
      expect(isPainted(px), `${pt.label} (${pt.lon},${pt.lat}) is unpainted: rgba(${px.r},${px.g},${px.b},${px.a})`).toBe(
        true,
      );
    }

    // gate (fix round 2): VECTOR data rendered, not just raster. A worker whose own module init
    // 404s never parses a single vector tile, while the raster score layer keeps painting fine --
    // so the raster-only checks above cannot see this class of bug. Record the count (not just
    // ">0") so the report has a real number, not a boolean.
    const zonesFeatureCount = await page.evaluate(() => window.__s2.zonesFeatureCount ?? 0);
    expect(
      zonesFeatureCount,
      `zones-line queryRenderedFeatures returned ${zonesFeatureCount} features (expected >= 1)`,
    ).toBeGreaterThanOrEqual(1);

    // gate (fix round 2): no maplibre worker/shared-chunk request 404'd. This is the direct,
    // network-level symptom of round 1's `?url`-only worker wiring bug (its own
    // "./maplibre-gl-shared.mjs" import 404s) -- asserted here so a regression is caught even if
    // some future change makes the vector-feature count pass for an unrelated reason.
    const worker404s = workerResponses.filter((r) => r.status === 404);
    expect(
      worker404s,
      `maplibre worker/shared requests that 404'd: ${JSON.stringify(worker404s)}`,
    ).toEqual([]);
  });
});

// ── seeded faults (plan Step 4 Review checklist: "a check that cannot fail is not a check") ──────
//
// All four blocks below use Playwright's built-in test.fail() so the fault is exercised on every
// CI run, permanently, without leaving a red build: test.fail() tells Playwright this test is
// EXPECTED to fail, so a genuine failure inside it is reported as an (expected) pass for the
// overall run, and -- critically -- if the fault ever stopped tripping the assertion (e.g. someone
// "fixed" the harness in a way that silently defeats the gate), the test would unexpectedly PASS
// and Playwright would flag that as a failure. This is the S2 analogue of the root's
// tests/fixtures/size-budget-static-duckdb/ fixture proof.

test.describe("seeded fault: duckdb-named asset fetched before first frame", () => {
  test.fail(true, "plan Step 4: this must make the zero-duckdb-requests gate FAIL");

  test("?seed=duckdb-fetch trips the zero-duckdb-requests assertion", async ({ page }) => {
    const duckdbRequests: string[] = [];
    await page.route("**/*.wasm", (route) => route.abort());
    await page.route("**/duckdb*", (route) => route.abort());
    page.on("request", (req) => {
      if (/duckdb/i.test(req.url())) duckdbRequests.push(req.url());
    });

    await page.goto("/?seed=duckdb-fetch");
    await page.waitForFunction(() => window.__s2?.marks?.firstDataFrame !== undefined, {
      timeout: 10_000,
    });

    // same assertion as the real gate above -- this is the one that must fail.
    expect(duckdbRequests).toEqual([]);
  });
});

test.describe("seeded fault: unpainted canvas (style with no layers)", () => {
  test.fail(true, "plan Step 4: this must make the pixel probe FAIL");

  test("?seed=blank-style trips the ocean-pixel-painted assertion", async ({ page }) => {
    await page.goto("/?seed=blank-style");
    // firstDataFrame never fires for this seed (no score raster is ever composed into the style),
    // so this waits for "idle" instead -- which DOES fire quickly (there is nothing to load) -- and
    // then makes the same pixel assertion the real gate makes, which must fail here.
    await page.waitForFunction(() => window.__s2?.marks?.idle !== undefined, { timeout: 10_000 });

    for (const pt of OCEAN_POINTS) {
      const px = await readOceanPixel(page, pt);
      expect(isPainted(px)).toBe(true);
    }
  });
});

test.describe("seeded fault: S3 + titiler responses delayed 3s", () => {
  test.fail(true, "plan Step 4 fix round 1: this must make the firstDataFrame <= 2.5s gate FAIL");

  test("3s response delay on S3/titiler trips the firstDataFrame budget", async ({ page }) => {
    // delay every response from the release bucket and titiler by 3s -- both are the only two
    // remote hosts the composed style depends on (zones pmtiles + score raster tiles). Matched on
    // the real hostname, not a path/query substring: S3 is path-style
    // (s3.us-east-1.amazonaws.com/oceanmetrics.io-public/...), so "oceanmetrics.io-public" is a
    // PATH segment, never the hostname -- an earlier version of this route matcher checked
    // `url.hostname` against that path string and so never matched S3 at all (found while
    // rewriting scripts/measure.mjs's byte classifier, same bug in a different spot -- see
    // RESULTS.md fix round 1). This also incidentally catches the pmtiles range requests, which go
    // to the same S3 hostname.
    await page.route(
      (url) => url.hostname === "s3.us-east-1.amazonaws.com" || url.hostname === "titiler-v8.marinesensitivity.org",
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.continue();
      },
    );

    await page.goto("/");
    await page.waitForFunction(() => window.__s2?.marks?.firstDataFrame !== undefined, {
      timeout: 20_000, // generous: this test's whole point is that firstDataFrame arrives LATE
    });
    const marks = await page.evaluate(() => window.__s2.marks);
    const firstDataFrameMs = marks.firstDataFrame - marks.scriptStart;

    // same assertion as the real gate above -- this is the one that must fail.
    expect(firstDataFrameMs).toBeLessThanOrEqual(2500);
  });
});

test.describe("seeded fault: worker asset loaded via ?url (fix round 2)", () => {
  test.fail(
    true,
    "fix round 2: round 1's `?url`-only worker wiring must make the vector-feature-count gate FAIL",
  );

  test("fault-worker-url.html trips the zones-feature-count assertion", async ({ page }) => {
    // src/main-fault-worker-url.ts (built via fault-worker-url.html, a real second vite build
    // entry -- see vite.config.ts) is byte-for-byte the same app as the real entry EXCEPT its
    // worker is imported with `?url` alone, which is exactly the wiring round 1's RESULTS.md
    // reported as "passing". It is not: the worker's own "./maplibre-gl-shared.mjs" import 404s
    // (asset never emitted under that literal name), so the worker throws during its own module
    // init and never parses a single vector tile -- while the raster score layer paints fine
    // regardless, which is why round 1's raster-only pixel gate could not see this.
    const workerResponses: { url: string; status: number }[] = [];
    page.on("response", (res) => {
      if (/maplibre-gl-(worker|shared)/i.test(res.url())) {
        workerResponses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto("/fault-worker-url.html");
    // firstDataFrame (raster) still fires normally for this variant -- only vector data is
    // affected -- so it's a reliable "enough time has passed" signal without waiting on
    // zonesPainted/idle, neither of which ever fires here (the zones source never finishes
    // loading because its worker crashed).
    await page.waitForFunction(() => window.__s2?.marks?.firstDataFrame !== undefined, {
      timeout: 10_000,
    });
    // give the (broken) worker's 404 a moment to actually land before reading it back.
    await page.waitForTimeout(500);

    const zonesFeatureCount = await page.evaluate(() => window.__s2.zonesFeatureCount ?? 0);
    // context for the RESULTS.md report, not part of the assertion that must fail:
    console.log("fault-worker-url.html: workerResponses =", JSON.stringify(workerResponses));
    console.log("fault-worker-url.html: zonesFeatureCount =", zonesFeatureCount);

    // same assertion as the real gate above -- this is the one that must fail.
    expect(zonesFeatureCount).toBeGreaterThanOrEqual(1);
  });
});
