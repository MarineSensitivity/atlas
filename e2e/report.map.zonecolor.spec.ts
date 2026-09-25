// e2e/report.map.zonecolor.spec.ts -- W4 (Ben, phone, live 0.10.64, with a screenshot): "the
// Report's map caption says 'ramp 22 to 30 (red = high); highest Southern California (SOC) 30,
// lowest Central California (CEC) 22', the legend shows the Spectral ramp, but BOTH Program Area
// polygons render the same neutral grey-blue fill -- no colour at all."
//
// ROOT CAUSE (found by reading Report.svelte's `mountMap()` flow, not by guessing at a key
// mismatch): `model` turns non-null the INSTANT `run()` sets `placeInputs` -- synchronously, with
// every place's `score` still `null`, before `run()` even AWAITS `bootEngine()` (the per-place
// scoring loop is sequenced AFTER that await, even for a zone place whose score itself needs no
// engine at all -- `data.ts`'s own header). The map-mount `$effect` fired right then, so
// `mountMap()` (a deliberate ONE-SHOT style build, `reportMap.ts`'s own header: "never a reactive
// re-compose") always read `model.map.domain === null` and painted every place -- the zone `match`
// (`zoneKeyColors`) AND the drawn-place `interpolate` (`scoreColorExpression`) alike -- with
// `REPORT_NODATA_COLOR`, and never repainted once the real scores landed: the caption/legend are
// reactive template bindings that kept tracking `model`, the imperative map style did not. Every
// existing hermetic gate (report.spec.ts, report.map.spec.ts) missed it because `blockWasm()`
// makes `bootEngine()` REJECT before `mountMap()`'s own dynamic imports resolve, so in every one of
// them the race quietly ran the OTHER way. This file's `slowRealWasm()` lets the wasm fetch
// through, just slowly, reproducing the live race deterministically without ever failing the
// engine boot outright (see that helper's own header for why an abort/404 will not do). The fix
// (Report.svelte's map-mount effect) waits for every place's data to have actually landed before
// the one-shot build runs.
//
// SEPARATELY (a design call noted twice by reviewers, then in Ben's own report): a ONE-place map
// used to caption a fabricated "ramp 33 to 34" (the ±0.5 tie-break `rampDomain` widens a single
// value by, so `colorForValue` still lands on a real mid-ramp colour) and drew the full two-ended
// `<Legend>` gradient for it. model.ts's `ReportMap.single` + Report.svelte's `.legend-single`
// branch replace that with the place's own value and a single swatch.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession } from "./hermetic";
import {
  routeVariedBasemapStyle,
  routeZonesPmtiles,
  VARIED_DARK,
  VARIED_LIGHT,
  ZONES_PMTILES_URL,
} from "./map-hermetic";
import { waitForMapCapture } from "./report-hermetic";
import { safeRoute } from "./routeSafety";

// `window.__reportMap` is ALREADY declared globally by `e2e/report.map.spec.ts` (a different
// method shape -- `queryRenderedFeatures`/`getBounds`) -- TypeScript requires every declaration
// merge of the same global member to share one type, so this file does NOT re-declare it (that
// conflicted, `npm run check`/`tsc` red). Cast locally instead, `e2e/map.spec.ts#getAppliedStyle`'s
// own convention for "a method only this file needs": never widen the shared global declaration.
interface ReportMapHandle {
  handle: {
    map: {
      project(lngLat: [number, number]): { x: number; y: number };
      getCanvas(): HTMLCanvasElement;
    };
  };
}

// W4 fix round: NOT `blockWasm()` -- that ABORTS `**/*.wasm` almost instantly, which is exactly
// what let this bug ship (see this file's own header): `bootEngine()`'s `.catch(() => null)`
// resolves right away, so the per-place scoring loop starts (and, for a zone place, finishes)
// before `mountMap()`'s own dynamic imports do, and the race quietly runs the SAFE way in every
// existing gate. This helper instead lets the wasm request through to the REAL local build
// artifact (`route.continue()`, after a delay) -- a genuinely slow but SUCCESSFUL engine boot, the
// same shape the live site's slow-over-HTTPS duckdb-wasm fetch has, not a fast failure. Measured
// against this repo's own `vite preview` build: `mountMap()`'s dynamic imports resolve in well
// under 200ms; delaying the wasm fetch by {@link WASM_DELAY_MS} reliably puts the engine (and so
// the per-place scoring loop gated behind it) on the SLOW side of that race. (An earlier version of
// this helper delayed-then-ABORTED/404'd the wasm request instead -- that reliably HUNG
// `bootEngine()` forever, never settling at all: duckdb-wasm's own worker protocol does not
// recover from a late failure the way it does from an immediate one. `route.continue()` avoids
// that failure mode entirely by never failing the request, only slowing it.)
const WASM_DELAY_MS = 600;
async function slowRealWasm(page: Page, delayMs: number) {
  await page.route(
    "**/*.wasm",
    safeRoute(async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    }),
  );
}

// spectral_r's REAL production order (tests/lens/scores/fixtures.ts's own BOOT_V7, fetched from a
// live v7 bundle 2026-09-22): index 0 = LOW (blue/purple), index 10 = HIGH (red) -- "red = high",
// the caption's own claim. `e2e/report-hermetic.ts`'s BOOT_V9 fixture happens to carry this SAME
// 11-hex set in the OPPOSITE order, which never mattered to that file's own assertions (it never
// checks ramp DIRECTION) -- this file's part (b) assertion does, so it needs the real one.
const SPECTRAL_R = [
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
] as const;
const RAMP_LOW = SPECTRAL_R[0]; // blue end
const RAMP_HIGH = SPECTRAL_R[SPECTRAL_R.length - 1]; // red end
const RAMP_MID = SPECTRAL_R[5];

// the SAME literal `zonePolygonLayers`/`places-fill` paint with (reportMap.ts) -- kept as a
// SEPARATE constant on purpose (report-hermetic.ts's own `EXPECTED_PLACE_CIRCLE_OPACITY` note: a
// gate whose expected value is IMPORTED from the value under test cannot fail for that value).
const EXPECTED_ZONE_FILL_OPACITY = 0.6;

// report/colors.ts's own literal, restated the same deliberate way.
const NODATA_COLOR = "#b6bfd0";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blendOver(
  src: readonly [number, number, number],
  alpha: number,
  bg: readonly [number, number, number],
): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(src[i] * alpha + bg[i] * (1 - alpha))) as [
    number,
    number,
    number,
  ];
}

const BACKGROUNDS: Array<[number, number, number]> = [VARIED_DARK, VARIED_LIGHT];

/** the two plausible composited pixels for a ramp colour, over EITHER checkerboard shade
 * (`routeVariedBasemapStyle`'s fixture) -- which shade underlies a given lon/lat is a projection
 * detail this file does not reproduce, matching `report-hermetic.ts#mapPrintRampPixelCount`'s own
 * convention. */
function candidates(
  hex: string,
  opacity = EXPECTED_ZONE_FILL_OPACITY,
): Array<[number, number, number]> {
  const rgb = hexToRgb(hex);
  return BACKGROUNDS.map((bg) => blendOver(rgb, opacity, bg));
}

function closeToAny(
  px: [number, number, number],
  targets: readonly (readonly [number, number, number])[],
  tolerance = 6,
): boolean {
  return targets.some((t) => [0, 1, 2].every((i) => Math.abs(px[i] - t[i]) <= tolerance));
}

/** the live WebGL canvas's pixel at a lon/lat, via `map.project()` -- the SAME pattern
 * `e2e/map.spec.ts#readPixel` uses against `window.__atlasMap`, mirrored here against
 * `window.__reportMap` (createMap() sets `preserveDrawingBuffer: true` unconditionally, so this
 * works on the report's map the same way). */
function readPixel(page: Page, lon: number, lat: number) {
  return page.evaluate(
    ([lng, la]) => {
      const map = (window as unknown as { __reportMap: ReportMapHandle }).__reportMap.handle.map;
      const canvas = map.getCanvas();
      const gl = (canvas.getContext("webgl2") ??
        canvas.getContext("webgl")) as WebGLRenderingContext | null;
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
    [lon, lat] as const,
  );
}

// two Program Areas that already exist in the committed zones.pmtiles archive
// (e2e/fixtures/map/zones.geojson -- GAA/MDA/CGA/CAA, the SAME archive report.map.spec.ts and
// map.spec.ts already read): GAA (lon -96..-84, lat 24..30, centre -90,27) and CAA ("Central
// California", lon -129..-121, lat 34..42, centre -125,38). Real Program-Area keys (SOC/CEC) are
// not in this fixture archive; GAA/CAA stand in for Ben's SOC/CEC (a high place and a low place),
// which is all this test's colour-direction assertion needs. ONE component each, so
// `overallScore()` (mean of the components present) equals it exactly, and this report's two-place
// `domain` (`rampDomain`) is EXACTLY `[20, 90]` -- so each place's fill interpolates to EXACTLY one
// `SPECTRAL_R` ENDPOINT, never an intermediate blend a maplibre `interpolate`/`match` expression
// would otherwise have to be replicated to predict (the same trick report-hermetic.ts's own
// `mapPrintRampPixelCount` uses).
const BOOT_TWO = {
  ver: "v9",
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  // W4 fix: a COMPLETE, real-shaped grid block, not just `{ grid_id }` -- `gridFromBoot()` THROWS
  // synchronously ("'nc' must be a finite number, got undefined") on an incomplete one, which made
  // `bootEngine()` reject in a handful of milliseconds regardless of `slowRealWasm`'s delay
  // (measured directly while building this file: with an incomplete grid, `bootEngine` settled
  // ~45ms after `placeInputs`, well before `mountMap`'s own dynamic imports ever resolved, so the
  // race this test exists to prove never actually happened -- the test passed on the UNFIXED code
  // for the wrong reason, "it never got that far"). global05's real values (reference/mst_grids.md).
  grid: {
    grid_id: "global05",
    nc: 7200,
    nr: 3600,
    xmin: -180,
    ymax: 90,
    resx: 0.05,
    resy: 0.05,
    lon360: false,
    tile: { size: 50 },
  },
  release: { status: "prerelease", access: "restricted" },
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "Gulf of America (high, stands in for SOC)",
        n_cells: 100,
        area_km2: 100,
        metrics: { extrisk_bird_ecoregion_rescaled: 90 },
      },
      {
        key: "CAA",
        name: "Central California (low, stands in for CEC)",
        n_cells: 100,
        area_km2: 100,
        metrics: { extrisk_bird_ecoregion_rescaled: 20 },
      },
    ],
  },
  units: [
    {
      zone_set_key: "programarea_2026-01",
      fld: "programarea_key",
      label: "Program areas",
      pmtiles: ZONES_PMTILES_URL,
      source_layer: "programarea",
    },
  ],
  datasets: [],
  layers: [],
  palettes: { spectral_r: SPECTRAL_R },
};

// the one-place variant: GAA alone, score 42 (round number, easy arithmetic) -- domain widens to
// [41.5, 42.5] (rampDomain's own ±0.5 tie-break), so `colorForValue` lands EXACTLY on SPECTRAL_R[5]
// (RAMP_MID), the same "exact stop, not merely non-nodata" proof model.test.ts's own unit test
// makes for the pure function.
const BOOT_ONE = {
  ...BOOT_TWO,
  zones: {
    programarea: [
      {
        key: "GAA",
        name: "Gulf of America",
        n_cells: 100,
        area_km2: 100,
        metrics: { extrisk_bird_ecoregion_rescaled: 42 },
      },
    ],
  },
};

async function gotoZoneColorReport(page: Page, boot: object, pl: string) {
  await slowRealWasm(page, WASM_DELAY_MS);
  await routeBucket(page, "v9", boot);
  await routeSession(page, { preview: true, ver: "v9" });
  await routeSealFixture(page);
  await routeVariedBasemapStyle(page);
  await routeZonesPmtiles(page);
  await page.goto(`/report.html?ver=v9#pl=${pl}`);
}

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("report map: zone place fill colour (W4)", () => {
  test("two Program Areas: fills differ, the higher score reads nearer red, the lower nearer blue, neither is nodata", async ({
    page,
  }) => {
    await gotoZoneColorReport(page, BOOT_TWO, "z.pa.GAA%2CCAA");
    await expect(page.locator(".progress-line")).toContainText("Done", { timeout: 30_000 });
    await waitForMapCapture(page);

    const gaaPx = await readPixel(page, -90, 27); // score 90 -> RAMP_HIGH
    const caaPx = await readPixel(page, -125, 38); // score 20 -> RAMP_LOW
    expect(gaaPx, "GAA's polygon painted no pixel at all").not.toBeNull();
    expect(caaPx, "CAA's polygon painted no pixel at all").not.toBeNull();
    const gaa = gaaPx!.slice(0, 3) as [number, number, number];
    const caa = caaPx!.slice(0, 3) as [number, number, number];

    // (a) the two fills differ
    expect(
      gaa.some((c, i) => Math.abs(c - caa[i]) > 10),
      `GAA (rgb ${gaa}) and CAA (rgb ${caa}) painted the SAME colour -- the exact "no colour at ` +
        `all, both a neutral grey-blue" bug Ben reported`,
    ).toBe(true);

    const highCandidates = candidates(RAMP_HIGH);
    const lowCandidates = candidates(RAMP_LOW);
    const nodataCandidates = candidates(NODATA_COLOR);

    // (c) neither equals the no-data colour, checked first so a still-broken build fails on the
    // more specific, more diagnostic reason
    expect(
      closeToAny(gaa, nodataCandidates),
      `GAA (rgb ${gaa}) matches REPORT_NODATA_COLOR composited over the basemap -- the map built ` +
        `before GAA's score landed and never repainted`,
    ).toBe(false);
    expect(
      closeToAny(caa, nodataCandidates),
      `CAA (rgb ${caa}) matches REPORT_NODATA_COLOR composited over the basemap -- the map built ` +
        `before CAA's score landed and never repainted`,
    ).toBe(false);

    // (b) the higher-score place (GAA, 90) reads nearer the ramp's RED end; the lower-score place
    // (CAA, 20) reads nearer the BLUE end -- domain is EXACTLY [20, 90] here, so each is the exact
    // endpoint composite, not merely "closer than the other".
    expect(
      closeToAny(gaa, highCandidates),
      `GAA (score 90, the ramp's own domain MAX) painted rgb ${gaa} -- expected one of ` +
        `${JSON.stringify(highCandidates)} (RAMP_HIGH=${RAMP_HIGH} composited over the basemap)`,
    ).toBe(true);
    expect(
      closeToAny(caa, lowCandidates),
      `CAA (score 20, the ramp's own domain MIN) painted rgb ${caa} -- expected one of ` +
        `${JSON.stringify(lowCandidates)} (RAMP_LOW=${RAMP_LOW} composited over the basemap)`,
    ).toBe(true);
  });

  test("one place: caption states its own value (no degenerate ramp), and paints the sensible mid ramp colour", async ({
    page,
  }) => {
    await gotoZoneColorReport(page, BOOT_ONE, "z.pa.GAA");
    await expect(page.locator(".progress-line")).toContainText("Done", { timeout: 30_000 });
    await waitForMapCapture(page);

    const caption = await page.locator("#map-summary").innerText();
    expect(caption, `caption still reads a degenerate ramp: "${caption}"`).not.toContain("ramp");
    expect(caption, `caption still reads a degenerate ramp: "${caption}"`).not.toContain("highest");
    expect(caption).toContain("Gulf of America");
    expect(caption).toContain("42");

    // the two-ended gradient legend must NOT render for a lone place; the single-swatch legend must.
    await expect(page.locator(".legend")).toHaveCount(0);
    const single = page.locator(".legend-single");
    await expect(single).toBeVisible();
    await expect(single).toContainText("42");

    const gaaPx = await readPixel(page, -90, 27);
    expect(gaaPx).not.toBeNull();
    const gaa = gaaPx!.slice(0, 3) as [number, number, number];
    expect(
      closeToAny(gaa, candidates(NODATA_COLOR)),
      `the one place (rgb ${gaa}) matches REPORT_NODATA_COLOR -- the map built before its score landed`,
    ).toBe(false);
    expect(
      closeToAny(gaa, candidates(RAMP_MID)),
      `the one place painted rgb ${gaa} -- expected the ramp's exact MIDDLE stop ` +
        `(RAMP_MID=${RAMP_MID} composited over the basemap), the "sensible mid colour" a lone ` +
        `value's ±0.5-widened domain always resolves to`,
    ).toBe(true);
  });
});
