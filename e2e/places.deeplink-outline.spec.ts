// 0.10.21 Places same-class candidate (the fix-1 plan's step 3): `Places.svelte` ~line 398 restores
// a selected place's outline in an `$effect` that reads `selectedIndex`/`places` and calls
// `mapStore.setOutline(...)` -- but that `$effect` only exists while `Places.svelte` itself is
// mounted, and Shell.svelte mounts it ONLY while `activeTool === "places"` (a lazy chunk, never the
// default active tool -- Shell.svelte's own "lazy lens/panel chunks" comment). So a deep link that
// selects a drawn place (`?sel=place:0#pl=...`) WITHOUT the Places tool ever having been opened
// (the default `activeTool` is `"layers"`) never runs that `$effect` at all: `placesMap.outline`
// stays whatever `createPlacesMapStore()` initializes it to, Shell.svelte's `placesSelection` stays
// null, and `composeStyle()` never receives a `selection` input -- the outline this deep link is
// SUPPOSED to draw ("what is displayed is what is analyzed", `geomPlace.ts`) never renders.
//
// This is the SAME shape as fix 1 (scores): a piece of map state computed only inside panel-gated
// UI, rather than a lens/place-level store the shell instantiates regardless of which tool/panel is
// open. The gate here follows this repo's own rule for a selection/outline: assert a RENDERED
// VECTOR FEATURE (`queryRenderedFeatures`), never just painted pixels (docs/map.md's MapLibre
// wiring rule) -- `selection-line` is the layer id `map/style.ts#selectionLayers` emits whenever
// `composeStyle()`'s `selection` input is non-null.
//
// Hermetic: routes the bucket/session/seal/basemap/glyphs the same way e2e/map.spec.ts does, and
// never touches the live network. The place hash is built with the REAL codec (`geomPlaceFrom`/
// `hashFromPlaces`), not a hand-typed string, so a codec change cannot silently invalidate this spec.
import { expect, test, type Page } from "@playwright/test";
import {
  collectConsoleErrors,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";
import { blockWasm } from "./map-hermetic";
import { geomPlaceFrom } from "../src/places/geomPlace";
import { hashFromPlaces } from "../src/places/model";
import type { AreaGeometry } from "../src/lib/geo/types";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

/** a small, real rectangle off the Pacific NW coast -- the exact shape does not matter, only that
 * `geomPlaceFrom`/`hashFromPlaces` produce a REAL `#pl=` the app's own decoder must accept. */
const GEOMETRY: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-124.5, 40.0],
      [-123.0, 40.0],
      [-123.0, 41.5],
      [-124.5, 41.5],
      [-124.5, 40.0],
    ],
  ],
};

const PLACE = geomPlaceFrom(GEOMETRY, "Deep-linked place");
const PL_HASH = hashFromPlaces([PLACE])!;

// the URL a real share link carries: built through `URLSearchParams`, the SAME mechanism
// `src/lib/state/codec.ts#formatSel` uses, never a hand-interpolated template string. `PL_HASH`'s
// name segment is ALREADY percent-encoded once by the codec itself (`encodeName`, placeCodec.ts --
// "name = percent-encoded UTF-8"); `URLSearchParams` percent-encodes the WHOLE value again on
// `.toString()` (so its own `%` becomes `%25`), and decodes exactly one layer back off on `.get()`
// -- leaving the codec's OWN `%20` intact for `decodeName()` to unescape. Skipping this and
// interpolating `PL_HASH` raw into the URL means the BROWSER's one decode layer strips the codec's
// escaping instead, `decodeName()` then rejects the bare space, and `placesFromHash` silently
// resolves to zero places -- indistinguishable from this spec's own bug symptom, so the fixture
// itself must go through the real serializer.
// `map=lon,lat,zoom` (codec.ts#parseMapView) frames the camera on the rectangle itself -- the
// shell's own DEFAULT camera (`FALLBACK_FULL_STUDY_AREA`, interaction.ts: zoom 2.16 over the whole
// continental US) would still technically show this rectangle, but leaves no margin against a
// queryRenderedFeatures false negative from an unrelated viewport/tile-boundary edge case; a real
// deep link legitimately carries a camera too (e.g. after panning to inspect a place), so this is
// not an artificial test-only add.
const HASH_PARAMS = new URLSearchParams();
HASH_PARAMS.set("pl", PL_HASH);
const DEEP_LINK = `/?sel=place:0&map=-123.75,40.75,7#${HASH_PARAMS.toString()}`;

async function gotoDeepLinkedPlace(page: Page): Promise<void> {
  await blockWasm(page);
  // no boot.json fixture -- the outline path needs none (header comment). `routeBucket` already
  // routes the basemap/glyph origins (`routeMapTileOrigins`, e2e/hermetic.ts), same as
  // `gotoPublicShell`.
  await routeBucket(page);
  await routeSession(page, null);
  await routeSealFixture(page);
  // `sel=place:0` (query, per src/lib/state/codec.ts) selects the ONE place `#pl=` (hash) carries.
  // `activeTool` is ephemeral chrome, never URL state (Shell.svelte's own comment) -- its default,
  // "layers", is exactly the "a different tool active" case this spec exists to prove.
  await page.goto(DEEP_LINK);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

test.describe("0.10.21: a deep-linked drawn place still draws its outline without opening Places", () => {
  test("?sel=place:0#pl=... renders the selection outline with the Places tool never opened", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectConsoleErrors(page);
    await gotoDeepLinkedPlace(page);

    // confirms the deep link actually resolved to the place this spec built, so a decode failure
    // reads as an obviously wrong number (0), never a false green from an unrelated empty state.
    // `:` is valid unescaped in a query component (RFC 3986 pchar) so the browser may keep it
    // literal rather than percent-encoding it -- match either form.
    await expect
      .poll(() => page.evaluate(() => location.search), { timeout: 10_000 })
      .toMatch(/sel=place(?:%3A|:)0/);

    // the Places tab was NEVER activated -- the Report rail tool/Places tab pair is never clicked
    // anywhere in this spec, unlike e2e/places.spec.ts's own `openPlaces()` helper.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = window.__atlasMap!.handle.map;
            if (!map.getLayer("selection-line")) return -1;
            if (!map.isSourceLoaded("selection")) return -1;
            return map.queryRenderedFeatures({ layers: ["selection-line"] }).length;
          }),
        {
          message:
            "no selection-line feature rendered -- the deep-linked place's outline never reached " +
            "composeStyle() because Places.svelte (the only place that used to compute it) was " +
            "never mounted (activeTool defaults to 'layers', not 'places')",
          timeout: 20_000,
        },
      )
      .toBeGreaterThanOrEqual(1);

    expect(errors).toEqual([]);
  });
});
