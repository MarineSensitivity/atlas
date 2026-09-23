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
// Map CONSTRUCTION goes through `./mapWiring.ts`'s own `createReportMap()`, never
// `lib/map/map.ts#createMap()` -- see that file's header for why: `lib/map/map.ts` (and
// `lib/map/layers/zones.ts`, `layers/basemap.ts`, ...) are reachable STATICALLY from index.html
// already, so report.html importing any of them too would share a Rollup chunk with index.html's
// own entry and grow ITS committed static-budget baseline with code only report.html needs
// (measured, before this file existed in its current form: +6.3 KB gzip). This module's basemap
// tile URL and its `zonePointFromBoot()` below are therefore small, deliberate re-statements of
// two `lib/map/layers/{basemap,zones}.ts` facts, not imports of those files.
import type { AreaGeometry } from "../lib/geo/types";
import { bboxOf } from "../lib/geo/types";
import { pointOnSurface } from "./pointOnSurface";
import type { LegendStop, PaletteStops } from "../lib/raster/ramps";
import { legendStops } from "../lib/raster/ramps";
import {
  REPORT_MAP_BACKGROUND,
  REPORT_MAP_LABEL_HALO,
  REPORT_MAP_LABEL_TEXT,
  REPORT_MAP_OUTLINE,
  REPORT_NODATA_COLOR,
} from "./colors";

interface RawZoneLabelRow {
  key?: unknown;
  label_pt?: unknown;
}

function labelPointOf(raw: unknown): [number, number] | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const [lon, lat] = raw;
    return typeof lon === "number" && typeof lat === "number" ? [lon, lat] : null;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const lon = typeof o.lon === "number" ? o.lon : typeof o.lng === "number" ? o.lng : null;
    const lat = typeof o.lat === "number" ? o.lat : null;
    return lon !== null && lat !== null ? [lon, lat] : null;
  }
  return null;
}

/**
 * `boot.zones[unit][key].label_pt`, unwrapped past 180 deg the same way
 * `lib/map/layers/zones.ts#zoneLabelsFromBoot` does -- restated here rather than imported (this
 * module's own header explains why). `null` for a release that publishes no label point for this
 * zone (the report simply omits that place from the map rather than guessing a centroid).
 */
export function zonePointFromBoot(
  boot: unknown,
  unit: string,
  key: string,
): [number, number] | null {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return null;
  const row = (rows as RawZoneLabelRow[]).find((r) => r && String(r.key) === key);
  const pt = labelPointOf(row?.label_pt);
  if (!pt) return null;
  return [pt[0] > 180 ? pt[0] - 360 : pt[0], pt[1]];
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

// CARTO's keyless positron raster basemap -- the SAME endpoint `lib/map/layers/basemap.ts` uses
// for the `paper` theme, but NOT imported from there: that module is reachable STATICALLY from
// index.html (Shell.svelte), so report.html importing it too would pull it (and everything it
// transitively imports) into a chunk SHARED with index.html's own entry, growing index.html's
// static critical path with code only report.html needs (measured: +6.3 KB gzip before this
// module existed -- see mapWiring.ts's header, which this file's basemap section mirrors for the
// identical reason). Two literal constants, kept in sync by eye rather than by import, is the
// accepted cost of report.html and index.html sharing ONE `vite build` graph
// (`tests/size-budget-gallery-isolation.test.ts` pins that they must).
const REPORT_BASEMAP_TILES = ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"];
const REPORT_BASEMAP_ATTRIBUTION = "© OpenStreetMap contributors © CARTO";

/** composes the ONE style this map ever applies -- background, positron basemap, the places
 * fill/circle layers, and their label layer. Built by hand (not `map/style.ts#composeStyle`,
 * which is shaped around the shell's PMTiles zone/raster inputs): a standalone report page with
 * one GeoJSON source has no need for that machinery, and "exactly one composed style, applied
 * once" holds trivially for a page that never calls `setStyle` a second time. */
export function buildReportMapStyle(opts: BuildReportMapStyleOptions) {
  const basemap = {
    id: "basemap",
    tiles: REPORT_BASEMAP_TILES,
    tileSize: 256,
    maxzoom: 20,
    attribution: REPORT_BASEMAP_ATTRIBUTION,
  };
  const color =
    opts.domain && opts.paletteStops
      ? scoreColorExpression(opts.paletteStops, opts.domain)
      : REPORT_NODATA_COLOR;

  const style = {
    version: 8 as const,
    projection: { type: "mercator" as const }, // a static print/export map never wants a globe crop
    sources: {
      [basemap.id]: {
        type: "raster" as const,
        tiles: [...basemap.tiles],
        tileSize: basemap.tileSize,
        maxzoom: basemap.maxzoom,
        attribution: basemap.attribution,
      },
      places: { type: "geojson" as const, data: placesFeatureCollection(opts.places) },
      "place-labels": { type: "geojson" as const, data: labelsFeatureCollection(opts.places) },
    },
    layers: [
      {
        id: "background",
        type: "background" as const,
        paint: { "background-color": REPORT_MAP_BACKGROUND },
      },
      {
        id: basemap.id,
        type: "raster" as const,
        source: basemap.id,
        paint: { "raster-opacity": 1 },
      },
      {
        id: "places-fill",
        type: "fill" as const,
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
        type: "circle" as const,
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
        type: "symbol" as const,
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
    glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
  };
  return { style, attribution: REPORT_BASEMAP_ATTRIBUTION };
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
