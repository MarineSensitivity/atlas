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
// Usage: `node scripts/verify.mjs` (expects `vite preview` already serving `dist/`, e.g. via
// `npm run build && npm run preview -- --port 4331 --strictPort`).
//   --engines=chromium,webkit,firefox   (default: all three)
//   --limit=N                            (first N states only, per engine -- fast local iteration)
//   --states=<substring>                 (only states whose name includes this substring)
import "./parity/ts-resolve.mjs"; // side effect: lets this script import e2e/*.ts extensionlessly
import { chromium, firefox, webkit } from "@playwright/test";

const { routeBucket, routeSealFixture, routeSession, waitForHydration } =
  await import("../e2e/hermetic.ts");
const {
  BASEMAP_RGB,
  RASTER_RGB,
  SCORE_COG_URL,
  ZONES_PMTILES_URL,
  blockWasm,
  routeBasemapTiles,
  routeGlyphs,
  routeTitilerTiles,
  routeZonesPmtiles,
} = await import("../e2e/map-hermetic.ts");
const { SCORE_RASTER_OPACITY } = await import("../src/lib/map/layers/raster.ts");
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
  await routeBasemapTiles(page);
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

function scoresRasterProbe(cog = RASTER_RGB, opacity = SCORE_RASTER_OPACITY) {
  const expected = blend(BASEMAP_RGB, cog, opacity);
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

const SHELL_STATES = [
  { name: "shell (default)", kind: "scores", path: "/" },
  { name: "shell (theme=dark)", kind: "scores", path: "/?theme=dark" },
  { name: "shell (theme=light)", kind: "scores", path: "/?theme=light" },
];

const PROJECTIONS = ["globe", "mercator"];
const OUTLINES = ["programarea", "ecoregion", "none"];
const AREAS = ["FULL", "GA"];
const PALETTES = ["spectral_r", "viridis", "cividis", "magma"];
const ZONE_KEYS = ["GAA", "MDA", "CGA", "CAA"];

const SCORES_STATES = [
  // projection x outline x area: every combination is a real, valid, independently-composed
  // composeStyle input (docs/map.md) -- 2 x 3 x 2 = 12
  ...PROJECTIONS.flatMap((proj) =>
    OUTLINES.flatMap((out) =>
      AREAS.map((area) => ({
        name: `scores proj=${proj} out=${out} area=${area}`,
        kind: "scores",
        path: `/?proj=${proj}&out=${out}&area=${area}`,
        assert: zoneVectorProbe(),
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
  // every published layer x both study areas -- 4 x 2 = 8
  ...LAYER_KEYS.flatMap((lyr) =>
    AREAS.map((area) => ({
      name: `scores lyr=${lyr.slice(0, 24)} area=${area}`,
      kind: "scores",
      path: `/?lyr=${encodeURIComponent(lyr)}&area=${area}`,
      assert: scoresRasterProbe(),
    })),
  ),
  // every zone, selected, on both projections -- 4 x 2 = 8
  ...ZONE_KEYS.flatMap((key) =>
    PROJECTIONS.map((proj) => ({
      name: `scores sel=zone:${key} proj=${proj}`,
      kind: "scores",
      path: `/?unit=programarea&proj=${proj}&sel=${encodeURIComponent(`zone:programarea:${key}`)}`,
      assert: zoneVectorProbe(),
    })),
  ),
  // two arbitrary cell selections (ring drawn from a plain cell id -- no probe needed beyond layout)
  { name: "scores sel=cell:1500000", kind: "scores", path: "/?sel=cell:1500000" },
  { name: "scores sel=cell:100", kind: "scores", path: "/?sel=cell:100" },
];

const SPECIES_KEYS = [
  { label: "leatherback (merged)", token: LEATHERBACK_SP },
  { label: "walrus (am)", token: WALRUS_AM_MDL_KEY },
  { label: "wrybill (non-US)", token: WRYBILL_SP },
];

const SPECIES_STATES = [
  { name: "species (default pick)", kind: "species", path: "/?lens=species" },
  // species key x us-only x representation -- 3 x 2 x 2 = 12
  ...SPECIES_KEYS.flatMap(({ label, token }) =>
    [true, false].flatMap((us) =>
      ["native", "model"].map((rep) => ({
        name: `species sp=${label} us=${us ? 1 : 0} rep=${rep}`,
        kind: "species",
        path: `/?lens=species&sp=${token}&us=${us ? 1 : 0}&rep=${rep}`,
      })),
    ),
  ),
  // two of the above, again under an explicit theme (dark/light) -- 2 x 2 = 4
  ...SPECIES_KEYS.slice(0, 2).flatMap(({ label, token }) =>
    ["dark", "light"].map((theme) => ({
      name: `species sp=${label} theme=${theme}`,
      kind: "species",
      path: `/?lens=species&sp=${token}&theme=${theme}`,
    })),
  ),
];

export const STATE_MATRIX = [...SHELL_STATES, ...SCORES_STATES, ...SPECIES_STATES];

// ---- runner ----------------------------------------------------------------------------------

const ENGINES = { chromium, webkit, firefox };

function parseArgs(argv) {
  const out = { engines: Object.keys(ENGINES), limit: undefined, filter: undefined };
  for (const a of argv) {
    if (a.startsWith("--engines=")) out.engines = a.slice("--engines=".length).split(",");
    else if (a.startsWith("--limit=")) out.limit = Number(a.slice("--limit=".length));
    else if (a.startsWith("--states=")) out.filter = a.slice("--states=".length);
  }
  return out;
}

async function runState(page, baseURL, state, viewportName) {
  const url = new URL(state.path, baseURL).toString();
  if (state.kind === "species") {
    await gotoSpecies(page, url, "v9");
  } else {
    await gotoScores(page, url);
  }
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
  const { engines, limit, filter } = parseArgs(process.argv.slice(2));

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
          try {
            const problems = await runState(page, baseURL, state, viewportName);
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

  process.stdout.write("\nverify: summary\n");
  for (const [engineName, { pass, fail }] of Object.entries(summary)) {
    process.stdout.write(`  ${engineName}: ${pass} pass, ${fail} fail\n`);
  }

  process.exit(failed ? 1 : 0);
}

// only run as a CLI, not when imported (tests import assertLayout/VIEWPORTS/STATE_MATRIX directly).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
