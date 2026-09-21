// atlas-0 S3 spike, display question: is client-side COG display worth a later phase? Renders one
// score COG with deck.gl's `BitmapLayer` (`_imageCoordinateSystem: LNGLAT`) and compares it,
// pixel-for-pixel at 20 probe points, against the same area rendered by titiler's own XYZ tiles at
// z2-z8. Exploratory only -- "No adoption here" (plan S3 paragraph).
import { fromUrl } from "geotiff";
import { Deck, WebMercatorViewport, COORDINATE_SYSTEM } from "@deck.gl/core";
import { BitmapLayer } from "@deck.gl/layers";
import { DISPLAY_METRIC } from "./metrics";
import { lonLatToTile, tileToBBox, type TileBBox } from "./xyz";
import { spectralR, rescale } from "./colormap";

const TILE_PX = 256;

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

async function decodeSourceRaster(): Promise<{ bitmap: ImageBitmap; bbox: [number, number, number, number] }> {
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
    if (!Number.isFinite(v) || v < -1000) {
      rgba[i * 4 + 3] = 0; // nodata -> transparent
      continue;
    }
    const [r, g, b] = spectralR(rescale(v, rescaleMin, rescaleMax));
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  const imageData = new ImageData(rgba, width, height);
  const bitmap = await createImageBitmap(imageData);
  return { bitmap, bbox };
}

// renders the BitmapLayer for exactly the geographic window of one XYZ tile, into a TILE_PX
// canvas, and reads the pixels back via gl.readPixels in onAfterRender (Deck defaults
// preserveDrawingBuffer to true) -- avoids any drawImage/tainted-canvas concern.
function renderDeckTile(source: { bitmap: ImageBitmap; bbox: [number, number, number, number] }, tileBBox: TileBBox): Promise<Uint8ClampedArray> {
  const { longitude, latitude, zoom } = new WebMercatorViewport({ width: TILE_PX, height: TILE_PX }).fitBounds(
    [
      [tileBBox.west, tileBBox.south],
      [tileBBox.east, tileBBox.north],
    ],
    { padding: 0 },
  );
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
          bounds: source.bbox,
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
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
    `?url=${encodeURIComponent(DISPLAY_METRIC.cog)}&colormap_name=spectral_r` +
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

function samplePixel(pixels: Uint8ClampedArray, tileBBox: TileBBox, lon: number, lat: number): [number, number, number, number] {
  const px = Math.min(TILE_PX - 1, Math.max(0, Math.floor(((lon - tileBBox.west) / (tileBBox.east - tileBBox.west)) * TILE_PX)));
  const py = Math.min(TILE_PX - 1, Math.max(0, Math.floor(((tileBBox.north - lat) / (tileBBox.north - tileBBox.south)) * TILE_PX)));
  const i = (py * TILE_PX + px) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

export interface ZoomComparison {
  z: number;
  probes: number;
  maxChannelDelta: number;
  meanChannelDelta: number;
  requests: number;
}

export async function runDisplayComparison(centerLon: number, centerLat: number, zooms: number[]): Promise<{ perZoom: ZoomComparison[]; heapBeforeBytes: number | null; heapAfterBytes: number | null }> {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  const heapBeforeBytes = perf.memory ? perf.memory.usedJSHeapSize : null;

  const source = await decodeSourceRaster();
  const probes = probePoints(centerLon, centerLat);
  const perZoom: ZoomComparison[] = [];

  for (const z of zooms) {
    // group probes by the XYZ tile they fall in at this zoom (usually 1 tile, occasionally more).
    const byTile = new Map<string, { x: number; y: number; pts: ProbePoint[] }>();
    for (const p of probes) {
      const { x, y } = lonLatToTile(p.lon, p.lat, z);
      const key = `${x},${y}`;
      if (!byTile.has(key)) byTile.set(key, { x, y, pts: [] });
      byTile.get(key)!.pts.push(p);
    }
    let deltas: number[] = [];
    let requests = 0;
    for (const { x, y, pts } of byTile.values()) {
      const bbox = tileToBBox(x, y, z);
      const [deckPixels, titilerPixels] = await Promise.all([renderDeckTile(source, bbox), fetchTitilerTilePixels(z, x, y)]);
      requests += 1; // one titiler tile request per unique (z,x,y); deck.gl issues none
      for (const p of pts) {
        const a = samplePixel(deckPixels, bbox, p.lon, p.lat);
        const b = samplePixel(titilerPixels, bbox, p.lon, p.lat);
        for (let c = 0; c < 3; c++) deltas.push(Math.abs(a[c] - b[c]));
      }
    }
    perZoom.push({
      z,
      probes: probes.length,
      maxChannelDelta: deltas.length ? Math.max(...deltas) : NaN,
      meanChannelDelta: deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : NaN,
      requests,
    });
  }

  const heapAfterBytes = perf.memory ? perf.memory.usedJSHeapSize : null;
  return { perZoom, heapBeforeBytes, heapAfterBytes };
}
