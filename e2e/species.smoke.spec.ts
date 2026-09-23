// atlas-5: the species lens, on the REAL shell, fully hermetic — the same convention e2e/map.spec.ts
// already uses (routeBucket + map-hermetic's tile/wasm helpers). Fixtures are the REAL trimmed
// bundles already committed for the data-layer tests (tests/fixtures/species/**, see its README),
// reused here through page.route rather than re-typed.
//
// Chromium only, serial: this suite drives the same WebGL map e2e/map.spec.ts does (S2's numbers
// were only ever measured on headless Chromium/swiftshader — see that file's own header).
//
// atlas-8: the COLD-load first-paint TIMING gate that used to live here moved to
// e2e/species.timing.spec.ts, its own Playwright project (a timing gate must run alone, gated on
// the median of N >= 3 cold runs, never a single sample — a parallel engine matrix's contention
// makes a single sample meaningless: measured 1,578-1,621ms alone vs 3,065ms inside the full run).
// Shared fixtures/helpers now live in e2e/species-hermetic.ts so the two files never duplicate them.
import { expect, test } from "@playwright/test";
import {
  collectRequests,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";
import { blockWasm, routeGlyphs, routeZonesPmtiles } from "./map-hermetic";
import {
  type AtlasMapForSpecies,
  LEATHERBACK_SP,
  WALRUS_AM_MDL_KEY,
  WRYBILL_SP,
  bootFor,
  gotoSpecies,
  routeSpeciesShards,
} from "./species-hermetic";

test.skip(({ browserName }) => browserName !== "chromium", "WebGL gate: chromium only (S2)");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

test.describe("species lens, first paint with **/*.wasm blocked", () => {
  test("switching species twice before the map's first idle leaves the SECOND species' raster in sources (fix round 1)", async ({
    page,
  }) => {
    // the exact race styleQueue.ts's unit regression test covers in isolation: two applyStyle
    // calls queued while the map's true initial style is still loading. Driven here through the
    // REAL app (window.__atlasSpecies.selectSpecies, exactly what the picker does) rather than a
    // fake, so a regression in the WIRING (not just the queue itself) would also show up here.
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await page.evaluate((walrusKey) => {
      (
        window as unknown as { __atlasSpecies: { selectSpecies: (k: string) => void } }
      ).__atlasSpecies.selectSpecies(walrusKey);
    }, "ms_merge|WORMS:137077");

    await expect
      .poll(() => page.getByTestId("species-title-sci").textContent(), { timeout: 10_000 })
      .toBe("Odobenus rosmarus");
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = (window as unknown as { __atlasMap: AtlasMapForSpecies }).__atlasMap.handle
              .map;
            return !!map.getLayer("species-raster") && map.isSourceLoaded("species-raster");
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    const sourceUrl = await page.evaluate(() => {
      const style = (
        window as unknown as {
          __atlasMap: { handle: { map: { getStyle(): { sources: Record<string, unknown> } } } };
        }
      ).__atlasMap.handle.map.getStyle();
      const source = style.sources["species-raster"] as { tiles?: string[] } | undefined;
      return source?.tiles?.[0] ?? null;
    });
    // walrus's merged COG (ms_merge_WORMS_137077.tif), never leatherback's stranded first request
    expect(sourceUrl).toContain("WORMS_137077");
    expect(sourceUrl).not.toContain("WORMS_137209");
  });

  test("an AquaX 'Delivered' (native) tile URL carries rescale=0,1000 (the AquaX gate)", async ({
    page,
  }) => {
    const requests = collectRequests(page);
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&in=ax&rep=native&ver=v9`);
    await expect
      .poll(() => requests.some((u) => u.includes("titiler-v8") && u.includes("rescale=0,1000")), {
        message: "no titiler request carried rescale=0,1000 for the AquaX Delivered layer",
        timeout: 10_000,
      })
      .toBe(true);
  });

  test("a struck-through pill is not focusable-as-button and carries the reason as its title", async ({
    page,
  }) => {
    // v7 walrus (mdl_seq 54383): both inputs publish zero assets — every pill besides the merged
    // one is struck-through.
    await gotoSpecies(page, "/?mdl_seq=54383&ver=v7", "v7");
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    const unavailable = page.locator('[data-testid="layer-pill"].unavailable').first();
    await expect(unavailable).toBeVisible();
    expect(await unavailable.evaluate((el) => el.tagName)).toBe("SPAN");
    expect(await unavailable.getAttribute("tabindex")).toBeNull();
    const title = await unavailable.getAttribute("title");
    expect(title).toContain("feeds the merged model");
    expect(title).toContain("nothing to draw");
  });

  test("fix round 3 #1: ticking 'US only' on a non-US selection falls back to the default (keeps a shared one)", async ({
    page,
  }) => {
    // wrybill (valid_usa: false) loaded directly, US-only OFF (?us=0) so the checkbox starts
    // unticked and wrybill is legitimately on screen. Ticking it must fall back to the default
    // (§13.1's trap; the pure rule is data/picker.ts's `keepSelection`, already unit-tested —
    // this pins the SVELTE WIRING that calls it, which a pure unit test cannot).
    await gotoSpecies(page, `/?sp=${WRYBILL_SP}&us=0&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Anarhynchus frontalis");

    // the picker index must be loaded before the checkbox's fallback logic has anything to
    // compute against (SpeciesPicker.svelte's toggleUsOnly no-ops without it) — focusing the
    // search field is what triggers that fetch in the real app.
    await page.locator(".picker-input").focus();
    await expect
      .poll(() => page.locator(".picker-option").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);

    const usOnly = page.locator(".us-only input[type='checkbox']");
    await expect(usOnly).not.toBeChecked();
    await usOnly.check();

    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");

    // a species IN BOTH lists (leatherback) must survive the SAME toggle, in either direction.
    await usOnly.uncheck();
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");
    await usOnly.check();
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");
  });

  test("?mdl_seq=<int> on v7 lands on the right taxon and input (the merged model)", async ({
    page,
  }) => {
    await gotoSpecies(page, "/?mdl_seq=54383&ver=v7", "v7");
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");
    // the URL is rewritten to sp= (canonical), mdl_seq dropped
    await expect.poll(() => page.url()).toContain("sp=54383");
    expect(page.url()).not.toContain("mdl_seq");
  });

  test("?mdl_key=am|... on v9 lands on the right taxon AND selects that input", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?mdl_key=${WALRUS_AM_MDL_KEY}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");
    await expect.poll(() => page.url()).toContain("sp=ms_merge");
    await expect.poll(() => page.url()).toContain("in=am");
    // the layer bar shows the INPUT variant (orange/is-input), not the merged one — the "no
    // merged-surface flash" guard (§11.12) means this must already be true at first render.
    await expect(page.locator(".layer-bar.is-input")).toHaveCount(1);
  });

  test("a range draws >= 1 rendered feature (the PMTiles branch, real vector data)", async ({
    page,
  }) => {
    // reuses atlas-map's own committed archive (e2e/fixtures/map/zones.pmtiles, a REAL 7 KB
    // tippecanoe build with working HTTP range support — building a fresh one-polygon archive
    // just for this gate would just re-prove tippecanoe works) under a species RANGE-style
    // filter: layer "programarea", key property "programarea_key", a real feature's key ("GAA").
    // This exercises the real `map/layers/ranges.ts` builders + composeStyle's "range" field
    // through REAL MapLibre vector-tile parsing — the same technique e2e/map.spec.ts's own
    // "renders a VECTOR feature" test uses for zones.
    const RANGE_URL = "https://file.marinesensitivity.org/pmtiles/v9/e2e-range-fixture.pmtiles";
    await routeZonesPmtiles(page, RANGE_URL);
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await page.waitForFunction(() => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap);

    await page.evaluate((url) => {
      const api = (
        window as unknown as {
          __atlasMap: {
            handle: { applyStyle(s: unknown): void };
            composeStyle: (i: unknown) => unknown;
            inputs: () => Record<string, unknown>;
          };
        }
      ).__atlasMap;
      api.handle.applyStyle(
        api.composeStyle({
          ...api.inputs(),
          range: {
            id: "species-range",
            pmtiles: url,
            sourceLayer: "programarea",
            keyProperty: "programarea_key",
            key: "GAA",
            fillColor: "#3388ff",
            opacity: 0.5,
          },
        }),
      );
    }, RANGE_URL);

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = (
              window as unknown as {
                __atlasMap: {
                  handle: {
                    map: {
                      isSourceLoaded(id: string): boolean;
                      queryRenderedFeatures(opts: { layers: string[] }): unknown[];
                    };
                  };
                };
              }
            ).__atlasMap.handle.map;
            if (!map.isSourceLoaded("species-range")) return -1;
            return map.queryRenderedFeatures({ layers: ["species-range"] }).length;
          }),
        {
          message: 'source/layer "species-range" never rendered a vector feature',
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0);
  });

  test("fix round 3 #4: a hung titiler tile does not strand a species switch forever (the bounded fallback)", async ({
    page,
  }) => {
    // EVERY tile (basemap AND titiler) NEVER responds (no fulfill/abort/continue), from
    // construction onward — the map's true INITIAL style transition itself never completes, so
    // `isStyleLoaded()` stays false and `"idle"` never fires even once (mirroring
    // `styleQueue.ts`'s unit fallback test's FakeMap, whose `isStyleLoaded()` is pinned `false`
    // throughout). Hanging ONLY the species raster's own tile was NOT enough, measured: MapLibre's
    // `isStyleLoaded()` settles once the basemap's own (unrelated) tiles load, independent of a
    // LATER raster's hung one, so the DIRECT `apply()` path fired every time regardless of the
    // fix. Composed by hand, not via `gotoSpecies`, since that helper's own tile routes (real
    // PNGs) would win if registered after these.
    await blockWasm(page);
    await routeBucket(page, "v9", bootFor("v9"));
    await routeSpeciesShards(page);
    await routeSession(page, { preview: true, ver: "v9" });
    await routeSealFixture(page);
    await routeGlyphs(page);
    await page.route("https://basemaps.cartocdn.com/**", () => {
      /* never resolves — simulates a hung tile request */
    });
    await page.route("https://titiler-v8.marinesensitivity.org/**", () => {
      /* never resolves — simulates a hung tile request */
    });
    await page.goto(`/?sp=${LEATHERBACK_SP}&ver=v9`);
    await waitForHydration(page);

    await expect
      .poll(() => page.getByTestId("species-title-sci").textContent(), { timeout: 10_000 })
      .toBe("Dermochelys coriacea");

    // switch species WHILE the first raster's tile is still (forever) hung.
    await page.evaluate((walrusKey) => {
      (
        window as unknown as { __atlasSpecies: { selectSpecies: (k: string) => void } }
      ).__atlasSpecies.selectSpecies(walrusKey);
    }, "ms_merge|WORMS:137077");
    await expect
      .poll(() => page.getByTestId("species-title-sci").textContent(), { timeout: 10_000 })
      .toBe("Odobenus rosmarus");

    // the default fallback bound is 4000 ms (styleQueue.ts's DEFAULT_STYLE_FALLBACK_MS) — poll
    // well past it. `isSourceLoaded` would never become true (the tile is hung by design), so the
    // assertion is on the SOURCE appearing in the style, matching the unit test's own contract.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const style = (
              window as unknown as {
                __atlasMap: {
                  handle: { map: { getStyle(): { sources: Record<string, unknown> } } };
                };
              }
            ).__atlasMap.handle.map.getStyle();
            const source = style.sources["species-raster"] as { tiles?: string[] } | undefined;
            return source?.tiles?.[0] ?? null;
          }),
        {
          message: "the walrus raster source never appeared — the hung-tile fallback did not fire",
          timeout: 8_000,
        },
      )
      .toContain("WORMS_137077");
  });
});

test.describe("atlas-4/5 defect fix: the topbar search field no longer overflows (the 'US only' switch)", () => {
  test("the search field stays at its designed (closed) height, with no descendant overflowing it", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    const field = page.locator('[data-control="search"]');
    const fieldBox = (await field.boundingBox())!;
    // the fault this pins: "Only species in US waters" used to be a static third row inside this
    // fixed-height pill, which grew (and visually overflowed) the field on every load, whether or
    // not the picker had ever been opened -- so this checks the CLOSED state, before any focus.
    expect(fieldBox.height).toBeLessThanOrEqual(36); // shell.css's `.search-field { height: 32px }` + slack
    const descendantBoxes = await field.locator("*").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, tag: el.tagName };
      }),
    );
    for (const box of descendantBoxes) {
      expect(box.top).toBeGreaterThanOrEqual(fieldBox.y - 0.5);
      expect(box.bottom).toBeLessThanOrEqual(fieldBox.y + fieldBox.height + 0.5);
    }
  });

  test("the 'US only' switch is reachable by keyboard from the field, inside the opened dropdown", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    const input = page.locator(".picker-input");
    await input.focus();
    // the picker's taxa index loads asynchronously (fetched on first focus) -- wait for the
    // dropdown to actually be open, same as e2e/species.smoke.spec.ts's other us-only test above.
    await expect
      .poll(() => page.locator(".picker-option").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await expect(page.locator(".us-only input[type='checkbox']")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(".us-only input[type='checkbox']")).toBeFocused();
  });
});
