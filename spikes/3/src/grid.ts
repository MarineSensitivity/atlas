// atlas-0 S3 spike: v9 global05 grid math, shared by both candidates and the test spec.
// Grid facts from v9/manifest.json `grid{}` (fetched 2026-09-21; see spikes/3/RESULTS.md):
//   nc=7200, nr=3600, xmin=-180, ymax=90, resx=resy=0.05, lon360=false.
// cell_id = row0*nc + col0 + 1 (1-indexed cell_id, 0-indexed row/col), row0=0 at ymax (north),
// col0=0 at xmin (west) -- verified against v9/tables/cell.parquet (cell_id 1 -> lon -179.975,
// lat 89.975; cell_id 7201 -> lon -179.975, lat 89.925).
export const NC = 7200;
export const NR = 3600;
export const XMIN = -180;
export const YMAX = 90;
export const RES = 0.05;
// tile key from the plan (S3 paragraph / atlas-1): ((cell_id-1)//nc)//50 * (nc//50) +
// ((cell_id-1)%nc)//50 -- the same 2.5deg key `serve/cell_model/tile={t}/` already uses.
export const TILE_CELLS = 50;
export const TILE_COLS = NC / TILE_CELLS; // 144

export interface RowCol {
  row0: number;
  col0: number;
}

export function rowColFromLonLat(lon: number, lat: number): RowCol {
  const col0 = Math.floor((lon - XMIN) / RES);
  const row0 = Math.floor((YMAX - lat) / RES);
  return { row0, col0 };
}

export function cellIdFromRowCol({ row0, col0 }: RowCol): number {
  return row0 * NC + col0 + 1;
}

export function cellIdFromLonLat(lon: number, lat: number): number {
  return cellIdFromRowCol(rowColFromLonLat(lon, lat));
}

export function rowColFromCellId(cellId: number): RowCol {
  const idx = cellId - 1;
  return { row0: Math.floor(idx / NC), col0: idx % NC };
}

export function tileFromRowCol({ row0, col0 }: RowCol): number {
  return Math.floor(row0 / TILE_CELLS) * TILE_COLS + Math.floor(col0 / TILE_CELLS);
}

export function tileFromCellId(cellId: number): number {
  return tileFromRowCol(rowColFromCellId(cellId));
}

export interface RowColRange {
  rowMin: number;
  rowMax: number;
  colMin: number;
  colMax: number;
}

// rasterises an axis-aligned lon/lat bbox against the grid arithmetically (no `cell` table read --
// plan atlas-refs "parity scores app.md" #13.4: "skip the table entirely and rasterise the polygon
// against the grid definition arithmetically"). Inclusive 0-indexed row/col bounds.
export function bboxToRowColRange(lonMin: number, lonMax: number, latMin: number, latMax: number): RowColRange {
  const nw = rowColFromLonLat(lonMin, latMax);
  // subtract an epsilon so an exact-degree max edge doesn't spill into the next row/col
  const se = rowColFromLonLat(lonMax - 1e-9, latMin + 1e-9);
  // a degenerate point (lonMin===lonMax, e.g. a clicked cell landing exactly on a 0.05deg grid
  // line) can send `se` one row/col behind `nw` -- clamp rather than return an empty range.
  return {
    rowMin: nw.row0,
    rowMax: Math.max(nw.row0, se.row0),
    colMin: nw.col0,
    colMax: Math.max(nw.col0, se.col0),
  };
}

export function tilesForRowColRange({ rowMin, rowMax, colMin, colMax }: RowColRange): number[] {
  const tileRowMin = Math.floor(rowMin / TILE_CELLS);
  const tileRowMax = Math.floor(rowMax / TILE_CELLS);
  const tileColMin = Math.floor(colMin / TILE_CELLS);
  const tileColMax = Math.floor(colMax / TILE_CELLS);
  const tiles: number[] = [];
  for (let tr = tileRowMin; tr <= tileRowMax; tr++) {
    for (let tc = tileColMin; tc <= tileColMax; tc++) {
      tiles.push(tr * TILE_COLS + tc);
    }
  }
  return tiles;
}

export function lonLatFromRowCol({ row0, col0 }: RowCol): { lon: number; lat: number } {
  return { lon: XMIN + (col0 + 0.5) * RES, lat: YMAX - (row0 + 0.5) * RES };
}
