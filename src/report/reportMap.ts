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
import { GLYPHS_URL } from "../lib/map/layers/basemap";
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
 */
export function buildReportMapStyle(opts: BuildReportMapStyleOptions): {
  style: StyleSpecification;
} {
  const base = composeStyle({ theme: opts.theme ?? "paper", projection: "mercator", zones: [] });
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

/** mean 0-255 luminance of a canvas's current pixels (cheap 2D-context readback, not a WebGL
 * `readPixels` -- `preserveDrawingBuffer` already makes `drawImage` from the live canvas safe). */
function meanLuminance(canvas: HTMLCanvasElement): number {
  const probe = document.createElement("canvas");
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext("2d");
  if (!ctx) return 128; // cannot measure -- do not block the capture on a missing 2d context
  ctx.drawImage(canvas, 0, 0);
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
  let sum = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4)
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / n;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/**
 * Captures the map as a PNG data URL, after `idle`, forcing a repaint and waiting two animation
 * frames first (`calcofi explore review.md` lesson 8) -- then rejects an all-black/all-white
 * capture rather than shipping a blank print figure silently.
 */
export async function captureMapPng(map: {
  isStyleLoaded(): boolean;
  once(ev: "idle", cb: () => void): void;
  triggerRepaint(): void;
  getCanvas(): HTMLCanvasElement;
}): Promise<CapturedMapPng> {
  await new Promise<void>((resolve) => {
    if (map.isStyleLoaded()) resolve();
    else map.once("idle", () => resolve());
  });
  map.triggerRepaint();
  await nextFrame();
  await nextFrame();
  const canvas = map.getCanvas();
  const luminance = meanLuminance(canvas);
  if (luminance < 1 || luminance > 254) {
    throw new Error(
      `captureMapPng: rejected an all-black/all-white capture (luminance ${luminance.toFixed(1)})`,
    );
  }
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
