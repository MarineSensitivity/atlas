// atlas-0 S3 spike, candidate (b): `geotiff` 3.x window reads straight from the published Float32
// score COGs (plan S3 paragraph) -- one `fromUrl` + one windowed `readRasters` per rescaled
// component, no bulk download, no DuckDB.
import { fromUrl, type GeoTIFFImage } from "geotiff";
import { RESCALED_METRICS } from "./metrics";
import type { Case } from "./cases";

export interface PixelWindow {
  colMin: number;
  colMax: number; // inclusive
  rowMin: number;
  rowMax: number; // inclusive
  west: number;
  north: number;
  xres: number;
  yres: number;
}

// pixel window computed from the COG's OWN georeferencing (bounding box + width/height), not the
// hardcoded global-grid constants in grid.ts -- these score COGs are cropped to the scored
// latitude band (v9: height 2001, not nr=3600), so only the resolution (0.05deg) is shared with
// the cell grid, not the origin/row-0 offset.
export function pixelWindowForBBox(
  image: GeoTIFFImage,
  lonMin: number,
  lonMax: number,
  latMin: number,
  latMax: number,
  offsetRows = 0,
  offsetCols = 0,
): PixelWindow {
  const [west, south, east, north] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const xres = (east - west) / width;
  const yres = (north - south) / height;
  // this COG's own bounds are not exactly +-180/xmin (observed west=-180.00000610436345 on v9's
  // extrisk_bird_ecoregion_rescaled COG, not -180 -- sub-pixel float64 drift, ~6e-5 px at our test
  // longitudes). A bare `floor()` flips to the wrong pixel for any edge sitting exactly on a
  // 0.05deg grid line (which every test bbox here does) depending on which side of that drift the
  // float64 division lands on. PIXEL_EPS (in pixel units, not degrees) is >>10x the observed drift
  // and <<1 pixel, so it snaps back to the intended integer without masking a real fractional
  // pixel position.
  const PIXEL_EPS = 1e-3;
  let colMin = Math.floor((lonMin - west) / xres + PIXEL_EPS);
  let colMax = Math.floor((lonMax - west) / xres - PIXEL_EPS);
  let rowMin = Math.floor((north - latMax) / yres + PIXEL_EPS);
  let rowMax = Math.floor((north - latMin) / yres - PIXEL_EPS);
  if (colMax < colMin) colMax = colMin;
  if (rowMax < rowMin) rowMax = rowMin;
  return {
    colMin: colMin + offsetCols,
    colMax: colMax + offsetCols,
    rowMin: rowMin + offsetRows,
    rowMax: rowMax + offsetRows,
    west,
    north,
    xres,
    yres,
  };
}

export interface CandidateBValue {
  metricSeq: number;
  metricKey: string;
  win: PixelWindow;
  widthPx: number;
  heightPx: number;
  data: Float32Array;
}

export interface CandidateBResult {
  ms: number;
  values: CandidateBValue[];
}

export async function runCandidateB(kase: Case, rowColOffset = 0): Promise<CandidateBResult> {
  const t0 = performance.now();
  const values: CandidateBValue[] = [];
  for (const m of RESCALED_METRICS) {
    const tiff = await fromUrl(m.cog);
    const image = await tiff.getImage();
    const win = pixelWindowForBBox(image, kase.lonMin, kase.lonMax, kase.latMin, kase.latMax, rowColOffset, 0);
    const widthPx = win.colMax - win.colMin + 1;
    const heightPx = win.rowMax - win.rowMin + 1;
    const rasters = await image.readRasters({
      window: [win.colMin, win.rowMin, win.colMax + 1, win.rowMax + 1],
    });
    const data = (rasters as unknown as Float32Array[])[0];
    values.push({ metricSeq: m.metricSeq, metricKey: m.metricKey, win, widthPx, heightPx, data });
  }
  const ms = performance.now() - t0;
  return { ms, values };
}
