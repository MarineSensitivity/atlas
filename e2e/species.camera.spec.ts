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
//      `assets: []`) — `state.svelte.ts#refineCameraFromCogBounds` asks titiler's own
//      `/cog/bounds` for the drawn COG's extent as the true last resort.
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

  test("v7 walrus (mdl_seq 54383, NO bbox anywhere) frames off the COG's own /cog/bounds extent", async ({
    page,
  }) => {
    // NOT `gotoSpecies` (which registers its own `routeTitilerTiles` wildcard as the LAST step
    // before `page.goto`, so a route added after it returns can lose the race against a fetch the
    // app fires during that same initial load — measured: the plain "register after gotoSpecies"
    // version below never actually saw this route matched). Composing the same steps by hand, in
    // the SAME order `e2e/species.smoke.spec.ts`'s own "hung tile" test uses for exactly this
    // reason, but with the `/cog/bounds` override inserted before `page.goto` ever fires — the one
    // request this whole fix depends on.
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeSpeciesShards(page);
    await routeSession(page, null); // v7 is public — no preview session needed
    await routeSealFixture(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page); // the wildcard, registered FIRST so the override below wins
    await page.route(
      (url) =>
        url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname === "/cog/bounds",
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          // the walrus's true range (Bering/Chukchi seas) — a plausible COG bounds answer.
          body: JSON.stringify({ bounds: [-179.5, 52.1, -155.2, 72.8] }),
        }),
    );
    await page.goto("/?mdl_seq=54383&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // the fix is a FOLLOW-UP fly-to once /cog/bounds answers -- poll rather than a fixed wait.
    await expect
      .poll(async () => (await readCamera(page)).zoom, {
        message: "camera never zoomed in past the study-area default after /cog/bounds answered",
        timeout: 5_000,
      })
      .toBeGreaterThan(STUDY_AREA_ZOOM_CEILING);

    const camera = await readCamera(page);
    // bounds center: (-167.35, 62.45)
    expect(camera.center.lng).toBeGreaterThan(-179);
    expect(camera.center.lng).toBeLessThan(-150);
    expect(camera.center.lat).toBeGreaterThan(50);
    expect(camera.center.lat).toBeLessThan(78);
  });
});
