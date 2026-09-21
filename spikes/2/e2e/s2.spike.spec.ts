import { test, expect } from "@playwright/test";
import { OCEAN_POINTS, readOceanPixel, isPainted } from "./probe";

// atlas-0 Step 4, S2 gate ("2026-09-20 atlas app plan.md" / "atlas-0 scaffold + spikes.md" Step 4 +
// Review checklist):
//   - **/*.wasm and **/duckdb* blocked
//   - the map canvas has painted pixels at two known ocean points (gl.readPixels)
//   - the Program-Area table has 20 rows
//   - the flower has 7-8 petals
//   - first frame <= 2.5s
//   - zero DuckDB bytes requested -- read literally as zero REQUESTS to a duckdb*-named URL, not
//     "zero bytes transferred": a request that gets aborted by the route block below still counts
//     as "requested" (page.on("request") fires before routing), which is exactly what lets the
//     seeded-fault spec below make this same assertion fail.

test.describe("S2: first paint without WASM", () => {
  test("shell paints the map + Program-Area table + flower with zero DuckDB/WASM bytes", async ({
    page,
  }) => {
    const blockedRequests: string[] = [];
    const duckdbRequests: string[] = [];

    // the gate's own network block: **/*.wasm and **/duckdb* never reach the network.
    await page.route("**/*.wasm", (route) => {
      blockedRequests.push(route.request().url());
      return route.abort();
    });
    await page.route("**/duckdb*", (route) => {
      blockedRequests.push(route.request().url());
      return route.abort();
    });
    // tracked independently of routing so an aborted request still counts as "requested".
    page.on("request", (req) => {
      if (/duckdb/i.test(req.url())) duckdbRequests.push(req.url());
    });

    await page.goto("/");
    await page.waitForFunction(() => window.__s2?.marks?.firstRender !== undefined, {
      timeout: 10_000,
    });

    // gate: first frame <= 2.5s (measured from this module's own scriptStart mark, the earliest
    // timestamp available to it -- see scripts/measure.mjs for the FCP-anchored version used for
    // the raw RESULTS.md numbers).
    const marks = await page.evaluate(() => window.__s2.marks);
    const firstFrameMs = marks.firstRender - marks.scriptStart;
    expect(firstFrameMs, `map-first-frame was ${firstFrameMs}ms`).toBeLessThanOrEqual(2500);

    // gate: zero DuckDB bytes requested.
    expect(duckdbRequests, `unexpected duckdb requests: ${duckdbRequests.join(", ")}`).toEqual([]);
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

    // the score raster tile hasn't necessarily loaded and drawn yet at the FIRST "render" event
    // (that can fire for just the background layer, right after setStyle) -- poll MapLibre's own
    // loaded()/areTilesLoaded() (same technique CalCOFI Explorer's scripts/verify.mjs uses) before
    // probing pixels. firstFrameMs above, not this wait, is what the 2.5s gate measures.
    await page.waitForFunction(
      () => {
        const map = window.__s2?.map;
        return !!map && map.loaded() && map.areTilesLoaded();
      },
      { timeout: 10_000 },
    );

    // gate: the map canvas has painted pixels at two known ocean points.
    for (const pt of OCEAN_POINTS) {
      const px = await readOceanPixel(page, pt);
      expect(isPainted(px), `${pt.label} (${pt.lon},${pt.lat}) is unpainted: rgba(${px.r},${px.g},${px.b},${px.a})`).toBe(
        true,
      );
    }
  });
});

// ── seeded faults (plan Step 4 Review checklist: "a check that cannot fail is not a check") ──────
//
// Both blocks below use Playwright's built-in test.fail() so the fault is exercised on every CI
// run, permanently, without leaving a red build: test.fail() tells Playwright this test is
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
    await page.waitForFunction(() => window.__s2?.marks?.firstRender !== undefined, {
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
    await page.waitForFunction(
      () => {
        const map = window.__s2?.map;
        return !!map && map.loaded() && map.areTilesLoaded();
      },
      { timeout: 10_000 },
    );

    // same assertion as the real gate above -- this is the one that must fail (the style has no
    // layers at all, so every probe point reads back the plain background color).
    for (const pt of OCEAN_POINTS) {
      const px = await readOceanPixel(page, pt);
      expect(isPainted(px)).toBe(true);
    }
  });
});
