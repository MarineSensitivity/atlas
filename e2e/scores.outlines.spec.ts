// G-25 fix (docs/parity.html): `Sel.out` used to round-trip in the URL with nothing reading it --
// `out=none` still drew the Program-Area outline on every map. `Shell.svelte` now runs every
// `zones` array through `zoneUnitsWithOutline()` (`src/lib/map/layers/zones.ts`) before it reaches
// `composeStyle()`; `tests/map/{zones,style}.test.ts` cover the rule at the unit level. This is the
// end-to-end proof on a REAL rendered map: with `out=none`, the zone LINE layer renders zero
// features while the SAME unit's choropleth FILL still renders (an outline and a fill are separate
// layers/paint properties, and only the outline is `out`'s concern) -- with the default
// (`programarea`, the scores lens' own default per `defaultOut()`), the line renders too.
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
  routeTitilerTiles,
  routeZonesPmtiles,
} from "./map-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

/** the shared 4-feature Program Area fixture (map-hermetic.ts), augmented with exactly what the
 * scores lens' zone-CHOROPLETH branch needs (`?unit=programarea`): one metric on the release's
 * layer picker, and a value for it on every zone. Nothing about the fill's COLOR is asserted here
 * (`tests/lens/scores/zoneFill.test.ts` already covers that) -- only that the fill LAYER exists
 * and renders, independent of the outline `out` controls. */
function bootFixture() {
  return {
    ...BOOT_FIXTURE,
    layers: [{ metric_key: "score", label: "Score", category: "composite", order: 1 }],
    zones: {
      ...BOOT_FIXTURE.zones,
      programarea: BOOT_FIXTURE.zones.programarea.map((z, i) => ({
        ...z,
        metrics: { score: 10 + i },
      })),
    },
  };
}

// this ambient shape must match e2e/map.spec.ts's (and scores.firstpaint.spec.ts's) OWN
// `declare global` for `window.__atlasMap` byte-for-byte (TypeScript requires every repeated
// ambient declaration of the same global to be structurally identical) — this spec only reads
// the `handle.map` slice, but the extra members are declared anyway so the three cannot drift.
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

async function gotoScoresZoneChoropleth(page: Page, search: string) {
  await blockWasm(page);
  await routeBucket(page, "v7", bootFixture());
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(`/?unit=programarea&proj=mercator${search}`);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

/** matches `e2e/map.spec.ts`'s own `zoneFeatureCount` guard: `getLayer` before `isSourceLoaded`,
 * because `isSourceLoaded()` on a source the style does not currently hold fires a MapLibre
 * ErrorEvent straight into `console.error` (0.10.14). `-1` (never 0 for "not ready yet") lets a
 * `.poll()` distinguish "the layer/source doesn't exist YET" from a real, settled zero. */
function layerFeatureCount(page: Page, layerId: string) {
  return page.evaluate((id) => {
    const map = window.__atlasMap!.handle.map;
    if (!map.getLayer(id)) return -1;
    if (!map.isSourceLoaded("programarea_src")) return -1;
    return map.queryRenderedFeatures({ layers: [id] }).length;
  }, layerId);
}

test.describe("scores lens — Sel.out reaches the map (G-25)", () => {
  test("out=none: the outline renders NOTHING, but the choropleth fill still does", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoScoresZoneChoropleth(page, "&out=none");

    // the fill settles as soon as the style/source are ready -- assert it first so a slow-to-
    // settle style never reads as "out=none also hid the fill" by racing the poll below.
    await expect
      .poll(() => layerFeatureCount(page, "programarea_fill"), { timeout: 20_000 })
      .toBeGreaterThan(0);

    // the outline layer still EXISTS in the composed style (CLAUDE.md: never addLayer/
    // setLayoutProperty after the fact -- see zoneUnitsWithOutline's own header) but renders no
    // feature because its `visibility` is "none".
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("programarea_ln"), {
      timeout: 20_000,
    });
    expect(await layerFeatureCount(page, "programarea_ln")).toBe(0);

    expect(errors).toEqual([]);
  });

  test("the default outline (programarea, the scores lens' own default) renders both", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    // no `out=` at all -- `defaultOut("scores")` is "programarea" (src/lib/state/types.ts).
    await gotoScoresZoneChoropleth(page, "");

    // BOTH polled independently, never "poll one then single-check the other": the shell's FIRST
    // composed style (its own outline-only `zoneUnits` fallback, before ScoresLens.svelte's own
    // `$effect` has populated `mapExtra.zones` with the choropleth) already renders the LINE layer
    // with no fill yet -- a single-shot fill check right after the line poll settles is a real,
    // measured race (webkit/firefox), not a webkit/firefox-only slowness.
    await expect
      .poll(() => layerFeatureCount(page, "programarea_ln"), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(() => layerFeatureCount(page, "programarea_fill"), { timeout: 20_000 })
      .toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});
