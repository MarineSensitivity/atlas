// atlas-5: the species lens, on the REAL shell, fully hermetic — the same convention e2e/map.spec.ts
// already uses (routeBucket + map-hermetic's tile/wasm helpers). Fixtures are the REAL trimmed
// bundles already committed for the data-layer tests (tests/fixtures/species/**, see its README),
// reused here through page.route rather than re-typed.
//
// atlas-8 step 2: widened to all three engines (chromium/webkit/firefox all measured green here);
// kept serial for the same WebGL-contention reason e2e/map.spec.ts documents.
//
// atlas-8: the COLD-load first-paint TIMING gate that used to live here moved to
// e2e/species.timing.spec.ts, its own Playwright project (a timing gate must run alone, gated on
// the median of N >= 3 cold runs, never a single sample — a parallel engine matrix's contention
// makes a single sample meaningless: measured 1,578-1,621ms alone vs 3,065ms inside the full run).
// Shared fixtures/helpers now live in e2e/species-hermetic.ts so the two files never duplicate them.
import { expect, test } from "@playwright/test";
import {
  BUCKET,
  collectRequests,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";
import { blockWasm, routeGlyphs, routeTitilerTiles, routeZonesPmtiles } from "./map-hermetic";
import {
  LEATHERBACK_SP,
  WALRUS_AM_MDL_KEY,
  WRYBILL_SP,
  bootFor,
  gotoSpecies,
  routeSpeciesShards,
} from "./species-hermetic";

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

    const sourceUrl = () =>
      page.evaluate(() => {
        const style = (
          window as unknown as {
            __atlasMap: { handle: { map: { getStyle(): { sources: Record<string, unknown> } } } };
          }
        ).__atlasMap.handle.map.getStyle();
        const source = style.sources["species-raster"] as { tiles?: string[] } | undefined;
        return source?.tiles?.[0] ?? null;
      });

    // atlas-8 fix round 1 (root cause, instrumented -- repeated with --workers=1 --repeat-each=6,
    // reproduced 5/6 on WebKit): `isSourceLoaded("species-raster")` above went TRUE the moment
    // ANY style with that source id finished loading -- which can be leatherback's OWN (the
    // FIRST, url-driven) style, not walrus's. Walrus's own `applyStyle` call is exactly the one
    // `styleQueue.ts` describes queuing (`map.isStyleLoaded()` still false, this early): it only
    // flushes on the map's next `"idle"` or its `DEFAULT_STYLE_FALLBACK_MS` (4000ms) fallback,
    // WHICHEVER COMES FIRST. The old assertion checked "a species-raster source is loaded" once
    // and then read the URL a single time with no further wait -- so on whichever engine's timing
    // let leatherback's OWN load finish first, the check passed on THAT source, before the queue
    // had flushed walrus's at all. The fix is not a longer wait before one read; it is polling the
    // URL itself, so the assertion only succeeds once the QUEUE has actually flushed the write it
    // is testing for -- covering the 4000ms fallback with margin.
    await expect
      .poll(sourceUrl, { message: "species-raster source URL", timeout: 10_000 })
      .toContain("WORMS_137077");
    // walrus's merged COG (ms_merge_WORMS_137077.tif), never leatherback's stranded first request
    expect(await sourceUrl()).not.toContain("WORMS_137209");
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

    // atlas-8 fix round 1 (same root cause as e2e/map.spec.ts's "paints a raster" test, see its
    // own comment): this manually injects a "range" via a raw `handle.applyStyle` call, which
    // races the species lens' OWN mount-driven effect (its card/mapInputs settling asynchronously
    // and re-applying Shell's composed style without this test's injected range) -- reproduced
    // under full-suite WebGL contention (multiple parallel specs' software-GL rendering), not
    // deterministically per engine. Self-healing: re-inject on every poll iteration so whichever
    // injection is temporally last (this test's) is the one that survives.
    const injectRange = (url: string) =>
      page.evaluate((rangeUrl) => {
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
              pmtiles: rangeUrl,
              sourceLayer: "programarea",
              keyProperty: "programarea_key",
              key: "GAA",
              fillColor: "#3388ff",
              opacity: 0.5,
            },
          }),
        );
      }, url);

    await injectRange(RANGE_URL);

    await expect
      .poll(
        async () => {
          await injectRange(RANGE_URL); // re-assert: cheap, idempotent once settled
          return page.evaluate(() => {
            const map = (
              window as unknown as {
                __atlasMap: {
                  handle: {
                    map: {
                      getLayer(id: string): unknown;
                      isSourceLoaded(id: string): boolean;
                      queryRenderedFeatures(opts: { layers: string[] }): unknown[];
                    };
                  };
                };
              }
            ).__atlasMap.handle.map;
            // `getLayer` first: see e2e/map.spec.ts's `zoneFeatureCount` header (0.10.14) --
            // `isSourceLoaded` on an absent source fires a MapLibre ErrorEvent into console.error.
            if (!map.getLayer("species-range")) return -1;
            if (!map.isSourceLoaded("species-range")) return -1;
            return map.queryRenderedFeatures({ layers: ["species-range"] }).length;
          });
        },
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
    //
    // atlas-map basemap fix: the basemap's style.json/tiles.json/sprite are `composeStyle`'s OWN
    // (synchronous) cache read, never awaited inline — hanging those would just leave the basemap
    // un-warmed (harmless: composeStyle falls back to the plain background colour) and never
    // reproduce the "still loading" condition this test wants. `routeBucket()` (below) resolves
    // that chain normally via its own `routeMapTileOrigins()`; only the basemap's actual VECTOR
    // TILE is hung here, the vector analogue of the old "hang the raster PNG" trick — MapLibre
    // still requests it internally AFTER the style is applied, so `isStyleLoaded()` stays false
    // exactly as before.
    await blockWasm(page);
    await routeBucket(page, "v9", bootFor("v9"));
    await routeSpeciesShards(page);
    await routeSession(page, { preview: true, ver: "v9" });
    await routeSealFixture(page);
    await routeGlyphs(page);
    await page.route(
      (url) => /\/vectortiles\/carto\.streets\/v1\//.test(url.pathname),
      () => {
        /* never resolves — simulates a hung tile request */
      },
    );
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
    browserName,
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
    // WebKit's default Tab sequence skips non-text form controls (checkboxes included) unless
    // "Full Keyboard Access" is on -- the same platform default e2e/shell.a11y.spec.ts:189
    // documents for buttons; its equivalent key is Option+Tab, Playwright's "Alt+Tab" here.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(page.locator(".us-only input[type='checkbox']")).toBeFocused();
  });
});

test.describe("fix list #8 (SC 4.1.2 + 1.3.1): the species picker is a real combobox", () => {
  // the field used to be a plain `<input type=\"search\">`: focusing it opened a `role=\"listbox\"`
  // beneath it, but the input carried no `role=\"combobox\"`, no `aria-expanded`, no
  // `aria-controls`/`aria-activedescendant` and no `aria-autocomplete` -- nothing announced that a
  // list appeared, Arrow Down did not move through the options, and Esc did not close the list.
  // REVERTED (this fix alone) -> RED: every assertion below fails (the attributes are simply
  // absent, and Arrow/Enter/Esc do nothing).
  test("role=combobox, aria-expanded/controls/activedescendant track the open list, and Enter selects the active option", async ({
    page,
  }) => {
    // an explicit sp= (leatherback), not the bare lens switch other tests in this describe use --
    // this test's own assertion needs a KNOWN starting species so the identity change Enter
    // produces is unambiguous, and it must not race the lens' own default-species resolution
    // (which only settles once the taxa index itself has loaded, asynchronously).
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    const input = page.locator(".picker-input");
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(await input.getAttribute("aria-expanded")).toBe("false");
    expect(await input.getAttribute("aria-controls")).toBeNull();
    expect(await input.getAttribute("aria-activedescendant")).toBeNull();

    await input.focus();
    await expect
      .poll(() => page.locator(".picker-option").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect(await input.getAttribute("aria-expanded")).toBe("true");

    const listId = await input.getAttribute("aria-controls");
    expect(listId).toBeTruthy();
    await expect(page.locator(`#${listId}`)).toHaveCount(1);
    await expect(page.locator(`#${listId}`)).toHaveAttribute("role", "listbox");

    // the first real option is highlighted as soon as the list opens (the APG "first match"
    // convention), and the id it points at actually exists and IS that option.
    const firstOptionId = await input.getAttribute("aria-activedescendant");
    expect(firstOptionId).toBeTruthy();
    // an attribute selector, not a bare `#id` -- a taxon key (and so the option id built from it)
    // contains "|" and ":", both special in a bare CSS id selector; quoted inside `[id="..."]`
    // they are just literal characters.
    const firstOption = page.locator(`[id="${firstOptionId}"]`);
    await expect(firstOption).toHaveCount(1);
    await expect(firstOption).toHaveAttribute("role", "option");
    // options never receive individual keyboard focus (the preferred APG variant: they stay out
    // of the Tab order, tabindex="-1", the input drives navigation).
    await expect(firstOption).toHaveAttribute("tabindex", "-1");

    // typing re-anchors aria-activedescendant to the NEW first match -- filtered to "walrus" so
    // the match is deterministic AND fixture-backed (this spec's routeSpeciesShards only mocks
    // leatherback/walrus/wrybill; ArrowDown-ing to an arbitrary OTHER real taxon in the unfiltered
    // list would 404 its shard and leave the title blank forever, which is what the very first
    // version of this test measured).
    await input.pressSequentially("walrus", { delay: 20 });
    await expect
      .poll(() => input.getAttribute("aria-activedescendant"), { timeout: 10_000 })
      .not.toBe(firstOptionId);
    const walrusOptionId = await input.getAttribute("aria-activedescendant");
    expect(walrusOptionId).toBeTruthy();
    const walrusOption = page.locator(`[id="${walrusOptionId}"]`);
    await expect(walrusOption).toContainText(/walrus/i);
    await expect(input).toBeFocused();

    await page.keyboard.press("Enter");
    // Enter picks the ACTIVE option and closes the list.
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus", {
      timeout: 10_000,
    });
  });

  test("Esc closes the list without moving focus off the field", async ({ page }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    const input = page.locator(".picker-input");
    await input.focus();
    await expect
      .poll(() => page.locator(".picker-option").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await expect(input).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".picker-dropdown")).toHaveCount(0);
    await expect(input).toBeFocused();
  });

  test("typing a query announces the result count through the shared live region", async ({
    page,
  }) => {
    await gotoSpecies(page, "/?lens=species&ver=v9");
    const input = page.locator(".picker-input");
    await input.focus();
    await expect
      .poll(() => page.locator(".picker-option").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);

    const live = page.locator('[role="status"]').first();
    await input.pressSequentially("walrus", { delay: 20 });
    // createSearchLogger's own debounce is 900ms; give it real margin.
    await expect(live).toContainText(/result.* for "walrus"/, { timeout: 3_000 });
  });
});

// 0.10.22: the species first-paint regression, made deterministic. On 0.10.20/0.10.21 the shell's
// basemap-arrival recompose opened a `styleQueue.ts` settle cycle that ended only on `"idle"`, and
// the species raster's style (composed a few ms later, when the taxon shard resolved) was PARKED
// behind it — for the whole species camera flight and every loading tile (+528..+1,899 ms after the
// shard, instrumented), the ~1 s bimodal regression in `e2e/species.timing.spec.ts`. Here the
// basemap's vector tiles never answer, so the map can NEVER go idle once the basemap is in the
// style, and the shard is released only after it is: a queue that waits for idle parks the raster
// until its 4 s fallback; one that settles on the in-flight style's own `"style.load"` issues it at
// once. Both ends are timed IN THE PAGE (the shard's resource-timing `responseEnd`, and the
// `"style.load"` whose style first holds the raster layer), so neither the harness's own polling
// nor the route hand-off is part of the number. Seeded fault: `tests/faults/style-settle-on-idle.patch`.
const RASTER_AFTER_SHARD_BUDGET_MS = 1_500;
type GateWindow = {
  __atlasMap?: {
    handle: {
      map: {
        getStyle(): { layers: { id: string }[] } | undefined;
        getLayer(id: string): unknown;
        on(event: "style.load", cb: () => void): unknown;
      };
    };
  };
  __gate?: { released?: number; raster?: number };
};
test.describe("0.10.22: the species raster's style is issued when its shard lands, not when the map next goes idle", () => {
  test("with the map unable to go idle (basemap tiles hung), the raster layer is in the style within 1.5 s of the shard", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await blockWasm(page);
    await routeBucket(page, "v9", bootFor("v9"));
    await routeSpeciesShards(page);
    await routeSession(page, { preview: true, ver: "v9" });
    await routeSealFixture(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    // registered AFTER routeBucket's basemap chain, so it wins: every CARTO vector tile hangs, and
    // MapLibre never reports the basemap source loaded -> `"idle"` never fires again.
    await page.route(
      (url) => /\/vectortiles\/carto\.streets\/v1\//.test(url.pathname),
      () => {
        /* never resolves */
      },
    );
    // the taxon shard is held until the basemap is IN the composed style (the order the measured
    // slow loads had), then handed on to routeSpeciesShards' fixture via `fallback()`.
    let released = false;
    await page.route(
      (url) => url.href.startsWith(BUCKET) && url.href.includes("/app/taxon/"),
      async (route) => {
        await page.waitForFunction(
          () =>
            !!(window as unknown as GateWindow).__atlasMap?.handle.map
              .getStyle()
              ?.layers.some((l) => l.id.startsWith("basemap-")),
          undefined,
          { timeout: 30_000 },
        );
        await page.evaluate(() => {
          const w = window as unknown as GateWindow;
          const map = w.__atlasMap!.handle.map;
          w.__gate = { released: performance.now() };
          map.on("style.load", () => {
            if (w.__gate!.raster === undefined && map.getLayer("species-raster"))
              w.__gate!.raster = performance.now();
          });
        });
        released = true;
        await route.fallback();
      },
    );
    await page.goto(`/?sp=${LEATHERBACK_SP}&ver=v9`);
    await waitForHydration(page);

    await page.waitForFunction(
      () => (window as unknown as GateWindow).__gate?.raster !== undefined,
      undefined,
      { timeout: 30_000 },
    );
    expect(released, "the taxon shard was never requested").toBe(true);
    const { shardAt, rasterAt } = await page.evaluate(() => {
      const w = window as unknown as GateWindow;
      const entry = performance
        .getEntriesByType("resource")
        .find((e) => e.name.includes("/app/taxon/")) as PerformanceResourceTiming | undefined;
      // `responseEnd` excludes the route hand-off; an engine that records no entry for a routed
      // request falls back to the (earlier, so stricter) moment the route released it.
      return { shardAt: entry?.responseEnd || w.__gate!.released!, rasterAt: w.__gate!.raster! };
    });
    const afterShardMs = Math.round(rasterAt - shardAt);
    expect(
      afterShardMs,
      `the species raster reached the style ${afterShardMs} ms after its shard: it was parked ` +
        `behind the basemap's setStyle until the map went idle (or the 4 s fallback). An issued ` +
        `style must settle on its own "style.load" -- see src/lib/map/styleQueue.ts (0.10.22).`,
    ).toBeLessThan(RASTER_AFTER_SHARD_BUDGET_MS);
  });
});
