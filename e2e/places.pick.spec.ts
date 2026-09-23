// B3 (docs/usability.md §4/§3.4): "Pick mode cannot pick a Program Area (only the 1-px outline
// layer is queried)". The assessor turned pick mode on, clicked INSIDE the Western Gulf polygon --
// nowhere near its border -- and "Add to places" stayed disabled, in both "Spatial units: raster
// cells" and "Spatial units: Program areas" modes.
//
// Root cause (src/places/pickInstall.ts, src/lib/map/layers/zones.ts): `zoneQueryLayerIds()` only
// includes a unit's `{unit}_fill` layer in a pick query when the unit carries a `fill` spec, and
// `zoneUnitsFromBoot()` (what both `Shell.svelte`'s own base `zoneUnits` AND the scores lens'
// `scoresMapInputs()` start from) used to return outline-only specs -- so the ONLY layer a pick
// query could ever hit was the 1-px `{unit}_ln` line. An interior click never intersects a 1-px
// line. The fix attaches an invisible (`opacity: 0`) query fill to every unit by default
// (`queryFillFor()`), so the `{unit}_fill` layer always exists in the composed style and a real
// click anywhere inside the polygon resolves.
//
// This is a REAL `page.mouse.click()` at a pixel computed from `map.project()` -- not a synthetic
// `map.fire("click", ...)` -- because the whole point of the bug is screen-space hit-testing
// (`queryRenderedFeatures(point, {...})`), and only a genuine browser click proves the pixel a user
// would actually touch resolves. The click lands at the viewport's own centre (the camera is
// centred on the SAME lon/lat, `map=-90,27,5`), which is comfortably clear of both the rail
// (left edge) and the 380 px panel (`right: var(--space-3)`, shell.css) on a 1280-wide viewport --
// GAA (e2e/fixtures/map/zones.geojson) is a 12°x6° rectangle, so its centre is 3° (a real margin)
// from every edge.
//
// Hermetic, same convention as e2e/scores.outlines.spec.ts: the bucket/session/seal/basemap/zones
// PMTiles/glyphs origins are all routed to fixtures; no spec here touches the live network.
import { expect, test, type Page } from "@playwright/test";
import {
  collectConsoleErrors,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";
import {
  BOOT_FIXTURE,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeZonesPmtiles,
} from "./map-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

// same ambient shape as e2e/map.spec.ts / e2e/scores.outlines.spec.ts, kept byte-for-byte so the
// three specs cannot drift on what `window.__atlasMap` looks like (their own shared comment).
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

/** GAA's own centre (e2e/fixtures/map/zones.geojson: lon -96..-84, lat 24..30) -- 3 degrees, a
 * real margin, from every edge of the rectangle. */
const GAA_CENTER: [number, number] = [-90, 27];

async function gotoPlacesOverGaa(page: Page) {
  await blockWasm(page);
  await routeBucket(page, "v7", BOOT_FIXTURE);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  // mercator (not the globe default): a flat, unambiguous lon/lat <-> screen-pixel mapping for the
  // real mouse click below. The camera CENTRES on GAA's own centre, so the click lands at the
  // viewport's centre regardless of exactly how the panel/rail chrome sizes themselves.
  await page.goto(`/?proj=mercator&map=${GAA_CENTER[0]},${GAA_CENTER[1]},5`);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  await page.waitForSelector("#rail-region .rail", { state: "attached" });
  await page.locator("#rail-region button[aria-label='Places']").click();
}

/** the viewport-absolute pixel `GAA_CENTER` projects to -- `map.project()` is canvas-relative, so
 * this adds the canvas's own `getBoundingClientRect()` offset before handing it to
 * `page.mouse.click()`, which takes viewport coordinates. */
async function screenPointFor(page: Page, lonLat: [number, number]) {
  return page.evaluate((ll) => {
    const map = window.__atlasMap!.handle.map;
    const rect = map.getCanvas().getBoundingClientRect();
    const p = map.project(ll);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, lonLat);
}

for (const unitMode of [
  "raster cells (no fill published by anything)",
  "Program areas selected",
] as const) {
  test(`B3: pick mode resolves a REAL click on the Western Gulf's INTERIOR -- ${unitMode}`, async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoPlacesOverGaa(page);
    if (unitMode === "Program areas selected") {
      // the assessment tried BOTH spatial-unit modes and pick failed in both -- this drives the
      // scores lens' own "Spatial units" select so the SAME scenario is covered here. The Places
      // tool click above already opened the panel; switch back to Layers only long enough to
      // change the select, matching how a real reviewer would (Spatial units lives on the scores
      // lens' own Layers tool, not the Places tool).
      await page.locator("#rail-region button[aria-label='Layers']").click();
      await page.getByLabel("Spatial units").selectOption("programarea");
      await page.locator("#rail-region button[aria-label='Places']").click();
    }

    const addButton = page.getByRole("button", { name: /^Add to places/ });
    await expect(addButton).toBeDisabled();

    // --- turn pick mode on -------------------------------------------------------------------------
    await page.getByRole("button", { name: "Pick mode" }).click();

    // --- a REAL click on GAA's INTERIOR, nowhere near its 1-px outline -----------------------------
    const { x, y } = await screenPointFor(page, GAA_CENTER);
    await page.mouse.click(x, y);

    // B3: before the fix, "Add to places" stayed disabled forever here -- the exact bug (the
    // assessment: "I clicked inside the Western Gulf ... 'Add to places' stayed disabled both
    // times"). `.poll()` because the click resolves through a real MapLibre `queryRenderedFeatures`
    // pass, not synchronously with the DOM click event.
    await expect
      .poll(() => addButton.isEnabled(), {
        message: "pick mode never registered the interior click -- B3 regressed",
        timeout: 10_000,
      })
      .toBe(true);
    await expect(addButton).toHaveText(/Add to places \(1\)/);

    // --- "Add to places" actually adds a zone place carrying GAA -----------------------------------
    // a zone place's own token scheme is `z.{set}.{keys}` (placeCodec.ts#encodePlace), NOT the
    // drawn-geometry `g1.` scheme -- "pa" is the codec's ZoneSet code for "programarea"
    // (model.ts#UNIT_TO_ZONE_SET).
    await addButton.click();
    await expect
      .poll(() => page.evaluate(() => location.hash), { timeout: 10_000 })
      .toMatch(/^#pl=z\.pa\.GAA/);

    expect(errors).toEqual([]);
  });
}
