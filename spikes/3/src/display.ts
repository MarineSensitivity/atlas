// atlas-0 S3 spike, display question: is client-side COG display worth a later phase? Renders one
// score COG with deck.gl's `BitmapLayer` (`_imageCoordinateSystem: LNGLAT`) and compares it,
// pixel-for-pixel at 20 probe points, against the same area rendered by titiler's own XYZ tiles at
// z2-z8. Exploratory only -- "No adoption here" (plan S3 paragraph).
//
// Fix round 1 (task 1): both sides now use a colormap that is IDENTICAL BY CONSTRUCTION, not an
// approximation, so the measured deltas are alignment/resampling only:
//   - titiler: `colormap_name=gray&resampling=nearest` (matplotlib's linear grayscale ramp, NOT
//     `greys` -- see colormap.ts's note; titiler defaults to nearest resampling already, passed
//     explicitly here so it's on the record).
//   - deck.gl: `colormap.linearGray()` (the same closed-form ramp) plus
//     `textureParameters: {minFilter: 'nearest', magFilter: 'nearest'}` on the `BitmapLayer` so
//     its WebGL sampler does not bilinearly blend across pixel edges either.
import { fromUrl } from "geotiff";
import { Deck, WebMercatorViewport, COORDINATE_SYSTEM } from "@deck.gl/core";
import { BitmapLayer } from "@deck.gl/layers";
import { DISPLAY_METRIC } from "./metrics";
import { lonLatToTile, tileToBBox, type TileBBox } from "./xyz";
import { linearGray, rescale } from "./colormap";

const TILE_PX = 256;
const NODATA_THRESHOLD = -1000; // COG nodata sentinel is -9999; anything this low is nodata

export interface ProbePoint {
  lon: number;
  lat: number;
}

// 20 fixed points clustered around the click case's center so they stay inside the same z8 tile
// (a slippy tile at z8 spans ~1.4deg; this cluster spans 0.6deg) -- deterministic, not random.
export function probePoints(centerLon: number, centerLat: number): ProbePoint[] {
  const points: ProbePoint[] = [];
  const ring = [
    [0, 0],
    [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3],
    [0.3, 0.3], [0.3, -0.3], [-0.3, 0.3], [-0.3, -0.3],
    [0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15],
    [0.15, 0.15], [0.15, -0.15], [-0.15, 0.15], [-0.15, -0.15],
    [0.3, 0.15], [-0.3, -0.15], [0.15, 0.3],
  ];
  for (const [dLon, dLat] of ring) points.push({ lon: centerLon + dLon, lat: centerLat + dLat });
  return points.slice(0, 20);
}

interface SourceRaster {
  bitmap: ImageBitmap;
  bbox: [number, number, number, number]; // west, south, east, north
  width: number;
  height: number;
  data: Float32Array;
}

async function decodeSourceRaster(): Promise<SourceRaster> {
  const tiff = await fromUrl(DISPLAY_METRIC.cog);
  const image = await tiff.getImage();
  const bbox = image.getBoundingBox() as [number, number, number, number];
  const width = image.getWidth();
  const height = image.getHeight();
  const rasters = await image.readRasters();
  const data = (rasters as unknown as Float32Array[])[0];
  const rgba = new Uint8ClampedArray(width * height * 4);
  const { rescaleMin, rescaleMax } = DISPLAY_METRIC;
  for (let i = 0; i < width * height; i++) {
    const v = data[i];
    if (!Number.isFinite(v) || v < NODATA_THRESHOLD) {
      rgba[i * 4 + 3] = 0; // nodata -> transparent, matches titiler's own nodata rendering (verified)
      continue;
    }
    const grey = linearGray(rescale(v, rescaleMin, rescaleMax));
    rgba[i * 4] = grey;
    rgba[i * 4 + 1] = grey;
    rgba[i * 4 + 2] = grey;
    rgba[i * 4 + 3] = 255;
  }
  const imageData = new ImageData(rgba, width, height);
  const bitmap = await createImageBitmap(imageData);
  return { bitmap, bbox, width, height, data };
}

// true if the probe's own native source pixel, or any of its 8 neighbours, is nodata -- "sits on
// a data edge / nodata boundary" per the fix-round-1 ask, vs. "interior" (surrounded by real data
// on all sides, where a real misalignment reads a materially different value, not just a
// coastline/no-coverage transition).
function isNearNodataEdge(source: SourceRaster, lon: number, lat: number): boolean {
  const [west, , , north] = source.bbox;
  const xres = (source.bbox[2] - source.bbox[0]) / source.width;
  const yres = (source.bbox[3] - source.bbox[1]) / source.height;
  const col = Math.floor((lon - west) / xres);
  const row = Math.floor((north - lat) / yres);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= source.height || c < 0 || c >= source.width) return true; // off raster
      const v = source.data[r * source.width + c];
      if (!Number.isFinite(v) || v < NODATA_THRESHOLD) return true;
    }
  }
  return false;
}

// shifts a bbox east/north by `shiftCells` native (0.05deg) grid cells -- the seeded fault: a
// `BitmapLayer` whose `bounds` do not exactly match the source image's true geographic bounds
// (an off-by-N-cell CRS/bounds bug).
function shiftBoundsCells(bbox: [number, number, number, number], shiftCells: number): [number, number, number, number] {
  const cellDeg = 0.05;
  const d = shiftCells * cellDeg;
  return [bbox[0] + d, bbox[1] + d, bbox[2] + d, bbox[3] + d];
}

// renders the BitmapLayer for exactly the geographic window of one XYZ tile, into a TILE_PX
// canvas, and reads the pixels back via gl.readPixels in onAfterRender (Deck defaults
// preserveDrawingBuffer to true) -- avoids any drawImage/tainted-canvas concern.
function renderDeckTile(source: SourceRaster, tileBBox: TileBBox, boundsShiftCells: number): Promise<Uint8ClampedArray> {
  const { longitude, latitude, zoom } = new WebMercatorViewport({ width: TILE_PX, height: TILE_PX }).fitBounds(
    [
      [tileBBox.west, tileBBox.south],
      [tileBBox.east, tileBBox.north],
    ],
    { padding: 0 },
  );
  const bounds = shiftBoundsCells(source.bbox, boundsShiftCells);
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = TILE_PX;
    canvas.height = TILE_PX;
    const deck = new Deck({
      canvas,
      width: TILE_PX,
      height: TILE_PX,
      viewState: { longitude, latitude, zoom, pitch: 0, bearing: 0 },
      layers: [
        new BitmapLayer({
          id: "score-cog",
          image: source.bitmap,
          bounds,
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          // nearest-neighbour on the deck.gl side too, matching titiler's `resampling=nearest` --
          // otherwise WebGL's default bilinear sampler blends across pixel edges and any delta
          // would mix "misaligned" with "smoothed".
          textureParameters: { minFilter: "nearest", magFilter: "nearest" },
        }),
      ],
      onError: (err) => reject(err),
      onAfterRender: ({ gl }) => {
        const pixels = new Uint8Array(TILE_PX * TILE_PX * 4);
        gl.readPixels(0, 0, TILE_PX, TILE_PX, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        deck.finalize();
        // WebGL's row 0 is the bottom of the framebuffer; flip to top-left-origin image order.
        const flipped = new Uint8ClampedArray(pixels.length);
        for (let y = 0; y < TILE_PX; y++) {
          const src = pixels.subarray((TILE_PX - 1 - y) * TILE_PX * 4, (TILE_PX - y) * TILE_PX * 4);
          flipped.set(src, y * TILE_PX * 4);
        }
        resolve(flipped);
      },
    });
  });
}

async function fetchTitilerTilePixels(z: number, x: number, y: number): Promise<Uint8ClampedArray> {
  const url =
    `https://titiler-v8.marinesensitivity.org/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.png` +
    `?url=${encodeURIComponent(DISPLAY_METRIC.cog)}&colormap_name=gray&resampling=nearest` +
    `&rescale=${DISPLAY_METRIC.rescaleMin},${DISPLAY_METRIC.rescaleMax}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`titiler tile ${z}/${x}/${y} -> HTTP ${resp.status}`);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data as unknown as Uint8ClampedArray;
}

// single grey level (0-255) at a lon/lat within a rendered TILE_PX x TILE_PX buffer; alpha<255
// (nodata/transparent) is reported as null -- not a comparable grey value.
function sampleGrey(pixels: Uint8ClampedArray, tileBBox: TileBBox, lon: number, lat: number): number | null {
  const px = Math.min(TILE_PX - 1, Math.max(0, Math.floor(((lon - tileBBox.west) / (tileBBox.east - tileBBox.west)) * TILE_PX)));
  const py = Math.min(TILE_PX - 1, Math.max(0, Math.floor(((tileBBox.north - lat) / (tileBBox.north - tileBBox.south)) * TILE_PX)));
  const i = (py * TILE_PX + px) * 4;
  if (pixels[i + 3] < 255) return null;
  return pixels[i];
}

export interface ProbeRecord {
  lon: number;
  lat: number;
  deckGrey: number | null;
  titilerGrey: number | null;
  delta: number | null; // null if either side was nodata at this probe
  edge: boolean; // near a nodata boundary in the source raster, vs. interior
}

export interface ZoomComparison {
  z: number;
  probes: number;
  compared: number; // probes where both sides had real (non-nodata) grey values
  maxDelta: number;
  meanDelta: number;
  worst: ProbeRecord[]; // the probes at/near maxDelta, for edge-vs-interior inspection
  requests: number;
}

async function compareAtZoom(source: SourceRaster, probes: (ProbePoint & { edge: boolean })[], z: number, boundsShiftCells: number): Promise<ZoomComparison> {
  const byTile = new Map<string, { x: number; y: number; pts: (ProbePoint & { edge: boolean })[] }>();
  for (const p of probes) {
    const { x, y } = lonLatToTile(p.lon, p.lat, z);
    const key = `${x},${y}`;
    if (!byTile.has(key)) byTile.set(key, { x, y, pts: [] });
    byTile.get(key)!.pts.push(p);
  }
  const records: ProbeRecord[] = [];
  let requests = 0;
  for (const { x, y, pts } of byTile.values()) {
    const bbox = tileToBBox(x, y, z);
    const [deckPixels, titilerPixels] = await Promise.all([renderDeckTile(source, bbox, boundsShiftCells), fetchTitilerTilePixels(z, x, y)]);
    requests += 1;
    for (const p of pts) {
      const deckGrey = sampleGrey(deckPixels, bbox, p.lon, p.lat);
      const titilerGrey = sampleGrey(titilerPixels, bbox, p.lon, p.lat);
      const delta = deckGrey !== null && titilerGrey !== null ? Math.abs(deckGrey - titilerGrey) : null;
      records.push({ lon: p.lon, lat: p.lat, deckGrey, titilerGrey, delta, edge: p.edge });
    }
  }
  const compared = records.filter((r) => r.delta !== null);
  const maxDelta = compared.length ? Math.max(...compared.map((r) => r.delta!)) : NaN;
  const meanDelta = compared.length ? compared.reduce((s, r) => s + r.delta!, 0) / compared.length : NaN;
  const worst = compared
    .slice()
    .sort((a, b) => b.delta! - a.delta!)
    .slice(0, 5);
  return { z, probes: probes.length, compared: compared.length, maxDelta, meanDelta, worst, requests };
}

export async function runDisplayComparison(
  centerLon: number,
  centerLat: number,
  zooms: number[],
  boundsShiftCells = 0,
): Promise<{ perZoom: ZoomComparison[]; heapBeforeBytes: number | null; heapAfterBytes: number | null }> {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  const heapBeforeBytes = perf.memory ? perf.memory.usedJSHeapSize : null;

  const source = await decodeSourceRaster();
  const probes = probePoints(centerLon, centerLat).map((p) => ({ ...p, edge: isNearNodataEdge(source, p.lon, p.lat) }));
  const perZoom: ZoomComparison[] = [];
  for (const z of zooms) perZoom.push(await compareAtZoom(source, probes, z, boundsShiftCells));

  const heapAfterBytes = perf.memory ? perf.memory.usedJSHeapSize : null;
  return { perZoom, heapBeforeBytes, heapAfterBytes };
}

// the fix-round-1 gate: max delta among INTERIOR probes only (edge/nodata-boundary probes
// excluded -- a coastline mismatch is not a misalignment finding) at one representative zoom.
export async function runInteriorGate(centerLon: number, centerLat: number, z: number, boundsShiftCells = 0): Promise<{ n: number; maxInteriorDelta: number }> {
  const source = await decodeSourceRaster();
  const probes = probePoints(centerLon, centerLat).map((p) => ({ ...p, edge: isNearNodataEdge(source, p.lon, p.lat) }));
  const interior = probes.filter((p) => !p.edge);
  const zc = await compareAtZoom(source, interior, z, boundsShiftCells);
  return { n: zc.compared, maxInteriorDelta: zc.maxDelta };
}
