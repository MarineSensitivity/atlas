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
const STUDY_AREA_ZOOM_CEILING = 3; // FULL is 2.16 on both v7 and v9 fixtures — well under this

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
    // narrowed bbox: [-190, 53.15, -150, 73.75] -> center (-170, 63.45).
    expect(camera.center.lng).toBeGreaterThan(-185);
    expect(camera.center.lng).toBeLessThan(-155);
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
    expect(camera.center.lng).toBeGreaterThan(-185);
    expect(camera.center.lng).toBeLessThan(-155);
    expect(camera.center.lat).toBeGreaterThan(58);
    expect(camera.center.lat).toBeLessThan(70);
  });
});
