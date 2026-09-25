// atlas-4 step 1's gate: "the first-paint spec with **/*.wasm blocked: raster pixels at two ocean
// probe points, 20 Program-Area outlines, legend, default flower." Fully hermetic — every
// cross-origin request is routed to a fixture (docs/map.md's convention, `e2e/hermetic.ts`), and
// the zones PMTiles archive is a SEPARATE 20-feature fixture built for this spec (`e2e/fixtures/
// scores/zones20.{geojson,pmtiles}`) rather than the shared 4-feature one `e2e/map-hermetic.ts`
// already serves other specs, so this never contends with atlas-map's or another lens' fixture.
//
// atlas-4 fix round 2: runs this whole suite on BOTH v7 (public, the plain case) and v9 (the real
// release that broke the flower — `extrisk_primary_producer_ecoregion_rescaled` AND
// `primprod_ecoregion_rescaled` both published, folding onto one "primprod" category; see
// `src/lens/scores/flower.ts`'s `dedupeFlowerComponents`). v9 is `restricted` in
// `e2e/hermetic.ts`'s `VERSIONS_FIXTURE` (matching the live registry), so viewing it here needs a
// preview session — same as `e2e/species-hermetic.ts`'s `gotoSpecies` already does for the species
// lens, and for the same reason (measured: a public, no-session load of v9 is correctly DENIED by
// plan D6's access gate and renders nothing at all).
//
// 0.10.21: the v7/v9 boot-fixture apparatus and the `gotoScoresMap`/`readPixel`/`OCEAN_PROBES`/
// `BLENDED_RASTER_RGB` helpers moved to `./scores-hermetic` so `e2e/scores.collapsed-panel.spec.ts`
// (fix 1's own RED-first regression gate) can reuse them rather than copy-pasting.
import { expect, test } from "@playwright/test";
import { collectConsoleErrors, collectRequests } from "./hermetic";
import {
  BLENDED_RASTER_RGB,
  gotoScoresMap,
  OCEAN_PROBES,
  readPixel,
  type Ver,
} from "./scores-hermetic";

// atlas-8 step 2: widened from chromium-only to all three engines (measured green on all three).
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

/** the default flower's expected rounded hub value for each version -- v7's real 8-component
 * `flower_default.FULL` mean (atlas-4 fix round 2's own fixture, `./scores-hermetic`), v9's real
 * 8-entry `flower_default.AK` de-duplicated down to 7 before averaging. */
const EXPECTED_DEFAULT_HUB: Record<Ver, string> = {
  v7: "24", // (45.6671707107685+10.4494142116047+15.9570514927416+14.7345085163167+41.668393775248+15.1784428369187+38.8176408891894+10.3787489146688)/8 = 24.106... -> 24
  v9: "22", // 7 kept of 8 (bare "primprod" dropped): mean ~= 21.705 -> 22
};

/** the default (composite) layer's own `label` in each version's `bootFor()` fixture
 * (`./scores-hermetic`) -- the floating legend's title (`ScoresLegend.svelte`/`mapInputs.ts`'s
 * `scoresMapInputs().legend`). */
const EXPECTED_LEGEND_TITLE: Record<Ver, string> = {
  v7: "Overall score",
  v9: "Equal-weight composite",
};

for (const ver of ["v7", "v9"] as const) {
  test.describe(`scores lens — first paint with **/*.wasm blocked (atlas-4 step 1 gate), ${ver}`, () => {
    test("paints the score raster at two ocean probe points", async ({ page }) => {
      // two probes at up to 40s of polling each (below) can exceed Playwright's 30s default test
      // timeout on its own, independent of whether either poll actually needs the time -- widen
      // the TEST's own budget so a slow-but-still-passing poll is never truncated by the wrong
      // timer.
      test.setTimeout(90_000);
      const errors = collectConsoleErrors(page);
      const requests = collectRequests(page);
      await gotoScoresMap(page, ver);
      await page.waitForFunction(() => window.__atlasMap!.handle.map.loaded(), undefined, {
        timeout: 20_000,
      });

      // atlas-8 fix round 1 (root cause, replaces an earlier narrow Firefox-only skip that only
      // papered over the symptom): ScoresLens.svelte's OWN `$effect` computes the real raster
      // from `boot.layers` and applies it via Shell's composed-style effect -- exactly like
      // e2e/map.spec.ts's manually-injected raster, this call can land while
      // `map.isStyleLoaded()` is still false (the map's TRUE initial style, not yet settled) and
      // get QUEUED (`src/lib/map/styleQueue.ts`), flushing only on the next `"idle"` or its 4000ms
      // fallback. `map.loaded()` above says nothing about whether that queue has flushed yet --
      // reproduced on Firefox AND (once, under load) WebKit as a 40s pixel-poll timeout with the
      // BASEMAP colour still showing, i.e. the layer never having been added at all. Waiting for
      // the real layer to exist first (generous timeout, comfortably past the queue's fallback)
      // proves the queue has flushed before the pixel probe -- the fix is waiting on the right
      // signal, not a longer/looser pixel poll.
      await page.waitForFunction(
        () => !!window.__atlasMap!.handle.map.getLayer("r_lyr"),
        undefined,
        {
          timeout: 20_000,
        },
      );

      for (const [lon, lat] of OCEAN_PROBES) {
        await expect
          .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
            message: `no score raster pixel painted at ${lon},${lat}`,
            // atlas-8 step 2 (widened to all three engines): 20s was enough for v7 and for v9 run
            // ALONE, but the v9 case measured a reproducible timeout on Firefox specifically when
            // it runs as the 5th WebGL-heavy test in this file's own serial sequence (v7's four
            // tests, then v9's) -- Firefox's own GL-context teardown between successive test
            // pages is slower to settle than Chromium's/WebKit's here. 40s is the generous,
            // never-the-thing-that-fails number (tests/perf.ts's own PERF_TIMEOUT_MS philosophy);
            // the assertion itself is unchanged.
            timeout: 40_000,
          })
          .toBe(BLENDED_RASTER_RGB.join(","));
      }

      expect(requests.filter((u) => /\.wasm(\?|$)/.test(u))).toEqual([]);
      expect(requests.filter((u) => /duckdb/i.test(u))).toEqual([]);
      expect(errors).toEqual([]);
    });

    test("renders 20 Program-Area outlines", async ({ page }) => {
      await gotoScoresMap(page, ver);
      await expect
        .poll(
          () =>
            // the `getLayer` guard before `isSourceLoaded`: see e2e/map.spec.ts's
            // `zoneFeatureCount` header (0.10.14) -- `isSourceLoaded` on a source the style does
            // not currently hold fires a MapLibre ErrorEvent straight into `console.error`.
            page.evaluate(() => {
              const map = window.__atlasMap!.handle.map;
              if (!map.getLayer("programarea_ln")) return -1;
              if (!map.isSourceLoaded("programarea_src")) return -1;
              return map.queryRenderedFeatures({ layers: ["programarea_ln"] }).length;
            }),
          { timeout: 20_000 },
        )
        .toBeGreaterThanOrEqual(20);
    });

    test("shows the FLOATING legend, with the layer title and exactly two rescale endpoints", async ({
      page,
    }) => {
      // atlas-4 defect fix: the scores lens used to have NO floating legend at all (only an
      // in-panel copy, visible only while the Layers tool happened to be open) -- clicking a
      // DIFFERENT tool first proves this no longer matters.
      await gotoScoresMap(page, ver);
      await page.getByRole("button", { name: "Flower plot" }).click();
      const legend = page.locator('[data-testid="scores-legend"]');
      await expect(legend).toBeVisible({ timeout: 10_000 });
      await expect(legend.locator("h2")).toHaveText(EXPECTED_LEGEND_TITLE[ver]);
      // the OTHER defect fix, pinned end-to-end here too: two endpoint labels, never one per stop.
      await expect(legend.locator(".ramp-ticks span")).toHaveCount(2);
      await expect(legend.locator(".ramp-ticks")).toContainText("0");
      await expect(legend.locator(".ramp-ticks")).toContainText("90");
    });

    test("shows the default flower (nothing selected, Tier 0 only)", async ({ page }) => {
      await gotoScoresMap(page, ver);
      await page.getByRole("button", { name: "Flower plot" }).click();
      const flower = page.locator(".flower-title");
      // UI-4/UI-5 (round-3 review): "All US waters" -- the SAME no-selection subject the
      // Zoom-to-region select uses, replacing this panel's own "Full study area" wording.
      await expect(flower).toHaveText("All US waters", { timeout: 10_000 });
      // v7: mean of the real 8 fixture components (`flower_default.FULL`). v9:
      // `flower_default.AK`'s real 8 entries, de-duplicated to 7 (the "primprod"/"primary
      // producer" collision `dedupeFlowerComponents` resolves) — proving the fix end-to-end, not
      // just at the unit level.
      await expect(page.locator(".hub-text")).toHaveText(EXPECTED_DEFAULT_HUB[ver]);
    });
  });
}

test.describe("atlas-4 defect fix: the scores/species floating legend is ONE slot, keyed on sel.lens", () => {
  test("switching from Scores to Species swaps the floating legend (spec.md: one legend on screen at a time)", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    const scoresLegend = page.locator('[data-testid="scores-legend"]');
    await expect(scoresLegend).toBeVisible({ timeout: 10_000 });

    await page.locator(".topbar").getByRole("button", { name: "Species" }).click();
    await expect(scoresLegend).toHaveCount(0);
  });
});

// 0.10.20 — the basemap-never-paints gate. `composeStyle()` is synchronous and reads the already
// resolved CARTO style; until 0.10.19 NOTHING told the app when that style had landed, so a
// style.json arriving after the last reactive recompose was never read again and the basemap never
// appeared AT ALL — not late, never, for the life of the page. That is the app-level cause of this
// file's own intermittent Firefox red (1 of 40 repeats of the raster probe above, at load ~11): the
// probe read `247,171,122` — the score raster at 0.6 over the theme's flat `--surface-map` colour —
// instead of `153,117,86`, the same raster over the basemap. Contention broke nothing; it only made
// the CARTO fetch lose a race it was never guaranteed to win.
//
// Delaying the style.json makes that deterministic, and it is a real user's slow connection rather
// than a synthetic hook: the assertion is the SAME pixel the gate above asserts, at the SAME
// tolerance. Fix: `layers/basemap.ts#warmBasemapStyles` (the invalidation that was missing) plus
// `map/styleQueue.ts`'s settle cycle (which is what makes the extra recompose safe to issue).
// Seeded fault: `tests/faults/basemap-not-reactive.patch`.
const SLOW_BASEMAP_MS = 3_000;

test.describe("0.10.20: a SLOW CARTO style.json still ends up painting the basemap", () => {
  test("the score raster paints OVER the basemap even when style.json answers late", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await gotoScoresMap(page, "v7", { basemapDelayMs: SLOW_BASEMAP_MS });
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"), undefined, {
      timeout: 25_000,
    });
    // generous, and never the thing that fails: the style.json is held for SLOW_BASEMAP_MS and the
    // recompose it then triggers costs at most one more settle cycle (styleQueue's 4 s bound).
    await expect
      .poll(async () => (await readPixel(page, ...OCEAN_PROBES[0]))?.slice(0, 3).join(","), {
        message:
          `the basemap never entered the composed style: the probe still reads the score raster ` +
          `over the flat --surface-map colour. CARTO's style.json resolved ${SLOW_BASEMAP_MS}ms ` +
          `after load and nothing recomposed — see layers/basemap.ts#warmBasemapStyles.`,
        timeout: 40_000,
      })
      .toBe(BLENDED_RASTER_RGB.join(","));
  });
});
