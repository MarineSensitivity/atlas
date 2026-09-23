// report/reportMap.ts -- atlas-7 step 2/3, §3 "Map": places filled by mean score, Spectral
// reversed, the report's OWN ramp domain (never the release's -- the seeded fault list names this
// exact mistake), opacity 0.6, labels at point-on-surface with a white halo, legend "Mean score",
// positron basemap with attribution.
//
// Reached ONLY through a dynamic `import()` from `Report.svelte`'s map section: `maplibre-gl` is
// ~288 KB gzip (CLAUDE.md budgets) and report.html's own static critical path has far less room
// for it once the Svelte runtime + report model + brand tokens are counted, so it is lazy here the
// same way duckdb/terra-draw are lazy for index.html -- this repo's existing rule for "a big
// dependency that is not needed before first interaction," just applied to a second entry point.
//
// FIX ROUND 1 (Opus review, item 1): this module used to restate the basemap tile URL and the
// zone `label_pt` lookup by hand, to keep `lib/map/{basemap,zones}.ts` off index.html's static
// graph. That is exactly the "no second copy" rule the phase's own review checklist forbids (a
// duplicated basemap URL or label rule WILL drift), so it is reverted: `composeStyle()`,
// `basemapForTheme()` and `zoneLabelsFromBoot()` are imported and reused verbatim. The map
// CONSTRUCTION (`createMap()`) is reused the same way, from `Report.svelte`'s own dynamic import
// (see that file). The accepted cost is ~6 KB gzip on index.html's static budget (414.8 KB of 450,
// still comfortable) -- `tests/report/noSecondMapCopy.wiring.test.ts` is the seeded-fault-backed
// proof that this module and `Report.svelte` never restate a basemap URL, a MapLibre constructor
// call or a glyphs endpoint again.
import type { AreaGeometry } from "../lib/geo/types";
import { bboxOf } from "../lib/geo/types";
import { pointOnSurface } from "./pointOnSurface";
import type { LegendStop, PaletteStops } from "../lib/raster/ramps";
import { legendStops } from "../lib/raster/ramps";
import { composeStyle } from "../lib/map/style";
import { GLYPHS_URL, loadBasemapStyle } from "../lib/map/layers/basemap";
import { zoneLabelsFromBoot } from "../lib/map/layers/zones";
import type { StyleSpecification } from "../lib/map/types";
import {
  REPORT_MAP_LABEL_HALO,
  REPORT_MAP_LABEL_TEXT,
  REPORT_MAP_OUTLINE,
  REPORT_NODATA_COLOR,
} from "./colors";

/**
 * `boot.zones[unit][key].label_pt`, via the SAME reader the shell's own zone label layer uses
 * (`lib/map/layers/zones.ts#zoneLabelsFromBoot`) -- never a second parser of that field.
 */
export function zonePointFromBoot(
  boot: unknown,
  unit: string,
  key: string,
): [number, number] | null {
  const spec = zoneLabelsFromBoot(boot, unit);
  if (!spec) return null;
  const feature = spec.points.features.find((f) => f.properties?.key === key);
  if (!feature || feature.geometry.type !== "Point") return null;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  return [lon, lat];
}

export interface ReportMapFeatureInput {
  name: string;
  /** `null` -> drawn with the "no data" fallback color, never omitted from the map. */
  score: number | null;
  /** a custom (drawn) place's decoded geometry. */
  geometry?: AreaGeometry;
  /** a zone place's representative point (no polygon boundary is fetched for the report map --
   * see this module's own review note below). */
  point?: [number, number];
}

/** a FeatureCollection of place polygons/points, `score`/`hasScore` on every feature's properties. */
function placesFeatureCollection(places: readonly ReportMapFeatureInput[]) {
  return {
    type: "FeatureCollection" as const,
    features: places
      .filter((p) => p.geometry || p.point)
      .map((p) => ({
        type: "Feature" as const,
        properties: { name: p.name, score: p.score ?? 0, hasScore: p.score !== null },
        geometry: p.geometry ?? { type: "Point" as const, coordinates: p.point! },
      })),
  };
}

/** a Point per place, at `pointOnSurface()` for a polygon or the supplied point directly -- the
 * label layer's own source, kept separate from the fill/circle source so a label is never clipped
 * to a filled feature's own geometry type. */
function labelsFeatureCollection(places: readonly ReportMapFeatureInput[]) {
  return {
    type: "FeatureCollection" as const,
    features: places
      .filter((p) => p.geometry || p.point)
      .map((p) => ({
        type: "Feature" as const,
        properties: { name: p.name },
        geometry: {
          type: "Point" as const,
          coordinates: p.geometry ? pointOnSurface(p.geometry) : p.point!,
        },
      })),
  };
}

/** the combined bbox over every place that carries one -- `bboxOf` for a polygon, a small box
 * around a zone's representative point. Plain min/max combine (no antimeridian-aware union): correct
 * for the common case of places that do not themselves straddle 180 deg in OPPOSITE senses, which
 * is the shape every fixture and every real report to date actually is. */
export function combinedBbox(
  places: readonly ReportMapFeatureInput[],
): [[number, number], [number, number]] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of places) {
    let box: [number, number, number, number] | null = null;
    if (p.geometry) box = bboxOf(p.geometry);
    else if (p.point)
      box = [p.point[0] - 0.5, p.point[1] - 0.5, p.point[0] + 0.5, p.point[1] + 0.5];
    if (!box) continue;
    x0 = Math.min(x0, box[0]);
    y0 = Math.min(y0, box[1]);
    x1 = Math.max(x1, box[2]);
    y1 = Math.max(y1, box[3]);
  }
  if (!Number.isFinite(x0)) return null;
  return [
    [x0, y0],
    [x1, y1],
  ];
}

/** the maplibre `fill-color`/`circle-color` data expression: the 0-1e stop ramp over `domain`,
 * falling back to {@link REPORT_NODATA_COLOR} for a feature with no score. */
export function scoreColorExpression(stops: PaletteStops, domain: [number, number]): unknown[] {
  const legend: LegendStop[] = legendStops(stops, domain[0], domain[1]);
  const interpolate: unknown[] = ["interpolate", ["linear"], ["get", "score"]];
  for (const s of legend) interpolate.push(s.value, s.color);
  return ["case", ["==", ["get", "hasScore"], false], REPORT_NODATA_COLOR, interpolate];
}

export interface BuildReportMapStyleOptions {
  theme?: "navy" | "paper";
  places: readonly ReportMapFeatureInput[];
  domain: [number, number] | null;
  paletteStops: PaletteStops | null;
}

/**
 * Composes the ONE style this map ever applies: `composeStyle()` (background + positron basemap,
 * theme-driven, `lib/map/style.ts`/`layers/basemap.ts` -- the app's own function, not a copy of
 * it) with three report-specific layers appended on top (places fill/circle by score, and their
 * label layer) -- `composeStyle()` has no notion of "an arbitrary GeoJSON polygon colored by its
 * own data value", so that part is genuinely new, not a restatement of anything existing.
 *
 * ASYNC: `composeStyle()` itself is synchronous (`lib/map/style.ts`'s own header explains why --
 * it never awaits the basemap fetch inline), but the report's map is a ONE-SHOT sequential flow
 * (never a reactive re-compose racing a second one, unlike the shell), so warming the basemap
 * style cache here -- ONCE, before the only `composeStyle()` call this module ever makes -- is
 * both safe and correct: without it, the report's captured map would carry no CARTO layers at
 * all (just the plain background colour) the first time a given theme is used this session.
 * `Report.svelte#mountMap()` already awaits everything else on this path.
 */
export async function buildReportMapStyle(opts: BuildReportMapStyleOptions): Promise<{
  style: StyleSpecification;
}> {
  const theme = opts.theme ?? "paper";
  await loadBasemapStyle(theme);
  const base = composeStyle({ theme, projection: "mercator", zones: [] });
  const color =
    opts.domain && opts.paletteStops
      ? scoreColorExpression(opts.paletteStops, opts.domain)
      : REPORT_NODATA_COLOR;

  const style: StyleSpecification = {
    ...base,
    sources: {
      ...base.sources,
      places: { type: "geojson", data: placesFeatureCollection(opts.places) },
      "place-labels": { type: "geojson", data: labelsFeatureCollection(opts.places) },
    },
    layers: [
      ...base.layers,
      {
        id: "places-fill",
        type: "fill",
        source: "places",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": color as never,
          "fill-opacity": 0.6,
          "fill-outline-color": REPORT_MAP_OUTLINE,
        },
      },
      {
        id: "places-circle",
        type: "circle",
        source: "places",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": color as never,
          "circle-opacity": 0.85,
          "circle-radius": 14,
          "circle-stroke-color": REPORT_MAP_OUTLINE,
          "circle-stroke-width": 1,
        },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "place-labels",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 13,
          "text-font": ["Open Sans Regular"],
        },
        paint: {
          "text-color": REPORT_MAP_LABEL_TEXT,
          "text-halo-color": REPORT_MAP_LABEL_HALO,
          "text-halo-width": 2,
        },
      },
    ],
    // a label layer here always needs glyphs -- report places always carry a `name` (unlike the
    // shell's zone labels, which are conditional on `zonesNeedGlyphs()`), and composeStyle() only
    // sets `glyphs` when ITS OWN zone labels need it -- `GLYPHS_URL` imported (not restated) is
    // the same endpoint it would have used.
    glyphs: base.glyphs ?? GLYPHS_URL,
  };
  return { style };
}

export interface CapturedMapPng {
  dataUrl: string;
  width: number;
  height: number;
}

/** mean and population stdev of 0-255 luminance across a buffer of RGBA pixels. Pure and DOM-free
 * on purpose (CLAUDE.md: core logic lives in an exported, testable function; a canvas readback
 * just calls it) -- `tests/report/reportMap.test.ts` exercises this directly with synthetic pixel
 * arrays, since this repo's vitest environment is `node` (no real canvas to draw a fixture into).
 * The stdev is fix round 2 item 6: a reviewer's captured map was 896x360 of one flat colour -- the
 * hermetic basemap tile has no variation -- and a luminance-only check passed it, because a
 * mid-range flat grey is neither "all black" nor "all white". */
export function luminanceStatsFromRgba(data: ArrayLike<number>): { mean: number; stdev: number } {
  const n = data.length / 4;
  if (n === 0) return { mean: 128, stdev: Number.POSITIVE_INFINITY }; // no pixels -- do not block
  const lum = new Float64Array(n);
  let sum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[j] = l;
    sum += l;
  }
  const mean = sum / n;
  let sq = 0;
  for (let j = 0; j < n; j++) sq += (lum[j] - mean) ** 2;
  return { mean, stdev: Math.sqrt(sq / n) };
}

/** below this, the capture is treated as a flat, single-colour fill rather than real map imagery
 * (a real basemap/zone fill has anti-aliased edges, labels, or multiple colours -- all of which
 * push the stdev well above this floor; a uniform test fixture or a blank tile reads exactly 0). */
const FLAT_STDEV_FLOOR = 2;

/** the pass/fail rule itself, pure (fix round 2, item 6) -- `null` means "accept this capture",
 * otherwise the string is the rejection reason `captureMapPng` throws. */
export function captureRejectionReason(stats: { mean: number; stdev: number }): string | null {
  if (stats.mean < 1 || stats.mean > 254) {
    return `rejected an all-black/all-white capture (luminance ${stats.mean.toFixed(1)})`;
  }
  if (stats.stdev < FLAT_STDEV_FLOOR) {
    return `rejected a flat, single-colour capture (luminance stdev ${stats.stdev.toFixed(2)}, floor ${FLAT_STDEV_FLOOR})`;
  }
  return null;
}

/** cheap 2D-context readback of a live canvas's current pixels, not a WebGL `readPixels` --
 * `preserveDrawingBuffer` already makes `drawImage` from the live canvas safe. */
function luminanceStats(canvas: HTMLCanvasElement): { mean: number; stdev: number } {
  const probe = document.createElement("canvas");
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext("2d");
  if (!ctx) return { mean: 128, stdev: Number.POSITIVE_INFINITY }; // cannot measure -- do not block
  ctx.drawImage(canvas, 0, 0);
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
  return luminanceStatsFromRgba(data);
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** how long to wait for `"idle"` before capturing anyway -- the same bound `styleQueue.ts` uses
 * against a hung tile request (fix round 2, item 6's real root cause, below). */
const CAPTURE_IDLE_FALLBACK_MS = 4_000;

/** a raster tile's fetch can resolve (which is what `"idle"`'s own bookkeeping tracks) before its
 * IMAGE DECODE finishes -- measured, fix round 2 item 6, below. */
const CAPTURE_DECODE_SETTLE_MS = 300;

/**
 * Waits for the NEXT `"idle"`, unconditionally, bounded by a fallback timer (`styleQueue.ts`'s own
 * lesson: MapLibre fires `"idle"` every time the map settles -- repeatedly, for the map's whole
 * life -- but a hung tile request would otherwise mean this never resolves).
 *
 * fix round 2, item 6's REAL bug, found while wiring in this item's own e2e fixture (a real, varied
 * basemap tile the map-PNG-capture assertions could actually tell apart from a flat one -- see
 * e2e/map-hermetic.ts's `variedPng()`): the caller (`Report.svelte#mountMap`) calls `applyStyle()`
 * then `flyToBounds()` (an ANIMATED `flyTo`) right before capturing -- but the old code
 * short-circuited on `map.isStyleLoaded()`, which is true the moment the style's OWN metadata is
 * loaded and says NOTHING about whether the camera is still mid-flight or the destination bounds'
 * tiles have painted yet. That raced: `isStyleLoaded()` often flips true before `flyTo` even starts
 * moving, so the capture fired at (or near) the STARTING view/paint -- a flat, uninteresting frame
 * the old luminance-only guard couldn't tell from a real one.
 *
 * Waiting for the NEXT `"idle"` unconditionally fixes THAT race, but not a second one measured
 * right after: `"idle"`'s own bookkeeping considers a raster tile "loaded" once its network fetch
 * resolves, not once the browser's own (separately async) IMAGE DECODE of those bytes finishes --
 * so a capture taken the instant `"idle"` fires can still read the pre-decode (blank/background)
 * frame. `captureMapPng` calls this TWICE, with {@link CAPTURE_DECODE_SETTLE_MS} of real wall-clock
 * time between the two: the second call almost always resolves immediately (truly idle by then),
 * but gives any in-flight decode the time it measurably needs.
 */
async function waitForIdle(map: { once(ev: "idle", cb: () => void): unknown }): Promise<void> {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    map.once("idle", finish);
    setTimeout(finish, CAPTURE_IDLE_FALLBACK_MS);
  });
}

/**
 * Captures the map as a PNG data URL, after `idle` settles TWICE (see {@link waitForIdle}'s own
 * header for why once is not enough), forcing a repaint and waiting two animation frames first
 * (`calcofi explore review.md` lesson 8) -- then rejects an all-black/all-white capture, AND a
 * flat single-colour one (fix round 2, item 6), rather than shipping a blank print figure silently.
 */
export async function captureMapPng(map: {
  once(ev: "idle", cb: () => void): void;
  triggerRepaint(): void;
  getCanvas(): HTMLCanvasElement;
}): Promise<CapturedMapPng> {
  await waitForIdle(map);
  await new Promise((r) => setTimeout(r, CAPTURE_DECODE_SETTLE_MS));
  await waitForIdle(map);
  map.triggerRepaint();
  await nextFrame();
  await nextFrame();
  const canvas = map.getCanvas();
  const reason = captureRejectionReason(luminanceStats(canvas));
  if (reason) throw new Error(`captureMapPng: ${reason}`);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
