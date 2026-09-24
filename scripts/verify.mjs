#!/usr/bin/env node
// atlas-8 step 2: the Playwright state matrix (atlas-0 Deliverable 5's skeleton, filled in).
//
// Every named URL below is a REAL, renderable view state -- generated combinatorially across the
// axes state/types.ts's `Sel` actually supports (theme, lens, projection, outline, unit, palette,
// layer, area, zone selection for the scores lens; species key x us-only x representation for the
// species lens) -- times {desktop 1280x800, phone 390x844} times {chromium, webkit, firefox}.
// Hermetic throughout: every bucket/tile/glyph origin is `page.route`d to a fixture (reusing
// e2e/hermetic.ts, e2e/map-hermetic.ts and e2e/species-hermetic.ts's own helpers via the same
// bundler-extension resolve hook scripts/parity/run.mjs uses for its own TS imports), so this
// script never touches the live network.
//
// Usage: `node scripts/verify.mjs`. SELF-SUFFICIENT (atlas-8 fix round 1): if nothing answers
// VERIFY_BASE_URL (default http://localhost:4331) yet, this script builds `dist/` and starts its
// OWN `vite preview --port 4331 --strictPort`, waits for it to answer, runs the matrix, then
// shuts down the server it started -- never a server it did not start (a `vite preview` already
// serving that port, from a real Playwright run e.g., is left alone and just reused, matching
// e2e/*.spec.ts's own `reuseExistingServer` convention).
//   --engines=chromium,webkit,firefox   (default: all three)
//   --limit=N                            (first N states only, per engine -- fast local iteration)
//   --states=<substring>                 (only states whose name includes this substring)
//   --no-server                          (never start one; fail fast if nothing is listening)
import { spawn } from "node:child_process";
import "./parity/ts-resolve.mjs"; // side effect: lets this script import e2e/*.ts extensionlessly
import { chromium, firefox, webkit } from "@playwright/test";

const { routeBucket, routeSealFixture, routeSession, waitForHydration } =
  await import("../e2e/hermetic.ts");
const {
  BASEMAP_RGB,
  BASEMAP_RGB_NAVY,
  RASTER_RGB,
  SCORE_COG_URL,
  ZONES_PMTILES_URL,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
  routeZonesPmtiles,
} = await import("../e2e/map-hermetic.ts");
const { SCORE_RASTER_OPACITY } = await import("../src/lib/map/layers/raster.ts");
const { zoneHighlightId } = await import("../src/lib/map/layers/zones.ts");
const { SPECIES_RASTER_OPACITY } = await import("../src/lens/species/mapInputs.ts");
const { gotoSpecies, LEATHERBACK_SP, WALRUS_AM_MDL_KEY, WRYBILL_SP } =
  await import("../e2e/species-hermetic.ts");

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
  // the smallest viewport the shell must never overflow at (atlas-3 step 3 fix round 2, item 4):
  // catches the "grid blowout" class of bug where an ancestor's `overflow: hidden` clips a control
  // off-screen without ever tripping `scrollWidth > clientWidth` on <html> -- only the per
  // `[data-control]` bounding-box check below actually sees it.
  phoneNarrow: { width: 320, height: 800 },
};

// ---- the scores-lens boot fixture --------------------------------------------------------------
// Extends e2e/map-hermetic.ts's BOOT_FIXTURE (4 Program-Area zones, proven to render real vector
// features in e2e/map.spec.ts) with a `layers`/`palettes` block shaped exactly like
// tests/lens/scores/fixtures.ts's real-bundle-trimmed BOOT_V7 -- so `lyr=`/`pal=` states exercise
// the REAL scores-lens raster path (src/lens/scores/boot.ts's `defaultLayerKey`/`layerGroups`),
// not a stub that happens to satisfy composeStyle alone.
const SPECTRAL_STOPS = [
  "#5E4EA1",
  "#3287BD",
  "#66C1A5",
  "#ABDDA4",
  "#E5F498",
  "#FFFFBF",
  "#FEDF8B",
  "#FDAD60",
  "#F36C43",
  "#D43E4E",
  "#9E0041",
];
const LAYER_KEYS = [
  "primprod",
  "extrisk_bird_ecoregion_rescaled",
  "extrisk_other_ecoregion_rescaled",
  "score_extriskspcat_primprod_ecoregionrescaled_equalweights",
];
const BOOT_FIXTURE_SCORES = {
  schema: 1,
  ver: "v7",
  id_field: "mdl_seq",
  grid_id: "usa05",
  grid: {
    nc: 3103,
    nr: 2006,
    xmin: 141.1,
    ymax: 74.75,
    resx: 0.05,
    resy: 0.05,
    lon360: true,
    tile: { size: 50 },
  },
  study_areas: [
    { key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 },
    { key: "GA", label: "Gulf of America", lon: -89.089, lat: 26.251, zoom: 3.74 },
  ],
  units: [
    {
      zone_set_key: "programarea_2026-01",
      fld: "programarea_key",
      label: "Program areas",
      pmtiles: ZONES_PMTILES_URL,
      source_layer: "programarea",
    },
  ],
  zones: {
    programarea: [
      { key: "GAA", name: "Gulf of America", label_pt: [-90, 27] },
      { key: "MDA", name: "Mid Atlantic", label_pt: [-72, 38] },
      { key: "CGA", name: "Cook Inlet", label_pt: [-155, 57] },
      { key: "CAA", name: "Central California", label_pt: [-125, 38] },
    ],
  },
  layers: LAYER_KEYS.map((metric_key, i) => ({
    metric_key,
    label: metric_key,
    category: i === 0 ? "raw" : i === LAYER_KEYS.length - 1 ? "composite" : "component",
    order: i + 1,
    colormap: "spectral_r",
    by_subregion: {
      FULL: { cog: SCORE_COG_URL, rescale: [0, 100] },
      GA: { cog: SCORE_COG_URL, rescale: [0, 100] },
    },
  })),
  palettes: {
    spectral_r: SPECTRAL_STOPS,
    viridis: SPECTRAL_STOPS,
    cividis: SPECTRAL_STOPS,
    magma: SPECTRAL_STOPS,
  },
};

async function gotoScores(page, path) {
  await blockWasm(page);
  await routeBucket(page, "v7", BOOT_FIXTURE_SCORES);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  // atlas-8 step 3: `routeBasemapTiles` (the keyed RASTER basemap) was removed by the 2026-09-23
  // basemap round, which replaced it with CARTO's vector style.json chain -- but this script kept
  // importing it by name, so EVERY `node scripts/verify.mjs` scores state threw
  // "routeBasemapTiles is not a function" before its first assertion. A named import of a missing
  // export from a `.ts` module resolved through the bundler hook above is `undefined`, not a load
  // error, so nothing said so until a state ran. Finding A11Y-0 in docs/accessibility-fixes.md.
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(path);
  await waitForHydration(page);
}

// ---- probes -------------------------------------------------------------------------------------

/** read back one pixel of the WebGL canvas at a lon/lat (needs `preserveDrawingBuffer`) -- the
 * same technique e2e/map.spec.ts's own `readPixel` uses, generalized for this script. */
export async function readPixel(page, lon, lat) {
  return page.evaluate(
    ([lng, la]) => {
      const map = window.__atlasMap?.handle.map;
      if (!map) return null;
      const canvas = map.getCanvas();
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return null;
      const dpr = canvas.width / canvas.clientWidth;
      const p = map.project([lng, la]);
      const px = new Uint8Array(4);
      gl.readPixels(
        Math.round(p.x * dpr),
        Math.round(canvas.height - p.y * dpr),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        px,
      );
      return [px[0], px[1], px[2], px[3]];
    },
    [lon, lat],
  );
}

/** how many features a vector layer is currently rendering -- proves a real vector parse, not
 * just "the raster painted" (docs/map.md's S2 lesson: the wrong worker wiring paints tiles happily
 * while silently parsing no vector). */
export async function zoneFeatureCount(
  page,
  sourceId = "programarea_src",
  layerId = "programarea_ln",
) {
  return page.evaluate(
    ([src, lyr]) => {
      const map = window.__atlasMap?.handle.map;
      if (!map || !map.isSourceLoaded(src)) return -1;
      return map.queryRenderedFeatures({ layers: [lyr] }).length;
    },
    [sourceId, layerId],
  );
}

/**
 * No horizontal overflow, and every interactive control (`[data-control]`) fully inside the
 * viewport. Returns a list of problems; empty = pass.
 * @param {import("@playwright/test").Page} page
 */
export async function assertLayout(page) {
  const problems = [];

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) problems.push("horizontal overflow on <html>");

  const viewport = page.viewportSize();
  const controls = page.locator("[data-control]");
  const count = await controls.count();
  for (let i = 0; i < count; i++) {
    const name = await controls.nth(i).getAttribute("data-control");
    // a control legitimately absent at this viewport (e.g. the phone top bar drops Share/Report/
    // Help/search -- spec.md §10) is `display: none`, not a layout bug: skip it rather than
    // failing "not rendered". A control that IS shown but positioned off-screen still fails below.
    if (!(await controls.nth(i).isVisible())) continue;
    const box = await controls.nth(i).boundingBox();
    if (!box) {
      problems.push(`control "${name}" has no bounding box (not rendered)`);
      continue;
    }
    if (!viewport) continue;
    const offscreen =
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > viewport.width ||
      box.y + box.height > viewport.height;
    if (offscreen)
      problems.push(`control "${name}" is off-screen at ${viewport.width}x${viewport.height}`);
  }

  return problems;
}

// ---- the state matrix ----------------------------------------------------------------------------
// Each entry: { name, kind: "scores"|"species", path, assert?: (page) => Promise<string[]> } --
// `assert` returns extra problems beyond assertLayout (e.g. a raster/vector probe); an empty
// array/undefined means "layout only".

/** the scores lens applies its raster at SCORE_RASTER_OPACITY (0.6, src/lib/map/layers/raster.ts),
 * not 1 -- the probe has to expect the basemap/raster ALPHA BLEND a real page paints, not the raw
 * fixture colour e2e/map.spec.ts's manual composeStyle() call (opacity: 1) gets away with. */
function blend(under, over, alpha) {
  return under.map((u, i) => Math.round(u * (1 - alpha) + over[i] * alpha));
}

// m10 (atlas-8 review round 2): exported so e2e/verify.faults.spec.ts:98 can call the REAL probe
// the state matrix runs, instead of a hand-rolled `!= RASTER_RGB` check that would pass on ANY
// wrong colour, not just "the basemap alone, never the raster" -- the exact same "the gate and its
// seeded fault run the SAME code" rule tests/map/no-fitbounds.test.ts's own header states.
// U2a (round 2): `basemapRgb` defaults to `BASEMAP_RGB_NAVY`, not `BASEMAP_RGB` (paper) -- the
// default theme is now DARK (`DEFAULT_SEL.theme`, state/types.ts), so every state below that never
// sets `theme=` now paints navy, not paper. The one caller that still means "the paper theme,
// specifically" (`shell (theme=light)`) passes `BASEMAP_RGB` explicitly instead.
export function scoresRasterProbe(
  cog = RASTER_RGB,
  opacity = SCORE_RASTER_OPACITY,
  basemapRgb = BASEMAP_RGB_NAVY,
) {
  const expected = blend(basemapRgb, cog, opacity);
  return async (page) => {
    const problems = [];
    await page
      .waitForFunction(() => window.__atlasMap?.handle.map.loaded(), undefined, {
        timeout: 15_000,
      })
      .catch(() => problems.push("map never reached loaded()"));
    if (problems.length) return problems;
    // POLL, not a single read: `loaded()` fires once for the map's initial style, not for a
    // raster layer added afterward on this URL's own hydration -- WebKit/Firefox's headless GL
    // stacks decode a tile slower than Chromium's (measured: still basemap-only at the first
    // read), and a probe with no retry conflates "never painted" with "not painted YET".
    let px = null;
    for (let i = 0; i < 40; i++) {
      px = await readPixel(page, -90, 26.5); // inside the Gulf of America probe point
      if (px && expected.every((e, k) => Math.abs(e - px[k]) <= 1)) return [];
      await page.waitForTimeout(500);
    }
    if (!px) return ["no WebGL context to read back"];
    problems.push(
      `raster probe at -90,26.5 expected ~rgb(${expected.join(",")}) (basemap/raster blend at ${opacity}), got rgb(${px.slice(0, 3).join(",")}) after 20s of polling`,
    );
    return problems;
  };
}

function zoneVectorProbe() {
  return async (page) => {
    let count = -1;
    for (let i = 0; i < 20; i++) {
      count = await zoneFeatureCount(page);
      if (count > 0) break;
      await page.waitForTimeout(500);
    }
    return count > 0 ? [] : [`zone vector layer never rendered a feature (count=${count})`];
  };
}

// M3 (Opus 5.5 review): "the Program Areas eye is proven only at the panel-click e2e level, not in
// the state matrix" -- `data-zones:h` used to assert only that the RASTER still painted
// (`scoresRasterProbe()`), never that hiding the group actually zeroed the zone outline's rendered
// features. `layout.visibility: "none"` (CLAUDE.md: never removed, so the layer/source still exist
// and `zoneFeatureCount` never reads a false `-1`) is the whole point of B1/M3 -- this asserts the
// COUNT, not just "the map still shows something."
function zoneHiddenProbe(layerId = "programarea_ln") {
  return async (page) => {
    await page
      .waitForFunction(() => !!window.__atlasMap?.handle.map.getLayer("r_lyr"), undefined, {
        timeout: 15_000,
      })
      .catch(() => {});
    let count = -1;
    for (let i = 0; i < 10; i++) {
      count = await zoneFeatureCount(page, "programarea_src", layerId);
      if (count === 0) break;
      await page.waitForTimeout(300);
    }
    return count === 0
      ? []
      : [`${layerId} expected HIDDEN (data-zones:h) but rendered ${count} feature(s)`];
  };
}

/** runs several `assert` probes and concatenates their problems -- for a state that must satisfy
 * more than one independent property (e.g. "the raster still paints" AND "the zones are hidden"). */
function combinedProbe(...probes) {
  return async (page) => {
    const problems = [];
    for (const probe of probes) problems.push(...(await probe(page)));
    return problems;
  };
}

// ---- M6 (atlas-8 review round 2): the 22 layout-only states get real assertions -----------------
// `verify.mjs` used to check LAYOUT for 22 states (17 species, 3 shell, 2 `scores sel=cell:*`) and
// nothing else -- a 404'd species raster, an empty selection layer, or a `sel=zone:*` state that
// renders the base zone LINE but never the selected zone's own highlight all read as a pass. The
// probes below close that gap: a real rendered-feature/painted-pixel check for every one of them.

/** `map/style.ts#selectionLayers` -- the clicked-cell ring, the selected zone's highlight, a
 * Places pick/drawn outline, or "show analysis cells" (`SELECTION_SOURCE_ID = "selection"`). */
export async function selectionFeatureCount(page) {
  return page.evaluate(() => {
    const map = window.__atlasMap?.handle.map;
    if (!map || !map.getLayer("selection-line")) return -1;
    if (!map.isSourceLoaded("selection")) return -1;
    return map.queryRenderedFeatures({ layers: ["selection-line"] }).length;
  });
}

function selectionLineProbe() {
  return async (page) => {
    let count = -1;
    for (let i = 0; i < 20; i++) {
      count = await selectionFeatureCount(page);
      if (count > 0) break;
      await page.waitForTimeout(500);
    }
    return count > 0 ? [] : [`selection-line layer never rendered a feature (count=${count})`];
  };
}

/** `sel=zone:*` used to assert only the BASE zone outline (`programarea_ln`, every zone in the
 * unit), never that the ONE selected zone's own highlight actually rendered. A zone highlight is
 * NOT the generic `selection`/`selection-line` role at all (that is the cell-ring/Places case
 * only) -- `src/lens/scores/mapInputs.ts` resolves a zone selection into a `highlightKey` on the
 * ZONE UNIT itself, and `zoneHighlightLayer()` (`layers/zones.ts`) filters the SAME vector
 * source/layer the base outline already uses into a second line layer,
 * `${unit}_highlight_ln` (`zoneHighlightId()`, imported -- not restated -- so this probe cannot
 * drift from the real id). The two (base outline vs highlight) are different layers fed by
 * different data, and a regression that broke only the highlight would have read green forever. */
function zoneSelectionProbe(unit = "programarea") {
  const highlightLayer = zoneHighlightId(unit);
  return async (page) => {
    const base = await zoneVectorProbe()(page);
    if (base.length) return base;
    let count = -1;
    for (let i = 0; i < 20; i++) {
      count = await page.evaluate((layer) => {
        const map = window.__atlasMap?.handle.map;
        if (!map || !map.getLayer(layer)) return -1;
        return map.queryRenderedFeatures({ layers: [layer] }).length;
      }, highlightLayer);
      if (count > 0) break;
      await page.waitForTimeout(500);
    }
    return count > 0
      ? []
      : [
          `${highlightLayer} (the selected zone's own highlight) never rendered a feature (count=${count})`,
        ];
  };
}

/** the species lens' raster, blended over the basemap at `SPECIES_RASTER_OPACITY` (0.8 -- distinct
 * from the scores lens' 0.6) -- same technique as `scoresRasterProbe`/`e2e/species.timing.spec.ts`'s
 * own `BLENDED_RASTER_RGB`, generalized: probe the map's own CENTER (`map.getCenter()`), which is
 * always inside the camera `flyToBounds()` just fit, rather than a fixed lon/lat tuned for one
 * species' extent -- the fixture raster (`routeTitilerTiles`'s `solidPng`) is one flat colour for
 * ANY tile, so wherever the camera centers is a valid probe point. `basemapRgb` defaults to the
 * NAVY fixture colour (U2a, round 2: the default theme is dark -- every state below that never
 * sets `theme=` resolves there); the explicit `theme=dark`/`theme=light` states below pass
 * `BASEMAP_RGB_NAVY`/`BASEMAP_RGB` themselves either way, so they are unaffected by this default. */
function speciesRasterProbe(
  cog = RASTER_RGB,
  opacity = SPECIES_RASTER_OPACITY,
  basemapRgb = BASEMAP_RGB_NAVY,
) {
  const expected = blend(basemapRgb, cog, opacity);
  return async (page) => {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      ready = await page.evaluate(() => {
        const map = window.__atlasMap?.handle.map;
        return !!map && !!map.getLayer("species-raster") && map.isSourceLoaded("species-raster");
      });
      if (ready) break;
      await page.waitForTimeout(500);
    }
    if (!ready) return ["species raster layer/source never loaded"];
    const center = await page.evaluate(() => {
      const c = window.__atlasMap.handle.map.getCenter();
      return [c.lng, c.lat];
    });
    let px = null;
    for (let i = 0; i < 20; i++) {
      px = await readPixel(page, center[0], center[1]);
      if (px && expected.every((e, k) => Math.abs(e - px[k]) <= 1)) return [];
      await page.waitForTimeout(500);
    }
    return [
      `species raster probe at map centre ${center} expected ~rgb(${expected.join(",")}), ` +
        `got ${px ? `rgb(${px.slice(0, 3).join(",")})` : "no WebGL context to read back"}`,
    ];
  };
}

/** the species lens' PMTiles range fill (`SPECIES_RANGE_ID = "species-range"`, the OTHER of the
 * two surfaces `mapInputs.ts` ever draws -- always exactly one, never both). */
function speciesRangeProbe() {
  return async (page) => {
    let count = -1;
    for (let i = 0; i < 20; i++) {
      count = await page.evaluate(() => {
        const map = window.__atlasMap?.handle.map;
        if (!map || !map.getLayer("species-range")) return -1;
        if (!map.isSourceLoaded("species-range")) return -1;
        return map.queryRenderedFeatures({ layers: ["species-range"] }).length;
      });
      if (count > 0) break;
      await page.waitForTimeout(500);
    }
    return count > 0 ? [] : [`species-range layer never rendered a feature (count=${count})`];
  };
}

/**
 * G-25 fix, `scores proj=X out=Y area=Z` states: this matrix's own assertion predated `out=`
 * meaning anything -- it demanded a rendered zone LINE feature on every state, which is exactly
 * the bug `zoneUnitsWithOutline()` (`src/lib/map/layers/zones.ts`) fixed: `out=none` (the species
 * lens' own default) now correctly hides the line (`visibility: "none"`), and `out=ecoregion`
 * never had anything to show in the first place (see below). The per-state check now follows
 * `out`, and — since this family never sets `?unit=` (it stays the DEFAULT "cell", so there is no
 * zone choropleth FILL to check here, only the raster) — asserts the raster still paints
 * regardless of the outline, proving `out` only ever changes the outline, never blanks the map.
 *
 * `out="ecoregion"` is the SAME structural zero as `out="none"`, not a bug: plan D17
 * (`src/lens/scores/boot.ts`'s own header, `docs/parity.html`'s intentional difference **ID-03**,
 * "Only Program Areas are drawn as a choropleth") — `boot.units[]` carries exactly ONE unit per
 * release (`programarea` on v2-v9, `planarea` on v1; confirmed against the real, orchestrator-
 * verified v7/v9 bundles trimmed into `tests/lens/scores/fixtures.ts`) and no release EVER
 * publishes a second, ecoregion-outline unit -- there is no PMTiles archive for `out=ecoregion`
 * to draw, on ANY release, so the zone LINE layer renders zero features by construction. ID-03's
 * own text ("subregion and ecoregion scores are still published and still used... they are simply
 * never drawn as a choropleth") is about FILLS, but the same "exactly one published unit" fact
 * governs outlines too -- there is only ever one `ZoneUnitSpec`, so `out=ecoregion` has nothing to
 * outline either. `out="programarea"` is the one real, always-published unit and must render.
 */
function scoresOutlineProbe(out) {
  return async (page) => {
    const rasterProblems = await scoresRasterProbe()(page);
    if (rasterProblems.length) return rasterProblems;

    if (out === "programarea") return zoneVectorProbe()(page);

    // out="none" / out="ecoregion": deterministically ZERO, once the source has settled -- not
    // "polled for a value that might still climb", the way the > 0 branch above needs to be.
    let count = -1;
    for (let i = 0; i < 20; i++) {
      count = await zoneFeatureCount(page);
      if (count !== -1) break; // -1 = source not loaded yet; keep polling for READY, not for zero
      await page.waitForTimeout(500);
    }
    if (count === -1) return ["zone source never loaded"];
    return count === 0
      ? []
      : [`zone LINE layer rendered ${count} feature(s) with out=${out} (outline should be hidden)`];
  };
}

// M6: the shell states are ordinary `unit=cell` scores states (the default), so the SAME
// `scoresRasterProbe` every other default-raster state below gets applies here too -- just
// theme-aware, since `?theme=dark`/the default (U2a, round 2) now paint over a DIFFERENT basemap
// colour (M5, `BASEMAP_RGB_NAVY`) than the explicit `?theme=light` paper fixture.
const SHELL_STATES = [
  // U2a: no explicit `theme=`, so this IS the default -- dark, `scoresRasterProbe()`'s own new
  // default `basemapRgb` (BASEMAP_RGB_NAVY). Was BASEMAP_RGB (paper) before U2a flipped the default.
  { name: "shell (default)", kind: "scores", path: "/", assert: scoresRasterProbe() },
  {
    name: "shell (theme=dark)",
    kind: "scores",
    path: "/?theme=dark",
    assert: scoresRasterProbe(RASTER_RGB, SCORE_RASTER_OPACITY, BASEMAP_RGB_NAVY),
  },
  {
    name: "shell (theme=light)",
    kind: "scores",
    path: "/?theme=light",
    // U2a: paper is no longer the default, so this ONE state now needs the EXPLICIT paper
    // fixture colour -- every other bare `scoresRasterProbe()` call in this file means "the
    // default", which is dark now.
    assert: scoresRasterProbe(RASTER_RGB, SCORE_RASTER_OPACITY, BASEMAP_RGB),
  },
];

const PROJECTIONS = ["globe", "mercator"];
const OUTLINES = ["programarea", "ecoregion", "none"];
const AREAS = ["FULL", "GA"];
const STUDY_AREA_BY_KEY = Object.fromEntries(
  BOOT_FIXTURE_SCORES.study_areas.map((a) => [a.key, a]),
);

/**
 * S-01 (owner report, 2026-09-24): `?area=X` used to render the DEFAULT camera regardless of X —
 * `scoresOutlineProbe`/`scoresRasterProbe` never noticed because neither reads the CAMERA at all,
 * only what painted. This is the positive check that the map actually flew: `map.getCenter()` must
 * settle near `area`'s own `lon`/`lat` (`src/lib/map/camera.ts#shouldFlyToArea`'s contract).
 */
function cameraNearAreaProbe(areaKey, tolDeg = 1) {
  return async (page) => {
    const area = STUDY_AREA_BY_KEY[areaKey];
    if (!area) return [`no fixture study area "${areaKey}"`];
    let center = null;
    for (let i = 0; i < 20; i++) {
      center = await page.evaluate(() => {
        const map = window.__atlasMap?.handle.map;
        if (!map) return null;
        const c = map.getCenter();
        return [c.lng, c.lat];
      });
      if (center && Math.hypot(center[0] - area.lon, center[1] - area.lat) < tolDeg) return [];
      await page.waitForTimeout(250);
    }
    return [
      `camera never reached study area "${areaKey}" (${area.lon},${area.lat}) — stuck at ` +
        `${center ? center.join(",") : "no map"}`,
    ];
  };
}

/** run BOTH `probe` (the existing raster/outline check for this state) and the camera check above,
 * concatenating problems — an `area=` state's camera assertion is additive, never a replacement. */
function withAreaCamera(probe, areaKey) {
  return async (page) => [...(await probe(page)), ...(await cameraNearAreaProbe(areaKey)(page))];
}

const PALETTES = ["spectral_r", "viridis", "cividis", "magma"];
// `map=` (added M6, alongside `zoneSelectionProbe`): the same `label_pt`s BOOT_FIXTURE_SCORES
// already carries. Without a camera override, the default "FULL" globe camera (zoom 2.16) does
// not actually show every zone's label_pt on screen -- measured, wiring this probe in: MDA
// (-72,38) and CGA (-155,57) read 0 highlighted features at `proj=globe` (GAA/CAA, both closer to
// the FULL camera's own centre -101.3,46.9, happened to pass) while the AGGREGATE base-outline
// check (`zoneVectorProbe`, checking every zone's line at once) stayed green throughout -- a real
// globe-projection-at-low-zoom framing limit, not an app bug, and exactly the kind of false
// negative `e2e/places.deeplink-outline.spec.ts`'s own header warns a camera-less probe risks.
const ZONE_KEYS = [
  { key: "GAA", lon: -90, lat: 27 },
  { key: "MDA", lon: -72, lat: 38 },
  { key: "CGA", lon: -155, lat: 57 },
  { key: "CAA", lon: -125, lat: 38 },
];

const SCORES_STATES = [
  // projection x outline x area: every combination is a real, valid, independently-composed
  // composeStyle input (docs/map.md) -- 2 x 3 x 2 = 12. S-01: `withAreaCamera` ADDS the camera
  // assertion on top of the existing outline/raster probe -- neither is removed.
  ...PROJECTIONS.flatMap((proj) =>
    OUTLINES.flatMap((out) =>
      AREAS.map((area) => ({
        name: `scores proj=${proj} out=${out} area=${area}`,
        kind: "scores",
        path: `/?proj=${proj}&out=${out}&area=${area}`,
        assert: withAreaCamera(scoresOutlineProbe(out), area),
      })),
    ),
  ),
  // the drawable unit switch: cell (raster) vs the zone choropleth -- 2 x projection = 4
  ...["cell", "programarea"].flatMap((unit) =>
    PROJECTIONS.map((proj) => ({
      name: `scores unit=${unit} proj=${proj}`,
      kind: "scores",
      path: `/?unit=${unit}&proj=${proj}`,
      assert: unit === "cell" ? scoresRasterProbe() : zoneVectorProbe(),
    })),
  ),
  // every palette, on the default raster layer -- 4
  ...PALETTES.map((pal) => ({
    name: `scores pal=${pal}`,
    kind: "scores",
    path: `/?pal=${pal}`,
    assert: scoresRasterProbe(),
  })),
  // every published layer x both study areas -- 4 x 2 = 8. S-01: same additive camera check.
  ...LAYER_KEYS.flatMap((lyr) =>
    AREAS.map((area) => ({
      name: `scores lyr=${lyr.slice(0, 24)} area=${area}`,
      kind: "scores",
      path: `/?lyr=${encodeURIComponent(lyr)}&area=${area}`,
      assert: withAreaCamera(scoresRasterProbe(), area),
    })),
  ),
  // every zone, selected, on both projections -- 4 x 2 = 8. M6: `zoneSelectionProbe` checks BOTH
  // the base zone outline (as before) AND the selected zone's OWN highlight (`selection-line`) --
  // the review's own finding: this used to assert only the former, so a regression that broke
  // only the selection ring read green forever.
  ...ZONE_KEYS.flatMap(({ key, lon, lat }) =>
    PROJECTIONS.map((proj) => ({
      name: `scores sel=zone:${key} proj=${proj}`,
      kind: "scores",
      path:
        `/?unit=programarea&proj=${proj}&sel=${encodeURIComponent(`zone:programarea:${key}`)}` +
        `&map=${lon},${lat},5`,
      assert: zoneSelectionProbe(),
    })),
  ),
  // two arbitrary cell selections -- M6: a `selection-line` feature count > 0 (the ring drawn
  // from the plain cell id), where this used to be layout-only. `map=` centers the camera ON the
  // cell (grid.ts#cellLonLat, by hand: cell 1500000 -> -156.375,50.575; cell 100 ->
  // 146.075,74.725, both real BOOT_FIXTURE_SCORES grid math) -- without it, the DEFAULT "FULL"
  // camera (centre -101.3,46.9, zoom 2.16, globe projection) never actually shows either cell's
  // tiny 0.05deg ring, and `queryRenderedFeatures` -- a real VIEWPORT query, not a source-content
  // one -- legitimately returns 0 for a feature that exists in the source but is off-screen
  // (measured while wiring this probe in: 0 both times, `map.getStyle().sources.selection.data`
  // showed the real ring polygon present regardless).
  {
    name: "scores sel=cell:1500000",
    kind: "scores",
    path: "/?sel=cell:1500000&map=-156.375,50.575,8",
    assert: selectionLineProbe(),
  },
  {
    name: "scores sel=cell:100",
    kind: "scores",
    path: "/?sel=cell:100&map=146.075,74.725,8",
    assert: selectionLineProbe(),
  },
  // R3 (round-2 plan §5 U4): one `layers=` deviation in the matrix -- hides the Program-Area
  // outline group (`data-zones`), proving a real Layers-panel state renders (and passes axe, via
  // matrix.a11y.spec.ts) without breaking the raster itself. Only `data-zones` is touched (never a
  // colour-affecting group): `scoresRasterProbe()`'s expected blend assumes the DEFAULT basemap/
  // raster colours, so a state that also dimmed a colour group would need its own bespoke expected
  // blend -- out of scope for "one state added to the matrix," not a limitation of the stack itself.
  // M3 fix (Opus 5.5 review): `combinedProbe` also asserts `zoneFeatureCount === 0` for
  // `programarea_ln` -- the raster painting normally is necessary but not SUFFICIENT proof that the
  // eye actually hid the zone outline.
  {
    name: "scores layers=data-zones:h (Program Areas hidden)",
    kind: "scores",
    path: "/?layers=basemap-land,basemap-bathymetry,basemap-boundaries,basemap-roads,basemap-labels,data-raster,data-zones:h,data-places",
    assert: combinedProbe(scoresRasterProbe(), zoneHiddenProbe()),
  },
];

// M6: `param` fixes a real bug this matrix's assertions immediately surfaced -- `WALRUS_AM_MDL_KEY`
// is a raw INPUT key (`am|...`), and `?sp=am|...` is not a species key the app resolves at all (it
// needs `?mdl_key=`, which redirects to the canonical `sp=ms_merge|...&in=am` -- verified against
// `e2e/species.smoke.spec.ts`'s own "?mdl_key=am|... on v9 lands on the right taxon AND selects
// that input" case). Under the OLD `sp=` construction, every walrus state silently rendered
// NOTHING -- not even the basemap -- and "layout only" never noticed (this IS the review's "a
// 404'd species raster passes" finding, one layer up: nothing published at all, not just a 404).
const SPECIES_KEYS = [
  { label: "leatherback (merged)", token: LEATHERBACK_SP, param: "sp" },
  { label: "walrus (am)", token: WALRUS_AM_MDL_KEY, param: "mdl_key" },
  { label: "wrybill (non-US)", token: WRYBILL_SP, param: "sp" },
];

// M6: `rep=` does NOT pick apart these three fixture taxa the way the review's illustrative fix
// text describes ("speciesRasterProbe on rep=model, species-range on rep=native") -- verified
// empirically (debug harness, atlas-8 review round 2): leatherback's and wrybill's MERGED pill
// carries exactly ONE asset, hardcoded `rep: "native"` (`layerBar.ts:190-193`, `MergedSurface.type`
// is ALWAYS `"cog"` -- there is no vector merged surface to fall through to), so `rep=model` and
// `rep=native` resolve to the identical COG either way; walrus's own `am` input carries `model`/
// `native` COGs (TWO distinct rasters, never a range) and its `mdl_key=` redirect additionally
// drops an explicit `rep=` override, always landing on `native`. None of the 12 core states is
// EVER pmtiles-backed as constructed. The one real vector-range asset among these three fixtures
// is wrybill's OWN `bl` (BirdLife) input (`native: pmtiles`, no `model` asset at all) -- so
// wrybill's two `rep=native` states additionally select it (`in=bl`), which is what actually
// exercises `species-range`; every other state (10 of 12, plus the default pick and both theme
// states) is a real, asserted RASTER.
function speciesCoreAssert(label, rep) {
  if (label.startsWith("wrybill") && rep === "native") return speciesRangeProbe();
  return speciesRasterProbe();
}

const SPECIES_STATES = [
  {
    name: "species (default pick)",
    kind: "species",
    path: "/?lens=species",
    assert: speciesRasterProbe(), // resolves to the leatherback merged COG (verified empirically)
  },
  // species key x us-only x representation -- 3 x 2 x 2 = 12
  ...SPECIES_KEYS.flatMap(({ label, token, param }) =>
    [true, false].flatMap((us) =>
      ["native", "model"].map((rep) => ({
        name: `species sp=${label} us=${us ? 1 : 0} rep=${rep}`,
        kind: "species",
        path:
          `/?lens=species&${param}=${token}&us=${us ? 1 : 0}&rep=${rep}` +
          (label.startsWith("wrybill") && rep === "native" ? "&in=bl" : ""),
        assert: speciesCoreAssert(label, rep),
      })),
    ),
  ),
  // two of the above, again under an explicit theme (dark/light) -- 2 x 2 = 4. Both keys here
  // (leatherback, walrus) default to `rep=native`, which for BOTH is a real COG asset (see the
  // comment above) -- a theme-aware raster probe, matching the shell states' own M5/M6 pairing.
  ...SPECIES_KEYS.slice(0, 2).flatMap(({ label, token, param }) =>
    ["dark", "light"].map((theme) => ({
      name: `species sp=${label} theme=${theme}`,
      kind: "species",
      path: `/?lens=species&${param}=${token}&theme=${theme}`,
      assert: speciesRasterProbe(
        RASTER_RGB,
        SPECIES_RASTER_OPACITY,
        theme === "dark" ? BASEMAP_RGB_NAVY : BASEMAP_RGB,
      ),
    })),
  ),
];

export const STATE_MATRIX = [...SHELL_STATES, ...SCORES_STATES, ...SPECIES_STATES];

// ---- runner ----------------------------------------------------------------------------------

const ENGINES = { chromium, webkit, firefox };

function parseArgs(argv) {
  const out = {
    engines: Object.keys(ENGINES),
    limit: undefined,
    filter: undefined,
    noServer: false,
  };
  for (const a of argv) {
    if (a.startsWith("--engines=")) out.engines = a.slice("--engines=".length).split(",");
    else if (a.startsWith("--limit=")) out.limit = Number(a.slice("--limit=".length));
    else if (a.startsWith("--states=")) out.filter = a.slice("--states=".length);
    else if (a === "--no-server") out.noServer = true;
  }
  return out;
}

/** true if something already answers `baseURL` (any HTTP response counts -- this is a reachability
 * probe, not a health check of what it's serving). */
async function isServerUp(baseURL) {
  try {
    const res = await fetch(baseURL, { signal: AbortSignal.timeout(2_000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(baseURL, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp(baseURL)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`verify: no server answered ${baseURL} within ${timeoutMs}ms`);
}

/**
 * Self-sufficiency (atlas-8 fix round 1): build `dist/` and start `vite preview` on `baseURL`'s
 * own port if nothing is already listening there. Returns a `stop()` that tears down ONLY the
 * server this function itself started -- a server this script finds already running (e.g. a real
 * Playwright run's own `webServer`) is reused, exactly like every `e2e/*.spec.ts` file's own
 * `reuseExistingServer` convention, and this script never kills a server it did not start.
 */
async function ensureServer(baseURL) {
  if (await isServerUp(baseURL)) {
    process.stdout.write(`verify: reusing the server already answering ${baseURL}\n`);
    return async () => {};
  }

  const port = new URL(baseURL).port || "4331";
  process.stdout.write(
    `verify: no server at ${baseURL} -- building and starting one on :${port}\n`,
  );

  await new Promise((resolve, reject) => {
    const build = spawn("npx", ["vite", "build"], { stdio: "inherit", shell: false });
    build.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`)),
    );
    build.on("error", reject);
  });

  const preview = spawn("npx", ["vite", "preview", "--port", port, "--strictPort"], {
    stdio: "inherit",
    shell: false,
  });
  const previewExited = new Promise((resolve) => preview.on("exit", resolve));

  await waitForServer(baseURL).catch((err) => {
    preview.kill();
    throw err;
  });

  return async () => {
    preview.kill();
    await previewExited;
  };
}

/**
 * Route this state's hermetic fixtures and navigate to it. Exported (atlas-8 step 3) so
 * `e2e/matrix.a11y.spec.ts` can drive the SAME 174 states through axe without a second copy of the
 * per-kind fixture wiring: the matrix and the way each of its states is reached are one definition,
 * here, exactly as `assertLayout`/`VIEWPORTS` already are.
 * @param {import("@playwright/test").Page} page
 * @param {string} baseURL
 * @param {{ kind: string, path: string }} state
 */
export async function gotoState(page, baseURL, state) {
  const url = new URL(state.path, baseURL).toString();
  if (state.kind === "species") {
    await gotoSpecies(page, url, "v9");
  } else {
    await gotoScores(page, url);
  }
}

async function runState(page, baseURL, state, viewportName) {
  await gotoState(page, baseURL, state);
  const problems = [...(await assertLayout(page))];
  // the pixel/vector probes are tuned against the DESKTOP camera (docs/map.md's default study-area
  // zoom is chosen for a 1280x800 aspect): at phone/phoneNarrow the same zoom+center shows a
  // narrower slice of the world, and a Program Area on the far side of the country can be
  // legitimately OUTSIDE the visible viewport with nothing wrong at all (measured: "FULL" at
  // 390x844 shows sourceLoaded=true, loaded=true, 0 features -- not a rendering bug, a camera/
  // aspect-ratio one, and a different, larger question than this state matrix owns). Layout
  // (assertLayout, above) is what the pyramid actually asks every viewport to prove; the deeper
  // probes run at desktop, where the fixture camera was tuned, and are the same probe
  // e2e/map.spec.ts / scores.firstpaint.spec.ts already pin per-engine.
  if (state.assert && viewportName === "desktop") problems.push(...(await state.assert(page)));
  return problems;
}

async function main() {
  const baseURL = process.env.VERIFY_BASE_URL ?? "http://localhost:4331";
  const { engines, limit, filter, noServer } = parseArgs(process.argv.slice(2));

  const stopServer = noServer
    ? await (async () => {
        await waitForServer(baseURL, 5_000); // fail fast with a clear message, per --no-server
        return async () => {};
      })()
    : await ensureServer(baseURL);

  let states = STATE_MATRIX;
  if (filter) states = states.filter((s) => s.name.includes(filter));
  if (limit) states = states.slice(0, limit);

  process.stdout.write(
    `verify: ${states.length} state(s) x ${Object.keys(VIEWPORTS).length} viewport(s) x ${engines.length} engine(s) = ${
      states.length * Object.keys(VIEWPORTS).length * engines.length
    } runs\n\n`,
  );

  let failed = false;
  const summary = {}; // engine -> {pass, fail}
  const timings = []; // { label, ms } -- atlas-8 step 3's "profile the three slowest states"

  try {
    for (const engineName of engines) {
      const launcher = ENGINES[engineName];
      if (!launcher) {
        process.stderr.write(`verify: unknown engine "${engineName}"\n`);
        failed = true;
        continue;
      }
      summary[engineName] = { pass: 0, fail: 0 };
      const browser = await launcher.launch();
      try {
        for (const viewportName of Object.keys(VIEWPORTS)) {
          for (const state of states) {
            const page = await browser.newPage({ viewport: VIEWPORTS[viewportName] });
            const label = `${state.name} @ ${viewportName} [${engineName}]`;
            const t0 = performance.now();
            try {
              const problems = await runState(page, baseURL, state, viewportName);
              timings.push({ label, ms: performance.now() - t0 });
              if (problems.length) {
                failed = true;
                summary[engineName].fail++;
                process.stderr.write(`✗ ${label}\n`);
                for (const p of problems) process.stderr.write(`    ${p}\n`);
              } else {
                summary[engineName].pass++;
                process.stdout.write(`✓ ${label}\n`);
              }
            } catch (err) {
              timings.push({ label, ms: performance.now() - t0 });
              failed = true;
              summary[engineName].fail++;
              process.stderr.write(`✗ ${label} — threw: ${err?.message ?? err}\n`);
            } finally {
              await page.close();
            }
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    // never leave a server this script itself started running (CLAUDE.md: "never leave a server
    // on 4331/4401") -- a server this script REUSED (ensureServer's early return) is left alone.
    await stopServer();
  }

  process.stdout.write("\nverify: summary\n");
  for (const [engineName, { pass, fail }] of Object.entries(summary)) {
    process.stdout.write(`  ${engineName}: ${pass} pass, ${fail} fail\n`);
  }

  process.stdout.write("\nverify: slowest 3 states\n");
  for (const t of timings.toSorted((a, b) => b.ms - a.ms).slice(0, 3)) {
    process.stdout.write(`  ${t.ms.toFixed(0)}ms  ${t.label}\n`);
  }

  process.exit(failed ? 1 : 0);
}

// only run as a CLI, not when imported (tests import assertLayout/VIEWPORTS/STATE_MATRIX directly).
//
// The `.catch()` is not decoration (atlas-8 step 3, the A11Y-0 post-mortem): a throw INSIDE a state
// is already counted and turns the exit code red (`runState`'s own try/catch above, proven by
// `tests/faults/verify-missing-export.patch`), but a throw OUTSIDE one -- `ensureServer()` failing,
// `launcher.launch()` failing, `browser.close()` failing -- would reject this promise and leave the
// exit code to Node's default unhandled-rejection policy, which is a runtime flag, not something
// this script should depend on. Now it is: any escape is printed and exits 1.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`verify: fatal — ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
