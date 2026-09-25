// R3 (round-2 plan §5 U4, `docs/usability.md` §7 R3): end-to-end proof of the layer stack against a
// REAL rendered map — `tests/map/layerStack.test.ts`/`tests/map/style.test.ts` already cover the
// model/composeStyle rules at the unit level; this is the "does moving/hiding/dimming a group
// actually repaint the map, and does it survive a reload" proof, the same shape
// `e2e/scores.outlines.spec.ts` uses for `out=`.
//
// M11 fix (Opus 5.5 review): this header used to claim an ORDER-level proof "on basemap-labels
// specifically" that did not exist — the actual test below moves `basemap-land`, not
// `basemap-labels`, at BOTH the order and pixel level (corrected here).
//
// Pixel-probe note: this harness's fixture basemap (`e2e/map-hermetic.ts`) carries a `background` +
// `water` FILL layer (both classify into `basemap-land`) but no symbol/sprite layer with real glyph
// bytes — `routeGlyphs()` fulfils the font range with an EMPTY body on purpose (a valid "no glyphs
// in this range" answer), so a text layer paints nothing a pixel probe could read. Ben's example
// ("names above a semi-transparent raster") is proven here at BOTH the ORDER level (`map.getStyle()`)
// and the PIXEL level using `basemap-land` instead of `basemap-labels` (the fixture's own solid,
// distinguishable `BASEMAP_RGB` fill) — the SAME mechanism (a basemap group promoted above
// `data-raster`), just probed with a layer type this hermetic harness can actually paint.
//
// M8 fix (Opus 5.5 review): `main`'s default theme is now DARK (`DEFAULT_SEL.theme`), not "auto"
// resolving to paper — `gotoLayersScores` below passes `&theme=light` explicitly so the PAPER
// pixel expectations (`BASEMAP_RGB` from `map-hermetic.ts`, and this file's OWN
// `BLENDED_RASTER_RGB` below) still hold. `gotoScoresWithEcoregion` (the ecoregion describe block
// below) asserts feature counts and layer presence only, never a colour, so it does not need the
// theme pinned.
//
// second merge (main aab5745, U5/U3/the e2e blend fix): `scores-hermetic.ts#BLENDED_RASTER_RGB`
// was redefined to blend against `BASEMAP_RGB_NAVY` (main's own now-dark default theme,
// `species.timing.spec.ts` does the same for its own opacity) -- this file forces `theme=light`
// throughout, so it needs the PAPER blend instead and defines its own local constant, shadowing
// the shared (now navy) one rather than importing it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  BUCKET,
  collectConsoleErrors,
  routeBucket,
  routeSealFixture,
  routeSession,
  safeRoute,
  waitForHydration,
} from "./hermetic";
import { OCEAN_PROBES, bootFor, readPixel, routeZones20 } from "./scores-hermetic";
import { SCORE_RASTER_OPACITY } from "../src/lib/map/layers/raster";
import {
  BASEMAP_RGB,
  RASTER_RGB,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
} from "./map-hermetic";

/** the theme's flat background colour (`src/lib/map/colors.ts#MAP_BACKGROUND_PAPER`) — what shows
 * through once EVERY basemap layer (including `basemap-land`'s opaque water fill) is hidden. Not
 * imported directly (this file stays outside `src/lib/map` on purpose, matching every other e2e
 * fixture's own literal-colour convention, e.g. `map-hermetic.ts#BASEMAP_RGB`). */
const MAP_BACKGROUND_PAPER_RGB = [234, 238, 243];

/** the raster painting at its default `SCORE_RASTER_OPACITY` (0.6) OVER the PAPER basemap fixture
 * colour (`BASEMAP_RGB`) -- this file's own local blend, since `gotoLayersScores` always forces
 * `theme=light` but `scores-hermetic.ts#BLENDED_RASTER_RGB` now blends against the NAVY fixture
 * colour instead (main's own dark-by-default fix; see this file's header). */
const BLENDED_RASTER_RGB = [0, 1, 2].map((i) =>
  Math.round(RASTER_RGB[i] * SCORE_RASTER_OPACITY + BASEMAP_RGB[i] * (1 - SCORE_RASTER_OPACITY)),
);

/** R3: the raster blended over the theme's bare BACKGROUND colour instead of `BASEMAP_RGB` --
 * WebGL alpha-blends a layer against whatever already painted beneath it, so once `basemap-land`
 * itself is hidden (`layers=basemap-land:h`) the raster's own semi-transparent 60% opacity
 * composites against the canvas background, not the (now invisible) water fill. Measured directly
 * (247,171,122), not assumed -- hiding land is NOT a no-op for the raster's own blended pixel, it
 * only means "the raster is still the topmost VISIBLE thing," never "nothing behind it changed." */
const BLENDED_RASTER_OVER_BACKGROUND_RGB = [0, 1, 2].map((i) =>
  Math.round(
    RASTER_RGB[i] * SCORE_RASTER_OPACITY + MAP_BACKGROUND_PAPER_RGB[i] * (1 - SCORE_RASTER_OPACITY),
  ),
);

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

declare global {
  interface Window {
    __atlasMap?: {
      handle: {
        map: {
          isSourceLoaded(id: string): boolean;
          queryRenderedFeatures(opts: { layers: string[] }): unknown[];
          getCanvas(): HTMLCanvasElement;
          project(lngLat: [number, number]): { x: number; y: number };
          loaded(): boolean;
          getLayer(id: string): unknown;
        };
        applyStyle(style: unknown): void;
      };
      composeStyle(input: Record<string, unknown>): unknown;
      inputs(): Record<string, unknown>;
    };
  }
}

/** the fully-ordered default token, spelled out (never a PARTIAL token in these tests — a partial
 * one deliberately reorders via `layerStack.ts`'s own forward-compat "a missing group is inserted
 * at its own default relative position" rule (M2/round 2's fix to `normalizeLayerStack` — it used
 * to bare-append at the array's end, which this comment used to (incorrectly) describe as the
 * rule), tested at the unit level in `tests/map/layerStack.test.ts`; a geometry-asserting e2e test
 * always wants the reorder it names and nothing else). */
const DEFAULT_ORDER = [
  "basemap-land",
  "basemap-bathymetry",
  "basemap-boundaries",
  "basemap-roads",
  "basemap-labels",
  "data-raster",
  "data-zones",
  "data-places",
];

/** `basemap-land` moved from the very bottom to directly ABOVE `data-raster` — everything else
 * keeps its default relative order. This is Ben's "names above a semi-transparent raster" move,
 * substituting the fixture's opaque water fill for a label layer (see this file's own header). */
const LAND_ABOVE_RASTER = [
  "basemap-bathymetry",
  "basemap-boundaries",
  "basemap-roads",
  "basemap-labels",
  "data-raster",
  "basemap-land",
  "data-zones",
  "data-places",
].join(",");

async function gotoLayersScores(page: Page, search: string) {
  await blockWasm(page);
  await routeBucket(page, "v7", bootFor("v7"));
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZones20(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  // M8 fix: explicit `theme=light` -- `main`'s default is now dark, and every pixel expectation in
  // this file assumes the PAPER fixture colours.
  await page.goto(`/?proj=mercator&theme=light${search}`);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"), undefined, {
    timeout: 20_000,
  });
}

/** GPU alpha-blending can round a channel value 1 off from plain CPU `Math.round` arithmetic
 * (measured: an exact .5 tie rounded the opposite way from this file's own math) — a per-channel
 * tolerance is the honest comparison for a blended pixel, the same spirit as
 * `e2e/shell.cls.spec.ts`'s own 0.5px subpixel tolerance. */
function isCloseRgb(
  actual: readonly number[] | null,
  expected: readonly number[],
  tol = 2,
): boolean {
  return !!actual && expected.every((v, i) => Math.abs(actual[i] - v) <= tol);
}

function styleLayerIds(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __atlasMap: { handle: { map: { getStyle(): { layers: { id: string }[] } } } };
      }
    ).__atlasMap.handle.map
      .getStyle()
      .layers.map((l) => l.id),
  );
}

test.describe("layer stack (R3): reorder, dim and reload a REAL composed map", () => {
  test("default stack: every basemap sub-role (incl. labels) sits UNDER the raster in the real style", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    const ids = await styleLayerIds(page);
    expect(ids.indexOf("basemap-water")).toBeLessThan(ids.indexOf("r_lyr"));
    expect(errors).toEqual([]);
  });

  // M4 fix (Opus 5.5 review): this test used to also assert
  // `queryRenderedFeatures({layers:["r_lyr"]}).length >= 0` — VACUOUS (a `.length` is never
  // negative, so this could never fail regardless of what actually rendered). Deleted; the real,
  // non-vacuous proof that the raster is still there (just underneath) is the PIXEL probe in the
  // very next test, and `getLayer("r_lyr")` staying defined is asserted directly where it matters
  // (the eye-toggle test below).
  test("moving basemap-land above data-raster reorders the REAL composed style (map.getStyle())", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, `&layers=${LAND_ABOVE_RASTER}`);
    const ids = await styleLayerIds(page);
    expect(ids.indexOf("basemap-water")).toBeGreaterThan(ids.indexOf("r_lyr"));
    expect(errors).toEqual([]);
  });

  test("...and a pixel probe shows the promoted basemap layer painting OVER the raster", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, `&layers=${LAND_ABOVE_RASTER}`);
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        message: "expected the basemap's own opaque colour once promoted above the raster",
        timeout: 20_000,
      })
      .toBe(BASEMAP_RGB.join(","));
    expect(errors).toEqual([]);
  });

  test("default order (no layers=): the raster's blended colour still reads OVER the basemap, unchanged", async ({
    page,
  }) => {
    await gotoLayersScores(page, "");
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        timeout: 20_000,
      })
      .toBe(BLENDED_RASTER_RGB.join(","));
  });

  // B1 fix (Opus 5.5 review): the "Data" row's opacity SCALES the raster's own spec opacity
  // (`SCORE_RASTER_OPACITY`, 0.6) — it never replaces it. A 35%-opacity slider therefore reads
  // back a 0.6 x 0.35 = 0.21 final raster-opacity, NOT the bare 0.35 a replacing implementation
  // would have produced (this test's own math WAS "RASTER_RGB*0.35 + BASEMAP_RGB*0.65" before this
  // fix — i.e. it used to lock in the B1 bug at the e2e level too).
  test("dimming data-raster to 35% opacity probes a DIFFERENTLY blended pixel than the 60% default (SCALED, not replaced)", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const token = DEFAULT_ORDER.map((id) => (id === "data-raster" ? "data-raster:o35" : id)).join(
      ",",
    );
    await gotoLayersScores(page, `&layers=${token}`);
    const scaledOpacity = SCORE_RASTER_OPACITY * 0.35; // 0.6 x 0.35 = 0.21
    const expected = [0, 1, 2].map(
      (i) => RASTER_RGB[i] * scaledOpacity + BASEMAP_RGB[i] * (1 - scaledOpacity),
    );
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => isCloseRgb(await readPixel(page, lon, lat), expected), {
        message: `expected a pixel near [${expected.join(",")}] (±2/channel)`,
        timeout: 20_000,
      })
      .toBe(true);
    // and it is clearly NOT the unmodified 60% default blend (a wide margin, never itself a
    // rounding-tie question) -- proves the opacity actually moved, not just that SOME blended
    // colour happened to read back.
    expect(isCloseRgb(expected, BLENDED_RASTER_RGB, 2)).toBe(false);
    expect(errors).toEqual([]);
  });

  // review round 2 (re-check of B1): CLOSED at the unit level (`tests/map/style.test.ts`'s "a
  // zone's own INVISIBLE query fill... stays 0 at any data-zones opacity"), but the e2e-level probe
  // was MISSING an in-zone point -- every `OCEAN_PROBES` coordinate lies outside this fixture's 20
  // Program Area polygons (`e2e/fixtures/scores/zones20.geojson`, lon -170..-144, lat 20..40), so
  // the earlier e2e suite could not tell a REAL replacing regression (the B1 bug, resurrected)
  // apart from a probe that simply never touched the query fill at all. -158,-156 x 26,28 is "GAA"
  // (Gulf of America, Eastern) -- its CENTRE, -157/27, is far enough from the 1px boundary line
  // that a probe there can only ever read the invisible query fill (or the raster through it),
  // never the line. In cell mode (the default unit here) there is no visible zone FILL at all, so
  // dimming "Outlines" (data-zones) to 50% must leave the plain raster blend untouched --
  // exactly what a REPLACING implementation would break (0 x 0.5 stays 0 either way for a NUMBER,
  // but a replacing bug turns the invisible placeholder's `fill-opacity: 0` paint key into the
  // stack's own 0.5, painting the near-black QUERY_FILL_COLOR visibly over this pixel instead).
  test("dimming data-zones to 50% opacity, probed INSIDE a real Program Area polygon (GAA's centre), leaves the plain raster blend untouched", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const token = DEFAULT_ORDER.map((id) => (id === "data-zones" ? "data-zones:o50" : id)).join(
      ",",
    );
    await gotoLayersScores(page, `&layers=${token}`);
    const [lon, lat] = [-157, 27]; // GAA's centre, well inside its [-158,-156]x[26,28] rectangle
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        message: `expected the plain 60%-opacity raster blend [${BLENDED_RASTER_RGB.join(",")}] -- a replacing implementation would paint the invisible query fill's colour visibly here instead`,
        timeout: 20_000,
      })
      .toBe(BLENDED_RASTER_RGB.join(","));
    expect(errors).toEqual([]);
  });

  test("layers= round-trips through a reload: the reorder AND the pixel it produces both survive", async ({
    page,
  }) => {
    await gotoLayersScores(page, `&layers=${LAND_ABOVE_RASTER}`);
    expect(page.url()).toContain("layers=");
    await page.reload();
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"), undefined, {
      timeout: 20_000,
    });
    expect(page.url()).toContain("layers=");
    const ids = await styleLayerIds(page);
    expect(ids.indexOf("basemap-water")).toBeGreaterThan(ids.indexOf("r_lyr"));
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        timeout: 20_000,
      })
      .toBe(BASEMAP_RGB.join(","));
  });

  test("Reset layers clears layers= from the URL and restores the default order", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, `&layers=${LAND_ABOVE_RASTER}`);
    expect(page.url()).toContain("layers=");

    await page.getByRole("button", { name: "Reset layers" }).click();

    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain("layers=");
    await expect
      .poll(async () => {
        const ids = await styleLayerIds(page);
        return ids.indexOf("basemap-water") < ids.indexOf("r_lyr");
      })
      .toBe(true);
    expect(errors).toEqual([]);
  });

  // m4 (review round 1): a move that lands its row at the very top/bottom of the stack disables
  // the button just pressed -- a disabled element cannot hold focus, so a keyboard user's focus
  // used to silently revert to <body>, breaking the natural "press again to keep moving" flow.
  // `LayersPanel.svelte#move` now refocuses a real button in the SAME row after the DOM settles
  // (`tick()`): the SAME direction's button when it is still enabled, the OPPOSITE direction's
  // once the row hits the edge. Walks BOTH paths with `.press("Enter")` (a real keyboard
  // activation, not `.click()`) on "Move Place labels UP" -- `basemap-labels` sits at the BOTTOM
  // of the panel's own visible list (every basemap row below it is hidden, D2 fix round below),
  // several presses from its OWN visible ceiling (directly under the pinned "Selection" row).
  //
  // Fix round (Opus 5.5 eyes-on review, D2): this test used to drive "down" -- with the
  // visible-aware move (`moveLayerStackEntryVisible`), Place labels' own DOWN is now disabled
  // FROM THE START (see the dedicated D2 test right after this one), so it can no longer supply
  // a multi-press trip to a boundary. "up" is the one direction Place labels genuinely has more
  // than one legal move in (it hops up past Data, then Outlines, before "Selection"'s own pin
  // blocks a third) -- Selection itself (pinned, boundary on both sides) or Outlines/Data (each
  // only ONE legal move away from a pin in the direction that matters) would each only ever
  // exercise ONE of the two paths this test needs; Place labels' "up" is the one row/direction
  // combination that still walks BOTH "still enabled, same button" (every press but the last)
  // and "now disabled, refocus the other direction" (the last), while checking all three signals
  // the review named: the URL (`layers=` changes), the live region (announces each move), and
  // `document.activeElement` (never reverts to <body>).
  //
  // R3 (round-3 plan, W1 "Layers pane redesign"): this test used to drive "Boundaries" --
  // `LAYER_GROUP_IN_PANEL` now hides that row from the panel entirely (still a full model
  // citizen, just with no row here), so "Place labels" (still listed) replaces it. Driven as a
  // bounded LOOP (never a hand-simulated position count) so the exact number of presses "Place
  // labels" needs can never desync this test from reality.
  //
  // P5 fix (post-merge finding): `LayersPanel.svelte` used to render its own private
  // `.layers-stack [aria-live]` region -- a real SC 4.1.3 regression (the shell's own rule is
  // ONE live region for the whole page, `src/lib/ui/announcer.ts`'s header) that
  // e2e/shell.a11y.spec.ts's "exactly one live region" test caught. This now reads the SAME
  // shared `[role="status"]` region every other announced confirmation in the app uses
  // (e2e/species.smoke.spec.ts's "announces the result count" test, e2e/scores.popup.spec.ts's
  // popup echo) -- `toContainText`, not `toHaveText`: `announce()` appends an alternating
  // zero-width space so two identical announcements in a row still change the region's text.
  test("m4: repeatedly moving a row by keyboard never loses focus to <body>, even once its own button becomes disabled", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    const label = "Place labels";
    const upBtn = page.getByRole("button", {
      name: `Move ${label} up (toward the top of the map)`,
    });
    const downBtn = page.getByRole("button", {
      name: `Move ${label} down (toward the bottom of the map)`,
    });
    const liveRegion = page.locator('[role="status"]').first();
    const activeElementLabel = () =>
      page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);

    await upBtn.focus();
    // first press: still enabled (Place labels' visible ceiling is 2 rows up) -- the "same
    // button keeps focus while it stays enabled" half of the property.
    await upBtn.press("Enter");
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("layers=");
    await expect(liveRegion).toContainText(`${label} moved to position`);
    await expect(upBtn).toBeEnabled();
    await expect
      .poll(activeElementLabel, { timeout: 10_000 })
      .toBe(`Move ${label} up (toward the top of the map)`);

    // keep pressing "up" until the row reaches its own visible ceiling (directly under the
    // pinned Selection row) and its OWN button disables -- bounded at the stack's own size (8) so
    // a real regression (the button never disabling at all) fails loudly instead of looping
    // forever. Never a hand-simulated press count: robust to wherever "Place labels" sits and how
    // many OTHER visible rows a future release adds between it and Selection.
    let presses = 1;
    while ((await upBtn.isEnabled()) && presses < 8) {
      await upBtn.press("Enter");
      presses++;
      await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("layers=");
      await expect(liveRegion).toContainText(`${label} moved to position`);
    }
    expect(presses, "the row never reached its own visible ceiling").toBeLessThan(8);
    // ITS OWN "up" button is now disabled (Selection's pin blocks anything further) -- focus must
    // have moved to "down" instead of silently reverting to <body>.
    await expect(upBtn).toBeDisabled();
    await expect
      .poll(activeElementLabel, { timeout: 10_000 })
      .toBe(`Move ${label} down (toward the bottom of the map)`);
    expect(await downBtn.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(errors).toEqual([]);
  });

  // Fix round (Opus 5.5 eyes-on review, D2): "Place labels' own ↓ is enabled but does nothing
  // visible -- it swaps with a HIDDEN basemap row, the visible order never changes." Read (not
  // guessed) from `layerStack.ts#moveLayerStackEntryVisible`'s own header: Place labels is the
  // BOTTOM-most row the panel ever lists (every basemap row below it is hidden), so it has no
  // visible neighbour to swap with at all -- the fix makes its own "down" button DISABLED on
  // load, the same honest signal `canMoveLayerStackEntry` already gave "Selection" (the review
  // round 2 test right after this one), not a silent no-op click.
  test("D2 fix: Place labels' own ↓ is DISABLED on load (no visible row below it), not a silent no-op click", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    const placeLabelsDown = page.getByRole("button", {
      name: "Move Place labels down (toward the bottom of the map)",
    });
    await expect(placeLabelsDown).toBeDisabled();

    const liveRegion = page.locator('[role="status"]').first();
    const urlBefore = page.url();
    await placeLabelsDown.click({ force: true });
    expect(page.url()).toBe(urlBefore);
    await page.waitForTimeout(500);
    await expect(liveRegion).not.toContainText(/moved to position/);
    expect(errors).toEqual([]);
  });

  // Fix round (Opus 5.5 eyes-on review, D2): the general "hop over hidden entries" proof, driven
  // through a REAL click (not just `tests/map/layerStack.test.ts`'s own unit coverage). The two
  // visible rows that can ever trade places via the move buttons are Place labels (a basemap row,
  // no fixed-order constraint) and Data (`data-raster`'s own relative order vs. Outlines/Selection
  // is FIXED, M7 -- Place labels is the only visible row it can ever swap with at all). This
  // `layers=` token puts a hidden `basemap-roads` row directly BETWEEN Place labels and Data in
  // the model -- moving Place labels UP must hop that hidden row and land beside Data, and the
  // PANEL'S OWN row order changes as a result (not just `layers=`, which the old, non-visible-
  // aware move already changed even while doing nothing a viewer could see -- exactly how D2
  // slipped through in the first place).
  test("D2 fix: clicking a row's move button hops a hidden entry and changes the PANEL'S OWN visible row order (and layers=)", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(
      page,
      "&layers=basemap-land,basemap-bathymetry,basemap-boundaries,basemap-labels,basemap-roads:h,data-raster,data-zones,data-places",
    );
    const rowOrder = () =>
      page
        .locator("[data-row-id]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-row-id")));
    // Place labels still sits BELOW Data in the panel (same relative order the default stack
    // gives them) -- the hidden basemap-roads row is sandwiched between them in the MODEL, but
    // (having no row of its own) invisible to this list either way.
    await expect
      .poll(rowOrder)
      .toEqual(["data-places", "data-zones", "data-raster", "basemap-labels"]);

    const placeLabelsUp = page.getByRole("button", {
      name: "Move Place labels up (toward the top of the map)",
    });
    await expect(placeLabelsUp).toBeEnabled();
    await placeLabelsUp.click();

    // Place labels hopped the hidden basemap-roads row and landed beside its real visible
    // neighbour, Data -- the two visible rows TRADED PLACES in the panel's own DOM order, the
    // exact property the old array-index-only move could silently fail to produce.
    await expect
      .poll(rowOrder)
      .toEqual(["data-places", "data-zones", "basemap-labels", "data-raster"]);
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("layers=");
    expect(errors).toEqual([]);
  });

  // review round 2 (re-check of M7): the PANEL never disabled a rejected move -- at the DEFAULT
  // stack, "Selection"'s (data-places) own DOWN button is nowhere near either array boundary (it
  // sits at arrIndex 7, the very top), so the OLD `arrIndex === 0` check left it enabled even
  // though moveLayerStackEntry's own pin rejects any move starting FROM data-places outright. A
  // click used to fire a phantom "moved to position N" aria-live announcement for a move that
  // changed nothing. Proves BOTH halves: the button is disabled on load (no click needed to find
  // out), and forcing a click through anyway (bypassing the disabled attribute) confirms the
  // underlying model really is a no-op -- the URL never gains `layers=`.
  //
  // P5 fix (post-merge finding): the shared `[role="status"]` region (see the m4 test above's own
  // comment on why this moved off `.layers-stack [aria-live]`) is NOT pristine at page load, and
  // NOT quiescent either -- Shell.svelte's own honeycomb loader announces "Map loading" on mount,
  // then independently "Map ready" once the basemap settles, on its OWN timing unrelated to this
  // click (measured: a before/after snapshot equality check was flaky against exactly that race).
  // "nothing new was announced" is instead proven by the region never carrying THIS action's own
  // wording, not by its text staying byte-identical.
  test("review round 2: Selection's own move buttons are disabled on load, not just at a boundary -- clicking (bypassing disabled) is a genuine no-op", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    const selectionDown = page.getByRole("button", {
      name: "Move Selection down (toward the bottom of the map)",
    });
    const selectionUp = page.getByRole("button", {
      name: "Move Selection up (toward the top of the map)",
    });
    await expect(selectionDown).toBeDisabled();
    await expect(selectionUp).toBeDisabled();

    const liveRegion = page.locator('[role="status"]').first();
    const urlBefore = page.url();
    // force-click through the disabled attribute (Playwright's own escape hatch) -- if
    // moveLayerStackEntry is truly a no-op here, the URL/live-region stay untouched regardless.
    await selectionDown.click({ force: true });
    expect(page.url()).toBe(urlBefore);
    // a real wait, not a poll-until: proving an ABSENCE needs the negative to hold for a while,
    // not just at the first instant checked.
    await page.waitForTimeout(500);
    await expect(liveRegion).not.toContainText(/moved to position/);
    expect(errors).toEqual([]);
  });

  // orchestrator audit item 1: "each row's eye toggle must be gated by an e2e where toggling makes
  // that layer's rendered features disappear" -- the REAL checkbox control (R3: a native checkbox
  // replaced the `Switch`, Ben's "checkbox instead of toggle" -- not a `layers=` URL shortcut),
  // proving the panel's own accessible name wires through to `onChange` -> `composeStyle` -> the
  // map. A PIXEL probe, not `queryRenderedFeatures`: MapLibre's rendered-feature query only returns
  // vector-tile features (fill/line/circle/symbol) -- a `raster` layer has no per-feature geometry
  // to query, so `queryRenderedFeatures({layers:["r_lyr"]})` is always `[]` regardless of whether
  // the raster is painting (measured: the assertion never passed, even generously timed). A
  // blended-vs-basemap-only pixel is the real, visible proof; `getLayer("r_lyr")` staying defined
  // is the CLAUDE.md "never removed" proof.
  test("the Data row's eye toggle hides the raster's PAINTED pixel without removing the layer", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        timeout: 20_000,
      })
      .toBe(BLENDED_RASTER_RGB.join(","));

    await page.getByRole("checkbox", { name: "Data visible on the map" }).click();

    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        message: "expected the plain basemap colour once the Data row was toggled off",
        timeout: 20_000,
      })
      .toBe(BASEMAP_RGB.join(","));
    expect(await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"))).toBe(true);
    expect(errors).toEqual([]);
  });

  // M3 fix (Opus 5.5 review): "only the Data row's eye is pixel-proven" -- the three tests below
  // give the OTHER rows the same real, non-vacuous proof: a rendered-feature-count drop to exactly
  // 0 (never removed -- `getLayer` still resolves), or a pixel handoff to the next thing underneath.
  function zoneFeatureCount(page: Page, layerId = "programarea_ln") {
    return page.evaluate(
      (id) => window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: [id] }).length,
      layerId,
    );
  }

  test("M3: the Outlines row's eye hides programarea_ln's rendered features (>0 -> 0), never removes the layer", async ({
    page,
  }) => {
    // deliberately the DEFAULT `unit=cell` (never `unit=programarea`): `zoneUnitsFromBoot` always
    // draws the outline regardless of the selected spatial unit, and `gotoLayersScores` waits for
    // `r_lyr`, which only exists in cell mode (M5's own motivating issue: `raster: null` in zone
    // mode) -- this test only cares about the outline, so cell mode keeps the helper reusable.
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBeGreaterThan(0);

    await page.getByRole("checkbox", { name: "Outlines visible on the map" }).click();

    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBe(0);
    expect(
      await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("programarea_ln")),
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  test("M3: the Selection row's eye hides the picked cell's selection-line ring (>0 -> 0), never removes the layer", async ({
    page,
  }) => {
    // no collectConsoleErrors()/zero-console-errors assertion here (unlike the other M3 cases in
    // this file): a `sel=cell:` selection mounts ScoresLens.svelte's cell-flower `$effect`
    // (fetches the clicked cell's species composition through the real engine), which this
    // fixture deliberately blocks via `blockWasm()` -- caught by the effect's own `.catch()`
    // (`cellFlowerRows` -> null), but on chromium the underlying blocked fetch ALSO reaches the
    // page as an unhandled "TypeError: Failed to fetch" pageerror, independent of the caught
    // rejection. Same root cause, same convention as `e2e/scores.zonesTableHeader.spec.ts`'s own
    // comment (there it is firefox's "NetworkError..."); that noise is a property of the flower
    // panel's engine call, not of the Selection row's eye toggle this test asserts.
    // a real cell selection, framed on-screen (`queryRenderedFeatures` queries the CURRENT
    // viewport) -- the same cell/camera pair `scripts/verify.mjs`'s own "scores sel=cell:1500000"
    // state already uses, on this exact v7 grid.
    await gotoLayersScores(page, "&sel=cell:1500000&map=-156.375,50.575,8");
    const ringCount = (layerId: string) =>
      page.evaluate(
        (id) => window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: [id] }).length,
        layerId,
      );
    await expect.poll(() => ringCount("selection-line"), { timeout: 20_000 }).toBeGreaterThan(0);

    await page.getByRole("checkbox", { name: "Selection visible on the map" }).click();

    await expect.poll(() => ringCount("selection-line"), { timeout: 20_000 }).toBe(0);
    expect(
      await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("selection-line")),
    ).toBe(true);
  });

  // R3 (Ben, 2026-09-25): "Land & water" no longer has a panel ROW (`layerStack.ts`'s
  // `LAYER_GROUP_IN_PANEL` -- "fine to leave on as default basemap without worrying about layer
  // ordering") -- the group is still a full model citizen (`DEFAULT_LAYER_STACK`, the classifier,
  // `layers=` codec, Reset), so this now drives it the ONE other real way a viewer still can, a
  // `layers=` link, rather than losing the pixel-level proof that hiding basemap-land actually
  // paints through to the theme's plain background. `Data`'s own row IS still in the panel, so that
  // half still uses the real checkbox click (never weakening BOTH halves to a URL shortcut).
  test("M3: hiding basemap-land (layers=) shows the theme's plain background colour through", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "&layers=basemap-land:h,data-raster,data-zones,data-places");
    const [lon, lat] = OCEAN_PROBES[0];
    // the raster still paints on TOP of the hidden basemap fill (proving basemap-land's own hidden
    // state did not accidentally hide anything else) -- but BLENDED against the bare background
    // now, not the water fill (`BLENDED_RASTER_OVER_BACKGROUND_RGB`'s own header: WebGL blends
    // against whatever painted underneath, and land no longer does).
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        timeout: 20_000,
      })
      .toBe(BLENDED_RASTER_OVER_BACKGROUND_RGB.join(","));

    // now also hide the raster, via the real panel checkbox (the Data row IS still in the panel) --
    // with BOTH the raster and the basemap fill hidden, the background shows through.
    await page.getByRole("checkbox", { name: "Data visible on the map" }).click();

    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        message: "expected the theme's plain background colour once Data was also hidden",
        timeout: 20_000,
      })
      .toBe(MAP_BACKGROUND_PAPER_RGB.join(","));
    expect(
      await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("basemap-water")),
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  // Fix round (Ben, 2026-09-25): "dim Selection if there is none to display, otherwise its
  // presence can cause confusion" -- `LayersPanel.svelte`'s `rowState` prop, fed by
  // `isPlacesSelectionEmpty(sel.sel)` (`lib/state/types.ts`, unit-tested in
  // `tests/state/codec.test.ts`). Bare load (no `sel=`) = dimmed; the SAME real
  // `sel=cell:1500000` deep link the row above already proves paints a real selection-line ring =
  // not dimmed. The checkbox itself stays checked/enabled either way (never forced off by
  // emptiness).
  test("R3 fix round: the Selection row is dimmed when nothing is selected, and un-dims once a cell is", async ({
    page,
  }) => {
    await gotoLayersScores(page, "");
    const emptyRow = page.locator('[data-row-id="data-places"]');
    await expect(emptyRow).toHaveClass(/stack-row--dim/);
    await expect(emptyRow).toContainText("nothing selected");
    const emptyCheckbox = page.getByRole("checkbox", { name: "Selection visible on the map" });
    await expect(emptyCheckbox).toBeChecked();
    await expect(emptyCheckbox).toBeEnabled();

    await gotoLayersScores(page, "&sel=cell:1500000&map=-156.375,50.575,8");
    const filledRow = page.locator('[data-row-id="data-places"]');
    await expect(filledRow).not.toHaveClass(/stack-row--dim/);
    await expect(filledRow).not.toContainText("nothing selected");
    await expect(
      page.getByRole("checkbox", { name: "Selection visible on the map" }),
    ).toBeChecked();
  });

  // Fix round (Ben, 2026-09-25): "some extra visual differentiation" between the row expander and
  // the reorder buttons -- proven two ways: the expander's icon path is `chevronRight`'s, never
  // `chevronUp`/`chevronDown` (the reorder buttons' own family), and the reorder buttons carry a
  // hover/focus tooltip the expander does not.
  test("R3 fix round: the Data row's expander and its reorder buttons use DIFFERENT icon glyph families", async ({
    page,
  }) => {
    await gotoLayersScores(page, "");
    const expanderPath = await page
      .getByRole("button", { name: "Data", exact: true })
      .locator("svg path")
      .getAttribute("d");
    const upPath = await page
      .getByRole("button", { name: "Move Data up (toward the top of the map)" })
      .locator("svg path")
      .getAttribute("d");
    const downPath = await page
      .getByRole("button", { name: "Move Data down (toward the bottom of the map)" })
      .locator("svg path")
      .getAttribute("d");
    expect(expanderPath).not.toBe(upPath);
    expect(expanderPath).not.toBe(downPath);
    expect(upPath).not.toBe(downPath);

    const moveUp = page.getByRole("button", {
      name: "Move Data up (toward the top of the map)",
    });
    await expect(moveUp).toHaveAttribute("data-tooltip", "Move up (draw above)");
    await moveUp.focus();
    await expect(moveUp).toHaveCSS("position", "relative");
  });
});

// M6 (review round 1, "short-label test missing"): the manifest's own SHORT metric label
// (`manifest.metrics[]`, `boot.ts#metricLabelsFromManifest`) wins over `boot.layers[].label`'s
// LONG description for the Layer <select>'s OPTION text (R3: `ScoresLens.svelte`'s own
// `metricLabel()`, moved here from `LayersPanel.svelte#layerOptionLabel` when the Layer field
// became a panel-level field) -- unit-tested at the `scoresMapInputs` level in
// `tests/lens/scores/mapInputs.test.ts`; this is the end-to-end proof that the real DOM shows the
// short text in the dropdown and the long text
// as the description underneath, ONCE, never duplicated, and that the description disappears
// entirely when the release publishes no short label of its own (both texts would otherwise be
// identical). `bootFor("v7")`'s own one-layer fixture has no `primprod` row at all, so this block
// builds its own boot (`bootFor("v7")` + one added raw layer) rather than changing that shared
// fixture for every other spec in this file.
test.describe("M6: the Data row's short label wins over the long description, which is hidden when redundant", () => {
  // M6 re-check (round 2): v7's REAL LIVE long label, fetched verbatim from the live
  // v7/app/boot.json (2026-09-24) -- round 1's string was v8's own paraphrase, not what v7
  // actually publishes.
  const PRIMPROD_LONG_LABEL =
    "Primary productivity: Oregon State Vertically Generalized Production Model (VGPM) " +
    "from Visible Infrared Imaging Radiometer Suite (VIIRS) satellite data (mg C / m^2 / day) " +
    "from daily averages available as monthly averaged to annual and averaged to overall for " +
    "the most recently available full years of data 2014 to 2023";
  const PRIMPROD_SHORT_LABEL = "prim prod, 2014-2023 avg (mg C/m^2/day)"; // v7's real manifest.metrics label
  // R3-W7 follow-up: `metricKeyLabel()` now sentence-cases every label it returns (a real v7
  // manifest label that is ITSELF lowercase used to stay lowercase forever) -- the rendered
  // option text is this, not the raw fixture string above.
  const PRIMPROD_SHORT_LABEL_DISPLAY = "Prim prod, 2014-2023 avg (mg C/m^2/day)";

  function bootWithPrimprod() {
    const boot = bootFor("v7") as { layers: unknown[] };
    return {
      ...boot,
      layers: [
        ...boot.layers,
        { metric_key: "primprod", label: PRIMPROD_LONG_LABEL, category: "raw", order: 2 },
      ],
    };
  }

  /** overrides `routeBucket`'s own manifest fixture (`{ver, capabilities: {}}`, no `metrics`) --
   * registered AFTER `routeBucket`, matching the ecoregion describe block's own
   * `routeManifestWithEcoregion` convention (Playwright tries routes in reverse registration
   * order, so this exact-URL route wins). `metrics: null` (the default-fixture case) publishes NO
   * `metrics` key at all, matching a real release manifest that predates short labels. */
  async function routeManifestWithMetrics(
    page: Page,
    ver: string,
    metrics: { metric_key: string; label: string }[] | null,
  ) {
    await page.route(
      `${BUCKET}${ver}/manifest.json`,
      safeRoute((route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ver, capabilities: {}, ...(metrics ? { metrics } : {}) }),
        }),
      ),
    );
  }

  async function gotoLayersScoresPrimprod(
    page: Page,
    metrics: { metric_key: string; label: string }[] | null,
  ) {
    await blockWasm(page);
    await routeBucket(page, "v7", bootWithPrimprod());
    await routeManifestWithMetrics(page, "v7", metrics);
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeZones20(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    await page.goto("/?proj=mercator&theme=light&lyr=primprod");
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    // no "open the Layers tool" click here -- the "Layer" <select> is now a panel-LEVEL field
    // (R3: promoted out of the Data row's own body, `src/lib/ui/LayersPanel.svelte`'s
    // `layerField`), always visible whenever the Layers tool is open, regardless of the Data row's
    // own expanded/collapsed state.
  }

  test("no manifest.metrics published: the option text falls back to the long label, and the description is HIDDEN (identical text, not repeated)", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScoresPrimprod(page, null);
    await expect(
      page.getByRole("option", { name: PRIMPROD_LONG_LABEL, exact: true }),
    ).toBeAttached();
    await expect(page.getByTestId("layer-description")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("manifest.metrics publishes a short label: the option shows the SHORT text, and the long text still shows ONCE as the description", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScoresPrimprod(page, [{ metric_key: "primprod", label: PRIMPROD_SHORT_LABEL }]);
    await expect(
      page.getByRole("option", { name: PRIMPROD_SHORT_LABEL_DISPLAY, exact: true }),
    ).toBeAttached();
    await expect(page.getByRole("option", { name: PRIMPROD_LONG_LABEL, exact: true })).toHaveCount(
      0,
    );
    const description = page.getByTestId("layer-description");
    await expect(description).toHaveCount(1);
    await expect(description).toHaveText(PRIMPROD_LONG_LABEL);
    expect(errors).toEqual([]);
  });
});

// orchestrator audit item 2: the standalone ecoregion outline (black, 3px --
// `layers/zones.ts#ZONE_LINE_STYLE.ecoregion`, unchanged) drawn on every scores view, read from the
// release's MANIFEST (`boot.ts#ecoregionZoneUnitFromManifest`), independent of `sel.unit`/`sel.out`.
// `e2e/scores.outlines.spec.ts`'s own manifest fixture never publishes `zones`, so this is a
// SEPARATE describe block with its own manifest override rather than a change to that file.
test.describe("ecoregion boundaries (orchestrator audit item 2): the manifest-published outline", () => {
  const ECOREGION_PMTILES_PATH = fileURLToPath(
    new URL("./fixtures/scores/ecoregion4.pmtiles", import.meta.url),
  );
  const ECOREGION_PMTILES_URL = `${BUCKET}zones/ecoregion_2025-06/zones.pmtiles`;

  async function routeEcoregionPmtiles(page: Page) {
    const file = readFileSync(ECOREGION_PMTILES_PATH);
    await page.route(
      ECOREGION_PMTILES_URL,
      safeRoute((route) => {
        const range = route.request().headers()["range"];
        const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
        if (!m) {
          return route.fulfill({
            status: 200,
            contentType: "application/octet-stream",
            headers: { "accept-ranges": "bytes", "access-control-allow-origin": "*" },
            body: file,
          });
        }
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : file.length - 1;
        return route.fulfill({
          status: 206,
          contentType: "application/octet-stream",
          headers: {
            "accept-ranges": "bytes",
            "content-range": `bytes ${start}-${end}/${file.length}`,
            "access-control-allow-origin": "*",
          },
          body: file.subarray(start, end + 1),
        });
      }),
    );
  }

  /** overrides `routeBucket`'s own manifest fixture (`{ver, capabilities: {}}`, no `zones`) with
   * one that also publishes `zones[]` -- registered AFTER `routeBucket`, so this exact-URL route
   * wins (Playwright tries routes in reverse registration order). */
  async function routeManifestWithEcoregion(page: Page, ver: string) {
    await page.route(
      `${BUCKET}${ver}/manifest.json`,
      safeRoute((route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ver,
            capabilities: {},
            zones: [{ fld: "ecoregion_key", pmtiles: ECOREGION_PMTILES_URL }],
          }),
        }),
      ),
    );
  }

  async function gotoScoresWithEcoregion(page: Page, search: string) {
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeManifestWithEcoregion(page, "v7");
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeZones20(page);
    await routeEcoregionPmtiles(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    await page.goto(`/?proj=mercator${search}`);
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  }

  test("ecoregion_ln renders >= 1 feature on v7 (the release's manifest publishes it)", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoScoresWithEcoregion(page, "");
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("ecoregion_ln"), {
      timeout: 20_000,
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: ["ecoregion_ln"] })
              .length,
        ),
      )
      .toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("out=none (hides the SELECTABLE unit's outline) does NOT hide the ecoregion boundary -- it is decoration, not the selected unit", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoScoresWithEcoregion(page, "&out=none");
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("ecoregion_ln"), {
      timeout: 20_000,
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: ["ecoregion_ln"] })
              .length,
        ),
      )
      .toBeGreaterThan(0);
    // and out=none DID hide the programarea outline, same as e2e/scores.outlines.spec.ts's own
    // case -- proving the two are independent, not that out= stopped working.
    expect(
      await page.evaluate(() =>
        window.__atlasMap!.handle.map.queryRenderedFeatures({ layers: ["programarea_ln"] }),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a manifest with no ecoregion row (this repo's OTHER scores fixtures): no ecoregion_ln layer at all", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeZones20(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    await page.goto("/?proj=mercator");
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"), undefined, {
      timeout: 20_000,
    });
    expect(
      await page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("ecoregion_ln")),
    ).toBe(false);
  });
});

// P round deliverable 1 (Ben, live-review of 0.10.62, 2026-09-24): "emphasize Raster Cells vs
// Program Areas as a toggle similar to Scores vs Species at top, but this only applies to Scores
// (so grayed out for Species)" + "the toggles add too much yellow emphasis across whole panel...
// use a quiet on/off style". The Species half (disabled + reason) is
// `e2e/species.smoke.spec.ts`'s own P-round describe block.
test.describe("P round deliverable 1: the Layers panel's spatial-unit toggle (scores lens)", () => {
  test("switching Raster cells -> Program areas writes unit= and moves the pressed segment (the seeded fault: it stops writing the unit)", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    const group = page.getByRole("group", { name: "Spatial units" });
    const cellBtn = group.getByRole("button", { name: "Raster cells" });
    const paBtn = group.getByRole("button", { name: "Program areas" });
    await expect(cellBtn).toHaveAttribute("aria-pressed", "true");
    await expect(paBtn).toHaveAttribute("aria-pressed", "false");
    expect(page.url()).not.toContain("unit=");

    await paBtn.click();

    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("unit=programarea");
    await expect(paBtn).toHaveAttribute("aria-pressed", "true");
    await expect(cellBtn).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });

  // Ben: "the toggles add too much yellow emphasis across whole panel" -- the P round's own fix
  // was `--border-control` (a "quiet" track FILL colour on the old Switch, distinct from a real
  // selected/active control). R3 replaced the Switch with a plain checkbox; the first fix round
  // (orchestrator hand-off, Opus UI review of main, 2026-09-25) had moved every such control to
  // `accent-color: var(--fill-accent)` (gold, matching the toggle's own pressed segment) so an
  // unstyled native checkbox/radio/range would never fall back to the browser's own default blue
  // on the paper theme. Round 2 (Ben, same day, live review of THAT fix): "use a more muted
  // non-yellow checkbox" -- gold read as 5 simultaneous "selected/important" rows in a stack list,
  // which is exactly the "too much yellow emphasis" complaint this whole rule exists to avoid; the
  // stack-row/Sphere/"Cells outside Program Areas" checkboxes moved to `--border-control` (the
  // SAME muted "steel" token the row's own border already uses), while a real selected/active
  // control (the toggle's pressed segment, the Outline radios) keeps the gold accent. This test
  // asserts BOTH halves of that rule: a real, explicit accent-color is set (never the browser's
  // own unstyled default), and it is the MUTED token, not gold.
  test("the layer stack's ON checkboxes set a real, MUTED accent-color (never the browser's own unstyled default, never gold)", async ({
    page,
  }) => {
    await gotoLayersScores(page, "");
    const dataCheckbox = page.getByRole("checkbox", { name: "Data visible on the map" });
    const dataCheckboxAccent = await dataCheckbox.evaluate(
      (el) => getComputedStyle(el).accentColor,
    );
    expect(
      dataCheckboxAccent,
      "the Data row's checkbox has no explicit accent-color set (falls back to the browser's own default)",
    ).not.toBe("auto");
    // a direct token-value comparison is brittle across themes; instead assert against the
    // BORDER color, which this same rule ties the checkbox's accent to 1:1 ("the SAME token the
    // row's own border already uses" -- see the fix round's own comment on `.visible-check`) --
    // and is, by construction, never the gold `--fill-accent` the toggle's active segment uses.
    const rowBorder = await page
      .locator('[data-row-id="data-raster"]')
      .evaluate((el) => getComputedStyle(el).borderColor);
    expect(
      dataCheckboxAccent,
      `checkbox accent-color (${dataCheckboxAccent}) does not match the row's own muted border color (${rowBorder}) -- expected the same --border-control token`,
    ).toBe(rowBorder);
  });

  // P3 fix (Opus eyes-on review, 2026-09-24, desktop-04): the panel's own `display: flex;
  // flex-direction: column` body stretches `.seg`'s outer box to the panel's full width
  // (`align-items: stretch`, column-flex's default), but the two segments themselves kept their
  // own content width (no `flex-grow`) -- measured live, ~283 of the pill's own 1245px filled,
  // the rest a dead, unclickable band. RED-FIRST: fails on the pre-fix tree, where the "Program
  // areas" segment's own right edge sits nowhere near the group's.
  //
  // R3-CI (2026-09-25): NO LONGER the `segmented-flex-fill-dropped` seeded fault's own gate --
  // R3's redesign gave this toggle `Segmented`'s new `fit` prop, which sets `align-self:
  // flex-start` on `.seg` itself (`Segmented.svelte`). That cancels the PARENT's `align-items:
  // stretch` for this element specifically, so `.seg`'s own outer box is now always exactly as
  // wide as its (unstretched) content -- the precondition this assertion needs (a parent forcing
  // `.seg` WIDER than its buttons) no longer holds here, so removing `.seg button`'s `flex: 1 1
  // 0%` no longer changes what this test measures (confirmed directly: reapplying the fault by
  // hand and reprobing this exact group still showed its buttons' combined width matching the
  // group's own, because BOTH shrink to the same content size together). Kept as a plain layout
  // regression test for this toggle's own geometry; `"the Table view switch..."` below (same
  // `Segmented` component, `fit` omitted, still parent-stretched) is the fault's new gate.
  test("the two segments fill the pill's own width -- no dead space past the last segment", async ({
    page,
  }) => {
    await gotoLayersScores(page, "");
    const group = page.getByRole("group", { name: "Spatial units" });
    const groupBox = (await group.boundingBox())!;
    const cellBox = (await group.getByRole("button", { name: "Raster cells" }).boundingBox())!;
    const paBox = (await group.getByRole("button", { name: "Program areas" }).boundingBox())!;

    // within 2px of the pill's own left edge -- `.seg`'s own 1px border sits between the group's
    // outer boundingBox and the first button's, so an exact match is never quite right.
    expect(
      cellBox.x,
      `the first segment (x=${cellBox.x}) does not start at the pill's own left edge (x=${groupBox.x})`,
    ).toBeGreaterThanOrEqual(groupBox.x - 0.5);
    expect(
      cellBox.x,
      `the first segment (x=${cellBox.x}) does not start at the pill's own left edge (x=${groupBox.x})`,
    ).toBeLessThanOrEqual(groupBox.x + 2);
    expect(
      paBox.x + paBox.width,
      `the last segment's own right edge (${paBox.x + paBox.width}) falls well short of the ` +
        `pill's own right edge (${groupBox.x + groupBox.width}) -- dead space in the pill`,
    ).toBeGreaterThanOrEqual(groupBox.x + groupBox.width - 1);
  });

  // R3-CI (CI run 36158947685): `segmented-flex-fill-dropped`'s own real gate, replacing "the two
  // segments fill the pill's own width" above (that one's own header explains why it stopped
  // depending on `.seg button`'s `flex: 1 1 0%` rule once the Spatial-units toggle got `fit`).
  // `TablePanel.svelte`'s "Table view" switch (Species | Zones | Composition) is the OTHER
  // `Segmented` caller `Segmented.svelte`'s own `fit` prop doc names as still using the
  // P-round stretched look (`fit` omitted): its wrapping `.table-panel` is the SAME
  // `display: flex; flex-direction: column` shape that stretches `.seg`'s outer box wider than
  // its content, so a missing `flex: 1 1 0%` on `.seg button` still leaves real dead space here.
  // Measured directly (fault reapplied by hand): group 346px wide, the three segments' combined
  // width landing ~130px short of the group's own right edge.
  test("the Table view switch's segments fill the pill's own width -- no dead space past the last segment", async ({
    page,
  }) => {
    await gotoLayersScores(page, "");
    await page.getByRole("button", { name: "Table", exact: true }).click();
    const group = page.getByRole("group", { name: "Table view" });
    await expect(group).toBeVisible({ timeout: 10_000 });
    const groupBox = (await group.boundingBox())!;
    const firstBox = (await group.getByRole("button", { name: "Species" }).boundingBox())!;
    const lastBox = (await group.getByRole("button", { name: "Composition" }).boundingBox())!;

    expect(
      firstBox.x,
      `the first segment (x=${firstBox.x}) does not start at the pill's own left edge (x=${groupBox.x})`,
    ).toBeGreaterThanOrEqual(groupBox.x - 0.5);
    expect(
      firstBox.x,
      `the first segment (x=${firstBox.x}) does not start at the pill's own left edge (x=${groupBox.x})`,
    ).toBeLessThanOrEqual(groupBox.x + 2);
    expect(
      lastBox.x + lastBox.width,
      `the last segment's own right edge (${lastBox.x + lastBox.width}) falls well short of the ` +
        `pill's own right edge (${groupBox.x + groupBox.width}) -- dead space in the pill`,
    ).toBeGreaterThanOrEqual(groupBox.x + groupBox.width - 1);
  });
});

// R3 (round-3 plan, W1 "Layers pane redesign", Ben 2026-09-25): the new controls the redesign
// added -- the per-row opacity popover, the ramp picker, the Zone-outlines radio -- and the one
// invariant hiding three basemap rows from the pane must not break (a `layers=` token naming one
// still parses and applies).
test.describe("R3: Layers-pane redesign", () => {
  test("hidden rows (Land & water, Boundaries, Roads & buildings, Bathymetry) are absent from the pane, but a layers= token naming one still parses and applies", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "&layers=basemap-land:h,data-raster,data-zones,data-places");
    // absent from the pane -- no row, no checkbox, whatever the URL says. Bathymetry too
    // (orchestrator hand-off, 2026-09-25: "do NOT ship the 'Bathymetry — coming soon' stub row").
    for (const label of ["Land & water", "Boundaries", "Roads & buildings", "Bathymetry"]) {
      await expect(page.getByRole("checkbox", { name: `${label} visible on the map` })).toHaveCount(
        0,
      );
      await expect(page.locator(".stack-list")).not.toContainText(label);
    }
    // and the token still APPLIED (basemap-land really is hidden, not silently ignored) -- the
    // raster still paints on top of it, blended against the bare background (same proof
    // `M3: hiding basemap-land` above uses, and the same reason its own constant exists).
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        timeout: 20_000,
      })
      .toBe(BLENDED_RASTER_OVER_BACKGROUND_RGB.join(","));
    // the still-listed rows are unaffected.
    for (const label of ["Data", "Outlines", "Selection", "Place labels"]) {
      await expect(page.getByRole("checkbox", { name: `${label} visible on the map` })).toHaveCount(
        1,
      );
    }
    expect(errors).toEqual([]);
  });

  // Fix round (Opus 5.5 eyes-on review, D7): rewritten for the checkbox shape -- there is no
  // longer a radio group ("the radio is not a choice" if the ecoregion line draws regardless; it
  // does, read from `boot.ts#ecoregionZoneUnitFromManifest`'s own header, so the panel now shows
  // it as a fixed fact, not a live control). The Program Areas checkbox is the one REAL toggle.
  test("the Outlines row's Program Areas checkbox writes out= to the URL; Ecoregions is a fixed, always-on fact", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    expect(page.url()).not.toContain("out=");

    await page.getByRole("button", { name: "Outlines", exact: true }).click();
    const programAreas = page.getByRole("checkbox", { name: "Program Areas", exact: false });
    await expect(programAreas).toBeVisible();
    await expect(programAreas).toBeChecked(); // scores' own default (defaultOut()) is "programarea"

    const ecoregions = page.getByRole("checkbox", { name: "Ecoregions", exact: false });
    await expect(ecoregions).toBeChecked();
    await expect(ecoregions).toBeDisabled();

    await programAreas.click(); // uncheck -- the only real move this row offers

    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("out=none");
    await expect(programAreas).not.toBeChecked();
    // unchanged either way -- it is not wired to sel.out at all, by design (D7's own finding).
    await expect(ecoregions).toBeChecked();
    await expect(ecoregions).toBeDisabled();

    await programAreas.click(); // re-check -- back to the default, so out= drops from the URL
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain("out=");
    expect(errors).toEqual([]);
  });

  test("the ramp picker changes pal= (and the trigger's own strip updates)", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    expect(page.url()).not.toContain("pal=");

    await page.getByRole("button", { name: /^Color palette:/ }).click();
    const listbox = page.getByRole("listbox", { name: "Color palette" });
    await expect(listbox).toBeVisible();
    const viridisOption = page.getByRole("option", { name: "Viridis" });
    await viridisOption.click();

    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("pal=viridis");
    // the popover closes on selection, and the trigger's own accessible name now names Viridis.
    await expect(listbox).toBeHidden();
    await expect(page.getByRole("button", { name: "Color palette: Viridis" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  // CLAUDE.md's pixel rule (Round-2 lesson): "Pixel gates must first prove the layer painted" --
  // this reads the UNCHANGED 60%-default blend FIRST (the control point), then drives the real
  // popover UI (not a `layers=` URL shortcut) and re-reads the SAME pixel, proving the slider's
  // own `oninput` wiring reaches `composeStyle` -> the map, the same property
  // `e2e/layers.spec.ts`'s own B1 test proves for the `layers=` shortcut.
  test("the Data row's opacity popover scales the raster's painted pixel (SCALED, not replaced)", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoLayersScores(page, "");
    const [lon, lat] = OCEAN_PROBES[0];
    await expect
      .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
        timeout: 20_000,
      })
      .toBe(BLENDED_RASTER_RGB.join(","));

    await page.getByRole("button", { name: "Data opacity" }).click();
    const range = page.getByRole("slider", { name: "Data opacity" });
    await expect(range).toBeVisible();
    await range.evaluate((el: HTMLInputElement) => {
      el.value = "0.35";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const scaledOpacity = SCORE_RASTER_OPACITY * 0.35;
    const expected = [0, 1, 2].map(
      (i) => RASTER_RGB[i] * scaledOpacity + BASEMAP_RGB[i] * (1 - scaledOpacity),
    );
    await expect
      .poll(async () => isCloseRgb(await readPixel(page, lon, lat), expected), {
        message: `expected a pixel near [${expected.join(",")}] (±2/channel)`,
        timeout: 20_000,
      })
      .toBe(true);
    expect(isCloseRgb(expected, BLENDED_RASTER_RGB, 2)).toBe(false);
    expect(errors).toEqual([]);
  });
});
