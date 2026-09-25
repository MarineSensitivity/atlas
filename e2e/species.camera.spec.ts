// D8 (Opus 5.5 eyes-on assessment, 2026-09-24, atlas-refs/"2026-09-24 eyes-on UI assessment
// (Opus 5.5) on 15d6e4c.md"): "?lens=species&mdl_seq=54383 (walrus) the range is a sliver on the
// globe's limb ... 95% of the frame is empty continent." Two real, distinct causes, fixed
// separately in src/lens/species/data/camera.ts + state.svelte.ts:
//
//   1. v9's `am` walrus input (`WALRUS_AM_MDL_KEY`, `am|ITS-Mam-180639`) publishes `bbox: null` on
//      itself AND on `card.merged`, while the SAME taxon's `ax` sibling carries a real one
//      (`tests/fixtures/species/v9/taxon/75.json`) — `cameraFor()`'s new "sibling" step fixes this
//      with NO network call at all.
//   2. v7's walrus (`mdl_seq=54383`) publishes NO bbox anywhere (every asset's `bbox` is null,
//      `assets: []`) — `state.svelte.ts#refineCameraFromCogBounds` asks titiler's own `/cog/info`
//      (NOT `/cog/bounds`, which 404s live on titiler-v8 — verified; see `src/lib/raster/bounds.ts`'s
//      own header) for the drawn COG's extent as the true last resort. The real walrus v7 COG's own
//      `/cog/info` bounds are a degenerate whole-360-degree-longitude span
//      (`[-180, 53.15, 180, 73.75]`), so this test also exercises `narrowLongitude`'s point-probe
//      narrowing (real value: only lon -170 holds data), not just a plain pass-through bbox.
import { expect, test, type Page, type Route } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { blockWasm, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { WALRUS_AM_MDL_KEY, bootFor, gotoSpecies, routeSpeciesShards } from "./species-hermetic";

test.use({ viewport: { width: 1280, height: 800 } });

interface CameraState {
  center: { lng: number; lat: number };
  zoom: number;
}

async function readCamera(page: Page): Promise<CameraState> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __atlasMap: {
        handle: { map: { getCenter(): { lng: number; lat: number }; getZoom(): number } };
      };
    };
    const map = w.__atlasMap.handle.map;
    return { center: map.getCenter(), zoom: map.getZoom() };
  });
}

// the release's own default/study-area camera (FALLBACK_FULL_STUDY_AREA / boot.study_areas[FULL]
// on this fixture — the exact camera the eyes-on review's "95% of the frame is empty continent"
// describes staying parked at).
// V4 fix (owner phone report, 2026-09-24): lowered from 3 to 2.3. `map.ts#flyToBounds` now asks
// MapLibre's OWN `cameraForBounds()` for the fit (projection-aware — see that file's own header),
// which settles on a measurably LOWER zoom than the old hand-rolled flat-Mercator math did for
// these two fixtures' bbox/viewport combinations (walrus desktop: 2.84 native vs previously > 3;
// v9 am/ax-sibling desktop: 2.54 native) — a real, deterministic characteristic of the new fit, not
// a flake (reproduced identically across repeated runs). 2.3 keeps a comfortable margin above the
// study-area default's own 2.16 (still proves a species-specific fit ran) while sitting below every
// native fit measured so far.
const STUDY_AREA_ZOOM_CEILING = 2.3;

/** the walrus v7 COG's own `/cog/info` + `/cog/point` narrowing mocks, shared by both v7 tests
 * below (the initial species-change effect AND `zoomToLayer()`'s own follow-up) — factored out so
 * the two don't drift on what "the real walrus COG answers" means. */
async function routeWalrusCogBoundsFallback(page: Page) {
  await page.route(
    (url) => url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname === "/cog/info",
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        // the real walrus v7 merged COG's own /cog/info answer — a degenerate whole-360-degree
        // longitude span (bounds.ts's own header has the live verification), which the fix must
        // NOT hand straight to the camera (that would frame the whole globe's width).
        body: JSON.stringify({ bounds: [-180, 53.15, 180, 73.75] }),
      }),
  );
  await page.route(
    (url) =>
      url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname.startsWith("/cog/point/"),
    (route: Route) => {
      // only -170 (the real walrus data's own longitude, measured live) answers with a value —
      // every other CANDIDATE_LONS probe must come first in the module's own list and answer
      // null, exactly like the real walrus was measured to.
      const hit = route.request().url().includes("/cog/point/-170,");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ values: [hit ? 91 : null] }),
      });
    },
  );
}

test.describe("D8: selecting a model frames its extent, not the default study area", () => {
  test("v9 `am` walrus (no bbox of its own) frames off its `ax` sibling's extent (no network call needed)", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?mdl_key=${WALRUS_AM_MDL_KEY}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // `applyCamera` -> `flyToBounds` -> MapLibre's own ANIMATED `flyTo` (not instant) — poll rather
    // than read the camera the instant hydration settles, or this reads the mid-flight (or even
    // pre-flight) zoom instead of the fix's actual destination.
    await expect
      .poll(async () => (await readCamera(page)).zoom, {
        message: "camera never zoomed in past the study-area default",
        timeout: 5_000,
      })
      .toBeGreaterThan(STUDY_AREA_ZOOM_CEILING);

    const camera = await readCamera(page);
    // the ax sibling's bbox is [-177.7, 60.65, -139.15, 79] -> center (-158.425, 69.825).
    expect(camera.center.lng).toBeGreaterThan(-179);
    expect(camera.center.lng).toBeLessThan(-135);
    expect(camera.center.lat).toBeGreaterThan(55);
    expect(camera.center.lat).toBeLessThan(85);
  });

  test("v7 walrus (mdl_seq 54383, NO bbox anywhere) frames off the COG's own /cog/info extent, narrowed by point-probe", async ({
    page,
  }) => {
    // NOT `gotoSpecies` (which registers its own `routeTitilerTiles` wildcard as the LAST step
    // before `page.goto`, so a route added after it returns can lose the race against a fetch the
    // app fires during that same initial load — measured: the plain "register after gotoSpecies"
    // version below never actually saw this route matched). Composing the same steps by hand, in
    // the SAME order `e2e/species.smoke.spec.ts`'s own "hung tile" test uses for exactly this
    // reason, but with the `/cog/info` + `/cog/point` overrides inserted before `page.goto` ever
    // fires — the requests this whole fix depends on.
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeSpeciesShards(page);
    await routeSession(page, null); // v7 is public — no preview session needed
    await routeSealFixture(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page); // the wildcard, registered FIRST so the overrides below win
    await routeWalrusCogBoundsFallback(page);
    await page.goto("/?mdl_seq=54383&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // the fix is a FOLLOW-UP fly-to once /cog/info + the point-probe narrowing answers -- poll
    // rather than a fixed wait.
    await expect
      .poll(async () => (await readCamera(page)).zoom, {
        message: "camera never zoomed in past the study-area default after /cog/info answered",
        timeout: 5_000,
      })
      .toBeGreaterThan(STUDY_AREA_ZOOM_CEILING);

    const camera = await readCamera(page);
    // narrowed bbox: [-190, 53.15, -150, 73.75] -> center (-170, 63.45). W5 fix (Opus 5.5 eyes-on
    // review 5, 2026-09-25): the desktop docked panel's own reserve grew by
    // `PANEL_OUTER_INSET_PX + FIT_GUTTER_PX` (chromePadding.ts) to clear its real outer edge, so
    // this asymmetric-padding shift (camera.ts#shiftForPadding, via the SAME live
    // `desktopPanelPadding` this fix touches) now lands measurably further east (-152.3 measured,
    // was comfortably under -155 before) -- the bound widens to keep real margin, not to just
    // barely pass.
    expect(camera.center.lng).toBeGreaterThan(-185);
    expect(camera.center.lng).toBeLessThan(-145);
    expect(camera.center.lat).toBeGreaterThan(58);
    expect(camera.center.lat).toBeLessThan(70);
  });

  // D8 fold-in (orchestrator round 2, 2026-09-24): "zoomToLayer() using the same bounds fallback"
  // -- the manual re-fit action (`state.svelte.ts#zoomToLayer`, reached here through the
  // `__atlasSpecies` test seam Shell.svelte exposes it on, same spirit as `selectSpecies`) used to
  // call only `cameraFor()`'s bundle-only chain, so on a taxon with NO published bbox anywhere it
  // landed on the loose study-area view and never asked `/cog/info` at all -- even though the
  // INITIAL species-change effect (the test above) already got the COG-bounds last resort in round
  // 1. This test proves the manual action reaches the SAME fallback, not just the automatic one.
  test("zoomToLayer() ALSO reaches the COG-bounds last resort, not just the initial species-change effect", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeSpeciesShards(page);
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    await routeWalrusCogBoundsFallback(page);
    await page.goto("/?mdl_seq=54383&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // let the INITIAL species-change effect finish its own fit (round 1's fix) before exercising
    // the SEPARATE `zoomToLayer()` action below. Generous timeout (P6c: a fixed 5s predicate here
    // flaked on Firefox in CI — a real engine's flyTo animation + this test's TWO sequential mocked
    // network round-trips (`/cog/info` then `/cog/point`) have no fixed duration, especially on a
    // loaded CI runner, so the wait is sized for that rather than guessed tight).
    await expect
      .poll(async () => (await readCamera(page)).zoom, { timeout: 15_000 })
      .toBeGreaterThan(STUDY_AREA_ZOOM_CEILING);

    // pan the camera away with a plain, INSTANT MapLibre call (not this app's own
    // flyTo/applyCamera path) — proves any re-fit below is `zoomToLayer()`'s own doing, not a
    // leftover animation from the initial load.
    await page.evaluate(() => {
      const w = window as unknown as {
        __atlasMap: {
          handle: { map: { jumpTo(o: { center: [number, number]; zoom: number }): void } };
        };
      };
      w.__atlasMap.handle.map.jumpTo({ center: [0, 0], zoom: 2 });
    });
    await expect
      .poll(async () => (await readCamera(page)).zoom, { timeout: 5_000 })
      .toBeLessThan(3);

    await page.evaluate(() => {
      (
        window as unknown as { __atlasSpecies: { zoomToLayer(): void } }
      ).__atlasSpecies.zoomToLayer();
    });

    // same generous, CI-Firefox-safe timeout as the initial fit's own poll above -- this is the
    // exact assertion that flaked (5s was too tight once real animation + mocked round-trip
    // latency compounded on a loaded Firefox CI runner; a fixed short window can never be "made
    // proportional" to an animation whose own duration MapLibre computes from distance, so this
    // widens the ceiling rather than trying to predict it).
    await expect
      .poll(async () => (await readCamera(page)).zoom, {
        message: "zoomToLayer() never reached the COG-bounds last resort",
        timeout: 20_000,
      })
      .toBeGreaterThan(STUDY_AREA_ZOOM_CEILING);

    const camera = await readCamera(page);
    // narrowed bbox: [-190, 53.15, -150, 73.75] -> center (-170, 63.45), same as the effect's own.
    // W5 fix: same widened bound as that test above (the desktop panel's larger reserve), same
    // reason.
    expect(camera.center.lng).toBeGreaterThan(-185);
    expect(camera.center.lng).toBeLessThan(-145);
    expect(camera.center.lat).toBeGreaterThan(58);
    expect(camera.center.lat).toBeLessThan(70);
  });
});

// V1 fix (Opus eyes-on review, 2026-09-24): "the walrus model view sits under the legend chip and
// the sheet" -- on the phone, `applyCamera()` (state.svelte.ts) used to pass `cameraFor()`'s own
// flat `DEFAULT_CAMERA_PADDING` (40px, every edge) to `flyToBounds`, blind to the bottom sheet
// (DEFAULT_SHEET_DETENT = "half", ~46% of the viewport) sitting over the map. `boundsToCameraView`
// (camera.ts) shifts the fitted center toward the FREE area's own middle when given an asymmetric
// `ChromePadding` (its own header: "P6/D8 ... a model fit is not centred behind the very chrome
// that is hiding half of it") -- with a UNIFORM padding (the bug), that shift is always zero, so
// the fitted bbox's own geographic center projects to exactly the CONTAINER's geometric vertical
// centre; with the fix, it projects measurably ABOVE that (inside the visible free area, above the
// sheet's top edge). Uses `window.__atlasMap` (`handle.map.project`/`getCenter`) -- the app's own
// existing test/automation seam (Shell.svelte's own header: "exposes nothing a viewer could not
// already read off the page"), never a raw new hook into MapLibre internals.
test.describe("V1 fix: the species camera pads for the phone sheet (and legend chip), not a flat 40px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the fitted model's own centre projects INSIDE the free area, above the sheet -- not at the container's raw geometric centre", async ({
    page,
  }) => {
    // same v9 `am` walrus fixture as the desktop "sibling" test above -- ax sibling bbox
    // [-177.7, 60.65, -139.15, 79] -> centre (-158.425, 69.825). DEFAULT_SHEET_DETENT is "half"
    // (sheetGeometry.ts), so no localStorage setup is needed to reproduce the bug's own starting
    // state -- a fresh phone load already opens with the sheet at "half".
    await gotoSpecies(page, `/?mdl_key=${WALRUS_AM_MDL_KEY}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // NOT a zoom-ceiling poll (the desktop tests above use one; it does not transfer here): the
    // SAME bbox fit to a 390px-wide viewport legitimately settles at a LOWER zoom than an
    // identical fit at 1280px does (fewer px per degree needed to fit the same span in a
    // narrower box) -- measured, this is ~1.56, not a "never fitted" value. Longitude is the
    // reliable proxy that the fit actually ran: the ax sibling bbox's own centre longitude
    // (-158.425) is exact once `boundsToCameraView` has been called with it, regardless of the
    // viewport-dependent zoom/latitude shift the fix itself introduces. Generous, CI/loaded-
    // laptop-safe timeout, same reasoning as this file's own zoomToLayer() test above.
    await expect
      .poll(async () => (await readCamera(page)).center.lng, {
        message: "camera never fitted the model's own extent",
        timeout: 15_000,
      })
      .toBeCloseTo(-158.425, 0);

    // `map.getCenter()` trivially always projects to the container's own geometric middle (that
    // is what "the map's centre" MEANS to MapLibre) -- it proves nothing about padding. What the
    // fix actually moves is WHERE ON SCREEN the fitted CONTENT's own raw geographic centre lands:
    // pre-fix (uniform padding), the ax sibling bbox's own centre — (-158.425, 69.825), this
    // file's own header/the desktop test above — projects to the exact container midpoint (zero
    // shift); post-fix, the asymmetric bottom padding shifts the CAMERA so that point instead
    // lands at the FREE AREA's own middle, well above the sheet's real top edge.
    const BBOX_CENTER: [number, number] = [-158.425, 69.825];
    const { projectedY, sheetTopRelative, containerHeight } = await page.evaluate((center) => {
      const w = window as unknown as {
        __atlasMap: {
          handle: {
            map: {
              project(lngLat: [number, number]): { x: number; y: number };
              getContainer(): HTMLElement;
            };
          };
        };
      };
      const map = w.__atlasMap.handle.map;
      const containerRect = map.getContainer().getBoundingClientRect();
      const p = map.project(center);
      const sheetEl = document.querySelector(".sheet");
      const sheetTop = sheetEl ? sheetEl.getBoundingClientRect().top : null;
      return {
        projectedY: p.y,
        containerHeight: containerRect.height,
        // relative to the MAP CONTAINER's own top -- the same coordinate space `project()` uses.
        sheetTopRelative: sheetTop === null ? null : sheetTop - containerRect.top,
      };
    }, BBOX_CENTER);

    // the sheet must actually be occupying real screen space for this test to mean anything.
    expect(
      sheetTopRelative,
      "the phone sheet is not on screen -- this test cannot exercise the bug",
    ).not.toBeNull();

    expect(
      projectedY,
      `the model's own bbox centre projected to y=${projectedY} of a ${containerHeight}px map, ` +
        `sheet top at y=${sheetTopRelative} -- expected the fitted centre well above the sheet's ` +
        `own top edge (inside the free area), not at/behind it`,
    ).toBeLessThan(sheetTopRelative! * 0.85);
  });
});

// V4 fix (owner phone report, 2026-09-24, phone-17/18): V1's own test just above only checks the
// fitted bbox's CENTRE point -- which can project correctly while the bulk of a WIDE range still
// bunches into one corner of the frame under GLOBE projection at low zoom (the exact bug: the
// leatherback default view and the walrus model view both squeezed into the bottom of the free
// area, most of the frame empty black space -- `map.ts#flyToBounds`'s own header has the root
// cause). This samples a 5x5 grid across the model's own bbox (corners, edges, centre) with the
// map's OWN `project()` (so it reflects whatever projection -- globe or mercator -- is actually
// live) and requires most of them to land inside the FREE area: top bar to the sheet's own top
// edge, full width, minus the floating legend chip's own band.
test.describe("V4 fix: the species camera fills the free area under globe projection, not just a point behind it", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  interface FreeAreaSample {
    x: number;
    y: number;
    inside: boolean;
  }
  interface FreeAreaResult {
    insideFraction: number;
    total: number;
    inside: number;
    sample: FreeAreaSample[];
  }

  /** samples a 5x5 grid across `bbox` (`[xmin,ymin,xmax,ymax]` -- `xmax` may exceed 180, the same
   * re-expressed frame `data/camera.ts#minimalFrame` produces) and reports what fraction land
   * inside the free area. The map CONTAINER's own top-left is already below the top bar (measured:
   * `getBoundingClientRect().top === 48` in page space while the container's OWN coordinate space,
   * what `project()` returns, starts at 0) -- so the free area's own top is simply 0, the same
   * container-relative convention the V1 test above already uses for the sheet. */
  async function freeAreaCoverage(
    page: Page,
    bbox: [number, number, number, number],
  ): Promise<FreeAreaResult> {
    return page.evaluate((bboxArg) => {
      const [xmin, ymin, xmax, ymax] = bboxArg;
      const w = window as unknown as {
        __atlasMap: {
          handle: {
            map: {
              project(lngLat: [number, number]): { x: number; y: number };
              getContainer(): HTMLElement;
            };
          };
        };
      };
      const map = w.__atlasMap.handle.map;
      const containerRect = map.getContainer().getBoundingClientRect();
      const sheetEl = document.querySelector(".sheet");
      const sheetTop = sheetEl
        ? sheetEl.getBoundingClientRect().top - containerRect.top
        : containerRect.height;
      const chipEl = document.querySelector(".legend-chip-region");
      const chipRect = chipEl ? chipEl.getBoundingClientRect() : null;
      const chipTop = chipRect ? chipRect.top - containerRect.top : null;
      const chipBottom = chipRect ? chipRect.bottom - containerRect.top : null;

      const fracs = [0, 0.25, 0.5, 0.75, 1];
      const lons = fracs.map((f) => xmin + f * (xmax - xmin));
      const lats = fracs.map((f) => ymin + f * (ymax - ymin));
      const sample: { x: number; y: number; inside: boolean }[] = [];
      for (const lon of lons) {
        for (const lat of lats) {
          const p = map.project([lon, lat]);
          const inChip =
            chipTop !== null && chipBottom !== null && p.y >= chipTop && p.y <= chipBottom;
          const inside =
            p.x >= 0 && p.x <= containerRect.width && p.y >= 0 && p.y < sheetTop && !inChip;
          sample.push({ x: p.x, y: p.y, inside });
        }
      }
      const inside = sample.filter((s) => s.inside).length;
      return { insideFraction: inside / sample.length, total: sample.length, inside, sample };
    }, bbox);
  }

  function assertMostlyInside(result: FreeAreaResult): void {
    expect(
      result.insideFraction,
      `only ${result.inside}/${result.total} of the model's bbox grid points landed inside the ` +
        `free area (top bar to sheet top, full width, minus the legend chip band) -- sample: ` +
        JSON.stringify(result.sample),
    ).toBeGreaterThanOrEqual(0.8);
  }

  /** waits for the flyTo animation to actually FINISH, not merely for the zoom to have crossed
   * {@link STUDY_AREA_ZOOM_CEILING} once -- a fixed poll on zoom ALONE can catch a transient
   * mid-flight frame (measured on this test's own first draft: the grid-coverage assertion ran
   * while the page's own "Map loading" status was still visible, and `flyTo`'s easing curve is not
   * guaranteed monotonic in zoom). Requires BOTH conditions at once so a walrus-style TWO-flight
   * sequence (an initial center-only fallback, then a second flyToBounds once /cog/info answers)
   * cannot be mistaken for "settled" during the brief gap between the two flights, when the map is
   * genuinely not moving but still parked at the (low-zoom) study-area default. */
  async function waitForCameraSettled(page: Page): Promise<void> {
    await expect
      .poll(
        () =>
          page.evaluate((ceiling) => {
            const w = window as unknown as {
              __atlasMap?: { handle: { map: { getZoom(): number; isMoving(): boolean } } };
            };
            const map = w.__atlasMap?.handle.map;
            if (!map) return false;
            return map.getZoom() > ceiling && !map.isMoving();
          }, STUDY_AREA_ZOOM_CEILING),
        { message: "camera flight never settled past the study-area default", timeout: 15_000 },
      )
      .toBe(true);
  }

  /** the single-flight counterpart to {@link waitForCameraSettled} above -- for a taxon whose
   * `cameraFor()` bundle-only chain already returns a bounds camera synchronously (the leatherback
   * fixture below: `card.merged.bbox` is non-null, no async `/cog/info` step needed), there is only
   * ONE `flyTo` in play, so a zoom-ceiling proxy is unnecessary and, for a bbox this WIDE, actively
   * unreliable (a 170deg-wide fit legitimately settles BELOW the study area's own 2.16 zoom on a
   * narrow phone viewport -- width, not height, is the limiting scale here). Waits for movement to
   * actually START first (proving the species-change effect's own `flyTo` has fired, not just the
   * map's un-animated initial placement) and then to STOP. */
  async function waitForSingleFlightSettled(page: Page): Promise<void> {
    async function isMoving(): Promise<boolean> {
      return page.evaluate(() => {
        const w = window as unknown as {
          __atlasMap?: { handle: { map: { isMoving(): boolean } } };
        };
        return !!w.__atlasMap?.handle.map.isMoving();
      });
    }
    await expect
      .poll(() => isMoving(), {
        message: "the species camera never started flying",
        timeout: 10_000,
      })
      .toBe(true);
    await expect
      .poll(() => isMoving(), {
        message: "the species camera never stopped flying",
        timeout: 15_000,
      })
      .toBe(false);
  }

  test("the leatherback's own (wide, real-published) range fills the free area", async ({
    page,
  }) => {
    // ~100deg lon span, ~40deg lat span -- wide enough to reproduce the production defect (phone-17:
    // OCEANIA + scattered range patches spread across most of the visible globe, squeezed into the
    // bottom of the free area with the top half empty) and to legitimately fit at a low (globe-
    // regime) zoom, without the aspect ratio being SO extreme (a first draft tried 170x75) that even
    // a correct "contain" fit's own far corners graze the free area's edge under the curvature a
    // rectangular lat/lon box takes on a real sphere. v7 itself publishes no bbox at all
    // (data/camera.ts's own header) -- this fixture stands in for a release that does (v9 and
    // later), which is exactly the shape a wide-range species' own published bbox takes.
    const BBOX: [number, number, number, number] = [130, 5, 230, 45];
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeSpeciesShards(page);
    // registered AFTER routeSpeciesShards, so it wins (newest-registered-first) -- overrides just
    // this test's leatherback shard (tests/fixtures/species/v7/taxon/e1.json) with the SAME record
    // plus a real, wide `merged.bbox` the on-disk fixture leaves `null`.
    await page.route(
      (url) => url.href.includes("/app/taxon/e1.json"),
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schema: 1,
            ver: "v7",
            shard: "e1",
            taxa: {
              "54241": {
                key: "54241",
                sci: "Dermochelys coriacea",
                common: "Leatherback Turtle",
                sp_cat: "turtle",
                taxon_id: "137209",
                taxon_authority: "worms",
                rl: "EN",
                esa: { code: "NMFS:EN", source: "ch_nmfs" },
                mmpa: false,
                mbta: false,
                er_score: 100,
                valid_usa: true,
                valid_global: null,
                merged: {
                  type: "cog",
                  url: "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/usa05/9fe6f75498affae1.tif",
                  rescale: [1, 100],
                  colormap: "spectral_r",
                  bbox: BBOX,
                },
                inputs: [],
              },
            },
          }),
        }),
    );
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    await page.goto("/?mdl_seq=54241&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");

    await waitForSingleFlightSettled(page);
    assertMostlyInside(await freeAreaCoverage(page, BBOX));
  });

  test("the walrus's real (COG-bounds-narrowed) range fills the free area", async ({ page }) => {
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeSpeciesShards(page);
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    await routeWalrusCogBoundsFallback(page);
    await page.goto("/?mdl_seq=54383&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // two flights in sequence (the initial study-area fallback, then the COG-bounds fit once
    // /cog/info + the point-probe answer) -- waitForCameraSettled's own header explains why a
    // plain zoom poll alone is not enough here.
    await waitForCameraSettled(page);

    // narrowed bbox: [-190, 53.15, -150, 73.75] -- same real value as the desktop D8 test above.
    const NARROWED_BBOX: [number, number, number, number] = [-190, 53.15, -150, 73.75];
    assertMostlyInside(await freeAreaCoverage(page, NARROWED_BBOX));
  });
});
