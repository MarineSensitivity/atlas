// grid/ — two grids, and `cell_id` means a different place on each.
//
// A verbatim port of msens/R/grid.R (cell_lonlat, cell_from_lonlat, lon_span, lon_span_agg,
// bbox_spans_globe) plus the cell_model partition key from msens/R/cell_model.R
// (cell_model_tile_sql). The line references in each function point at the R twin.
//
// THE SPEC IS ALWAYS READ FROM `boot.grid` (atlas-1's data contract:
// `grid{nc, nr, xmin, ymax, resx, resy, lon360, tile{size:50}}`), never from a constant in here.
// usa05 (v1-v7) is 3103 x 2006 from xmin 141.10 on a 0-360 frame; global05 (v8+) is 7200 x 3600
// from -180. Hardcoding either one is how v7 ids get painted on v8's grid and land in the wrong
// ocean (grid.R:1-23), so this module has no grid literals at all.

export interface GridSpec {
  /** informational: `usa05` | `global05`, from `manifest.grid_id` / `boot.grid_id` when present */
  gridId: string | null;
  nc: number;
  nr: number;
  xmin: number;
  ymax: number;
  resx: number;
  resy: number;
  /** the grid stores its own 0-360 longitudes (usa05) */
  lon360: boolean;
  /** cells per side of a `cell_model` partition tile (`boot.grid.tile.size`), or null when absent */
  tileSize: number | null;
}

function num(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new Error(`boot.grid: '${k}' must be a finite number, got ${JSON.stringify(v)}`);
  return v;
}

/**
 * Read a grid spec out of a boot.json-shaped object.
 *
 * Accepts the whole `boot` (`{grid_id, grid:{...}}`) or the bare `boot.grid`. Anything missing is
 * an error, never a default: a silently-defaulted `nc` is indistinguishable from a correct one and
 * scatters a release's cells across the wrong ocean.
 */
export function gridFromBoot(boot: unknown): GridSpec {
  if (!boot || typeof boot !== "object") throw new Error("boot.grid: expected an object");
  const b = boot as Record<string, unknown>;
  const g = (b.grid && typeof b.grid === "object" ? b.grid : b) as Record<string, unknown>;
  const tile = g.tile as Record<string, unknown> | undefined;
  const tileSize = tile && typeof tile.size === "number" ? tile.size : null;
  const gridId =
    typeof b.grid_id === "string" ? b.grid_id : typeof g.grid_id === "string" ? g.grid_id : null;
  return {
    gridId,
    nc: num(g, "nc"),
    nr: num(g, "nr"),
    xmin: num(g, "xmin"),
    ymax: num(g, "ymax"),
    resx: num(g, "resx"),
    resy: num(g, "resy"),
    lon360: g.lon360 === true,
    tileSize,
  };
}

/** does this grid's columns cover the whole 360 deg of longitude (global05 yes, usa05 no)? */
export function gridSpansGlobe(grid: GridSpec): boolean {
  return Math.abs(grid.nc * grid.resx - 360) < 1e-9;
}

/**
 * Cell id at a longitude/latitude — `msens::cell_from_lonlat()` (grid.R:219-245).
 *
 * Row uses `ceiling`, column `floor + 1`; the asymmetry only shows exactly on a cell boundary and
 * it is what matches GDAL there for global05. Validity is a question about the COORDINATES, not
 * about clamped indices, so a point north of the grid is null rather than row 1.
 */
export function cellFromLonLat(lon: number, lat: number, grid: GridSpec): number | null {
  // a 0-360 grid stores its own frame, so bring a -180..180 click into it (grid.R:221)
  let x = lon;
  if (grid.lon360 && x < grid.xmin) x = x + 360;
  const ymin = grid.ymax - grid.nr * grid.resy;
  const xmax = grid.xmin + grid.nc * grid.resx;
  const col = Math.floor((x - grid.xmin) / grid.resx) + 1;
  let row = Math.ceil((grid.ymax - lat) / grid.resy);
  // the top edge is row 1, not row 0; every other row already lands correctly (grid.R:238)
  if (row === 0 && lat <= grid.ymax) row = 1;
  const ok =
    x >= grid.xmin &&
    x < xmax &&
    lat <= grid.ymax &&
    lat > ymin &&
    col >= 1 &&
    col <= grid.nc &&
    row >= 1 &&
    row <= grid.nr;
  return ok ? (row - 1) * grid.nc + col : null;
}

/**
 * Longitude/latitude of a cell centre — `msens::cell_lonlat()` (grid.R:116-127).
 *
 * Row-major, 1-based, top-left origin. `wrap = false` keeps a 0-360 grid in its OWN frame, which an
 * EXTENT needs: a wrapped Alaska spans -180..180 and its bounding box comes out as the whole globe.
 */
export function cellLonLat(
  cellId: number,
  grid: GridSpec,
  wrap = true,
): { lon: number; lat: number } {
  const row = Math.floor((cellId - 1) / grid.nc) + 1;
  const col = ((cellId - 1) % grid.nc) + 1;
  let lon = grid.xmin + (col - 0.5) * grid.resx;
  if (grid.lon360 && wrap && lon >= 180) lon = lon - 360;
  return { lon, lat: grid.ymax - (row - 0.5) * grid.resy };
}

/**
 * The `cell_model` spatial partition a cell belongs to — `msens::cell_model_tile_sql()`
 * (cell_model.R:71-78): `((id-1)//nc)//side * (nc//side) + ((id-1)%nc)//side`.
 *
 * The width MUST be this grid's `nc`: a wrong `nc` is still a valid tile id, so `tile IN (...)`
 * silently prunes away the very rows being sought (cell_model.R:30-33).
 */
export function tileOf(cellId: number, grid: GridSpec): number {
  if (grid.tileSize === null)
    throw new Error("boot.grid has no tile.size: a tile id cannot be guessed");
  const side = grid.tileSize;
  const nAcross = Math.floor(grid.nc / side);
  const k = cellId - 1;
  return Math.floor(Math.floor(k / grid.nc) / side) * nAcross + Math.floor((k % grid.nc) / side);
}

/**
 * Minimal longitude span of aggregates already computed elsewhere — `msens::lon_span_agg()`
 * (grid.R:175-185). Measure the span in both frames and keep the narrower, unless the 0-360 frame
 * is itself circumglobal (>= 350 deg), in which case say the whole globe plainly so
 * `bboxSpansGlobe()` can reject it.
 */
export function lonSpanAgg(x0: number, x1: number, w0: number, w1: number): [number, number] {
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return [NaN, NaN];
  if (!Number.isFinite(w0) || !Number.isFinite(w1)) return [x0, x1];
  return w1 - w0 < x1 - x0 && w1 - w0 < 350 ? [w0, w1] : [x0, x1];
}

/**
 * Minimal longitude span of a set of longitudes — `msens::lon_span()` (grid.R:155-160).
 * The returned `xmax` may exceed 180: that is deliberate, and it is what `map.fitBounds()` wants.
 */
export function lonSpan(lon: number[]): [number, number] {
  const l = lon.filter((v) => Number.isFinite(v));
  if (!l.length) return [NaN, NaN];
  const l360 = l.map((v) => (v < 0 ? v + 360 : v));
  return lonSpanAgg(Math.min(...l), Math.max(...l), Math.min(...l360), Math.max(...l360));
}

/**
 * Does a bounding box span so much longitude that it cannot frame anything? —
 * `msens::bbox_spans_globe()` (grid.R:200-203). A whole-world extent is a legitimate answer for an
 * ASSET and a useless one for a CAMERA.
 */
export function bboxSpansGlobe(bb: number[] | null | undefined, maxSpan = 350): boolean {
  if (!bb || bb.length !== 4 || !bb.every((v) => Number.isFinite(v))) return true;
  return bb[2] - bb[0] >= maxSpan;
}
