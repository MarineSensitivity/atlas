// atlas-8's timing-gate rule (../workflows/.claude/plans_todo/"atlas-8 verification, accessibility,
// performance.md", 2026-09-21 handover): a first-paint/first-frame TIMING gate must (1) run ALONE
// — its own Playwright project, never beside other specs — and (2) gate on the MEDIAN of N >= 3
// cold runs, never a single sample. Measured cause: this test's own elapsed time was
// 1,578-1,621ms when run alone on chromium, but 3,065ms inside the full `npx playwright test` run
// (fullyParallel: true, three engine projects contending for CPU) — a single sample there would
// fail the gate for a reason that has nothing to do with a real regression.
//
// Split out of e2e/species.smoke.spec.ts, which keeps every non-timing species-lens test
// unchanged. Shared hermetic fixtures/helpers live in e2e/species-hermetic.ts so this file and
// species.smoke.spec.ts never duplicate them.
//
// Isolation, belt-and-suspenders:
//  - playwright.config.ts's "timing" project sets `workers: 1, fullyParallel: false` and is the
//    ONLY project this file's testMatch selects; the three engine projects `testIgnore` this file.
//  - `workers` at the PROJECT level (see @playwright/test's TestProject.workers) only caps the
//    number of workers PLAYWRIGHT WILL SPAWN FOR THIS PROJECT — it does not stop a sibling
//    project's worker processes from running at the same time inside one `npx playwright test`
//    invocation. So a plain `npx playwright test` still leaves the "timing" project's single
//    worker sharing the CPU with chromium/webkit/firefox's workers. True isolation — "never beside
//    other specs" — requires running this project as its OWN invocation:
//    `npx playwright test --project=timing`. Until Playwright e2e is wired into CI (it isn't yet —
//    pages.yml runs `npx vitest run` only; see the plan's atlas-8 deliverable "budgets wired into
//    CI"), that command is the documented, correct way to run this gate in isolation; whoever
//    wires e2e into CI adds it as its own step, after whatever step runs the other projects.
//  - `test.describe.configure({ mode: "serial" })` below is real but secondary insurance for THIS
//    file's own tests (there's only one), matching the convention e2e/map.spec.ts and
//    e2e/species.smoke.spec.ts already use.
import { expect, test } from "@playwright/test";
import { collectConsoleErrors, collectRequests } from "./hermetic";
import { BASEMAP_RGB, RASTER_RGB } from "./map-hermetic";
import { type AtlasMapForSpecies, LEATHERBACK_SP, gotoSpecies } from "./species-hermetic";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

// the raster paints at SPECIES_RASTER_OPACITY (0.8) OVER the basemap — an alpha-blended pixel, not
// the pure raster colour: round(raster*0.8 + basemap*0.2) per channel.
const BLENDED_RASTER_RGB = RASTER_RGB.map((c, i) => Math.round(c * 0.8 + BASEMAP_RGB[i] * 0.2));

// The plan's own gate: "first species pixel <= 2.5s cold" (atlas-8 budgets table), on the MEDIAN
// of N >= 3 cold runs.
const BUDGET_MS = 2_500;
const RUNS = 3;

test.describe("species lens, cold first-paint timing (own Playwright project, workers: 1)", () => {
  test("a deep link (?sp=) paints the first species pixel: median of 3 cold loads <= 2.5s, zero wasm/duckdb requests", async ({
    browser,
  }) => {
    // atlas-8 fix round 1: 3 loop iterations, each with its own generous (up to 30s) poll
    // ceilings below, can exceed Playwright's 30s default TEST timeout on its own -- independent
    // of whether any individual poll actually needs that long. Widen the test's own budget so a
    // slow-but-still-passing run is never truncated by the wrong timer (this does not touch
    // BUDGET_MS, the actual gate, at all).
    test.setTimeout(120_000);
    const samples: number[] = [];

    for (let run = 1; run <= RUNS; run++) {
      // a FRESH context per run — a real cold load, not a warm reload of the same page/cache.
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const requests = collectRequests(page);
      const errors = collectConsoleErrors(page);
      const start = Date.now();
      await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);

      // The 2.5s BUDGET is enforced ONCE, below (on the median) — each poll here gets a generous
      // ceiling of its own so nobody's individual timeout is the artificial bottleneck on a run
      // that is genuinely on-budget end to end.
      await expect
        .poll(
          () => page.locator('[data-testid="species-panel"] [data-testid="layer-bar"]').count(),
          {
            message:
              "the layer bar never rendered — the taxon shard fetch is the first thing to check",
            timeout: 10_000,
          },
        )
        .toBeGreaterThan(0);

      // the actual first species PIXEL, not just the DOM: the raster layer must exist and its
      // source must be loaded before a probe at the map's own center can mean anything.
      //
      // atlas-8 fix round 1: the species lens' own raster-applying effect can land while
      // `map.isStyleLoaded()` is still false (the SAME `src/lib/map/styleQueue.ts` race
      // e2e/map.spec.ts's and e2e/scores.firstpaint.spec.ts's own fix-round-1 comments describe
      // in full) and get QUEUED, flushing only on the map's next `"idle"` or its 4000ms fallback.
      // Separately, and specifically for the FIRST of this test's 3 loop iterations: instrumented
      // directly (`browser.newContext()` in a loop, no Playwright test wrapper), the very FIRST
      // page a freshly-LAUNCHED browser process ever navigates measured 20.9s here versus ~1.1s
      // for the 2nd-5th (same browser, fresh contexts) -- a real, large, one-time browser-process
      // warm-up cost this repo's own docs/performance.md separately documents for the FIRST state
      // `scripts/verify.mjs` opens in a fresh browser (smaller-scale echo of the same thing). This
      // test already takes the MEDIAN of 3 samples specifically so ONE slow outlier cannot fail
      // the BUDGET assertion below -- but only if this poll's own ceiling does not throw first.
      // 30s keeps this poll's safety net from being the artificial bottleneck for that one-time
      // cost, per this file's own stated design intent; the actual gate (BUDGET_MS on the median)
      // is unchanged and still the only pass/fail criterion that matters for the timing claim.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const map = (window as unknown as { __atlasMap: AtlasMapForSpecies }).__atlasMap
                .handle.map;
              return !!map.getLayer("species-raster") && map.isSourceLoaded("species-raster");
            }),
          { message: "the species raster layer/source never loaded", timeout: 30_000 },
        )
        .toBe(true);
      const pixel = await page.evaluate(() => {
        const map = (window as unknown as { __atlasMap: AtlasMapForSpecies }).__atlasMap.handle.map;
        const canvas = map.getCanvas();
        const gl = (canvas.getContext("webgl2") ??
          canvas.getContext("webgl")) as WebGLRenderingContext | null;
        if (!gl) return null;
        const dpr = canvas.width / canvas.clientWidth;
        const c = map.getCenter();
        const p = map.project([c.lng, c.lat]);
        const px = new Uint8Array(4);
        gl.readPixels(
          Math.round(p.x * dpr),
          Math.round(canvas.height - p.y * dpr),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          px,
        );
        return [px[0], px[1], px[2]];
      });
      expect(pixel).toEqual(BLENDED_RASTER_RGB);

      const elapsedMs = Date.now() - start;
      samples.push(elapsedMs);
      console.log(`species lens cold first-pixel run ${run}/${RUNS}: ${elapsedMs} ms`);

      // plan D3 Tier 0 / the atlas-5 gate, checked EVERY run — structural, not aspirational (every
      // .wasm byte is aborted by blockWasm() inside gotoSpecies; this also proves the app never
      // even TRIED to fetch one), and load-proof regardless of how the timing budget lands.
      expect(requests.filter((u) => /\.wasm(\?|$)/.test(u))).toEqual([]);
      expect(requests.filter((u) => /duckdb/i.test(u))).toEqual([]);
      expect(errors).toEqual([]);

      // the species title/card actually rendered the resolved taxon, not a placeholder
      await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");

      await context.close();
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `species lens cold first-pixel samples: ${samples.join(", ")} ms; median: ${median} ms`,
    );

    // The gate: the MEDIAN of N >= 3 cold runs, never a single sample.
    expect(median).toBeLessThanOrEqual(BUDGET_MS);
  });
});
