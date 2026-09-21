// geo/coverage.ts — polygon -> (cell_id, pct): the twin of `msens::cells_in_polygon_grid()`
// (the grid-only form of msens/R/calc.R's `.cells_in_polygon_db()`, calc.R:124-150).
//
// Planar in degrees, because RFC 7946 edges ARE Cartesian lines in lon/lat and that is the plane
// msens computes `pct_covered` in (calc.R:121-123). Interior cells come from a scanline and are
// 100 by construction; boundary cells are clipped (outer ring minus holes) against the cell square
// and measured by shoelace; the parts of a multipolygon are summed per cell and capped at 1, the
// way msens aggregates per-feature fractions with `pmin(fraction, 1)` (calc.R:97-102); finally
// `pct = roundHalfEven(frac * 100)` — R's round(), half to even — and cells at 0 are dropped.
//
// Frames (atlas-2, plan D8 addendum): a place's longitudes are UNWRAPPED (the codec stores a Bering
// polygon as 170..190) — geo/unwrap.ts is the one rule that puts them that way, it runs at the
// INPUT boundary, and it is deliberately NOT called from here. This file reads coordinates
// literally and guesses nothing about the antimeridian.
//
// What it does do is the arithmetic each grid's own definition requires, per vertex, the twin of
// msens `.frame_ring()` (place.R:130-133): on global05 (7200 x 0.05 = 360, a grid that closes in
// longitude) coordinates are left ALONE and an out-of-range COLUMN folds modulo `nc`, so 180.1
// lands in column 1; on usa05 (`lon360`, a 155.15 deg window from 141.10 E) each vertex is shifted
// into that frame, because -90 simply IS 270 there, and a column still outside 1..nc is DROPPED —
// a modulo there would move the Atlantic into the Pacific.
import { roundHalfEven, snapNoise } from "./round";
import { polygonsOf, type AreaGeometry, type Position, type Ring } from "./types";
import { gridSpansGlobe, type GridSpec } from "../grid/grid";

export interface CellCoverage {
  cell_id: number;
  /** percent of the cell inside the place, 1-100 (a cell that rounds to 0 is not returned) */
  pct: number;
}

/**
 * The raw covered FRACTION per cell (0-1 after the multipolygon cap), before rounding.
 *
 * Exported because the knife-edge fixtures have to be able to state the unrounded number: the whole
 * point of `snapNoise()` below is that this value lands a few 1e-13 either side of an exact half,
 * and a test that could only see the rounded answer could not tell a snapped half from a lucky one.
 */
export function cellFractions(geom: AreaGeometry, grid: GridSpec): Map<number, number> {
  const frac = new Map<number, number>();
  for (const rings of polygonsOf(geom)) accumulate(rings, grid, frac);
  for (const [cellId, f] of frac) if (f > 1) frac.set(cellId, 1);
  return frac;
}

/** cells a place covers, ascending by `cell_id`. */
export function cellsInPolygon(geom: AreaGeometry, grid: GridSpec): CellCoverage[] {
  const frac = cellFractions(geom, grid);

  const out: CellCoverage[] = [];
  for (const [cellId, f] of frac) {
    // snap first, then R's round(): the shoelace sums put a 0.5 % sliver a few 1e-13 either side of
    // the half, and which side it lands on must not decide the answer (R: round(round(x, 9)))
    const pct = roundHalfEven(snapNoise(f * 100));
    if (pct > 0) out.push({ cell_id: cellId, pct });
  }
  return out.sort((a, b) => a.cell_id - b.cell_id);
}

// ---- one polygon (outer ring + holes) -------------------------------------------------------

interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function accumulate(rings: Ring[], grid: GridSpec, frac: Map<number, number>): void {
  if (!rings.length || rings[0].length < 4) return;

  // bring each vertex into the grid's own longitude frame — PER VERTEX, never looking at its
  // neighbours, so this is not an unwrap and cannot act as one by accident. usa05 then sees the
  // Gulf at 270; global05 is left alone (its columns fold instead, see cellIdOf). Byte for byte
  // msens `.frame_ring()`: `xmin + ((lon - xmin) %% 360)`, R's floor-division modulus.
  //
  // Because usa05's frame is cut at 141.10 E rather than at 180, a ring written WRAPPED across the
  // antimeridian comes out contiguous here anyway (4 cells), while on global05 it comes out as the
  // 359.8 deg complement (7,196). That is not a hidden antimeridian rule — it is where the two
  // frames happen to be cut — and it is exactly why wrapped input is out of contract and must go
  // through `normalizeForAnalysis()` first. A ring straddling xmin itself (140 -> 142 on usa05) is
  // torn by the same per-vertex rule, on both sides, for the same reason.
  //
  // The frame branch is taken ONCE per polygon, not once per vertex, and framing is fused into the
  // conversion to index space: a Program Area is 63,417 vertices, and routing each of them through
  // a conditionally-shaped closure measured 4.5 s where this measures ~150 ms.
  //
  // continuous cell-index space: x = column coordinate (cell j spans [j, j+1)), y = row coordinate
  // downwards from ymax. One cell is exactly 1 x 1 here, so a clipped area IS the fraction.
  const { xmin, ymax, resx, resy } = grid;
  const idx: Position[][] = grid.lon360
    ? rings.map((r) =>
        r.map(
          ([lon, lat]) =>
            [(xmin + rmod(lon - xmin, 360) - xmin) / resx, (ymax - lat) / resy] as Position,
        ),
      )
    : rings.map((r) =>
        r.map(([lon, lat]) => [(lon - xmin) / resx, (ymax - lat) / resy] as Position),
      );
  const segs: Seg[] = [];
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const ring of idx) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      segs.push({ x0: ring[j][0], y0: ring[j][1], x1: ring[i][0], y1: ring[i][1] });
      if (ring[i][0] < x0) x0 = ring[i][0];
      if (ring[i][0] > x1) x1 = ring[i][0];
      if (ring[i][1] < y0) y0 = ring[i][1];
      if (ring[i][1] > y1) y1 = ring[i][1];
    }
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return;

  const jMin = Math.floor(x0);
  const jMax = Math.ceil(x1) - 1;
  const iMin = Math.max(0, Math.floor(y0));
  const iMax = Math.min(grid.nr - 1, Math.ceil(y1) - 1);
  if (iMax < iMin || jMax < jMin) return;

  // 1. every cell any edge passes through is a BOUNDARY cell: its coverage is clipped, not assumed
  const boundary = new Map<number, Set<number>>();
  const mark = (i: number, j: number) => {
    if (i < iMin || i > iMax) return;
    let row = boundary.get(i);
    if (!row) boundary.set(i, (row = new Set()));
    row.add(j);
  };
  for (const s of segs) markSegment(s, mark);

  const add = (i: number, j: number, f: number) => {
    const id = cellIdOf(i, j, grid);
    if (id !== null) frac.set(id, (frac.get(id) ?? 0) + f);
  };
  const xs: number[] = [];
  for (let i = iMin; i <= iMax; i++) {
    const row = boundary.get(i);

    // 2. fill the interior of this row. A cell no edge touches is wholly inside or wholly outside,
    // so its centre decides — and the centres of a whole row come from one scanline.
    const yc = i + 0.5;
    xs.length = 0;
    for (const s of segs) {
      // a half-open crossing rule (y0 <= yc < y1 or the reverse) counts a vertex exactly on the
      // scanline once, not twice
      if (s.y0 <= yc !== s.y1 <= yc) xs.push(s.x0 + ((yc - s.y0) * (s.x1 - s.x0)) / (s.y1 - s.y0));
    }
    if (xs.length >= 2) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // cells whose CENTRE (j + 0.5) lies strictly inside the span
        const from = Math.max(jMin, Math.floor(xs[k] - 0.5) + 1);
        const to = Math.min(jMax, Math.ceil(xs[k + 1] - 0.5) - 1);
        for (let j = from; j <= to; j++) if (!row?.has(j)) add(i, j, 1);
      }
    }
    if (!row) continue;

    // 3. boundary cells: clip each ring to the cell square, outer minus holes. The ring is first
    // clipped ONCE to this row's slab, which leaves a handful of vertices for every cell in the row
    // to be clipped against — without it each cell would walk the whole ring, and a Program Area
    // traced at 0.001 deg has thousands of vertices and thousands of boundary cells.
    const slabs = idx.map((ring) => clipSlab(ring, i));
    for (const j of row) {
      if (j < jMin || j > jMax) continue;
      let f = 0;
      for (let k = 0; k < slabs.length; k++) {
        const a = clippedArea(slabs[k], j, i);
        f += k === 0 ? a : -a;
      }
      if (f > 0) add(i, j, Math.min(f, 1));
    }
  }
}

/**
 * R's `%%` on doubles (R's arithmetic.c `myfmod`), which is floor division and NOT C's `fmod`:
 * `x - floor(x/y)*y`, then one guard pass in case that lands exactly on `y`.
 *
 * The distinction is not pedantry. `((x % 360) + 360) % 360` would answer 38.80000000000001 where R
 * answers 38.8 for a positive `x`, because the add-then-subtract of a whole turn is not exact in
 * binary — a 1.4e-14 deg disagreement is enough to move a knife-edge cell across a half.
 */
function rmod(x: number, y: number): number {
  const t = x - Math.floor(x / y) * y;
  const q = Math.floor(t / y);
  return q === 0 ? t : t - q * y;
}

/** cell id from a 0-based (row, column) index pair, or null when it is off this grid. */
function cellIdOf(i: number, j: number, grid: GridSpec): number | null {
  if (i < 0 || i >= grid.nr) return null;
  let col = j;
  if (gridSpansGlobe(grid)) col = ((j % grid.nc) + grid.nc) % grid.nc;
  else if (j < 0 || j >= grid.nc) return null;
  return i * grid.nc + col + 1;
}

/** mark every cell a segment passes through, by walking its grid crossings in order. */
function markSegment(s: Seg, mark: (i: number, j: number) => void): void {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const ts: number[] = [0, 1];
  const push = (a: number, b: number, d: number, at: (k: number) => number) => {
    if (d === 0) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let k = Math.floor(lo) + 1; k <= Math.ceil(hi) - 1; k++) {
      const t = at(k);
      if (t > 0 && t < 1) ts.push(t);
    }
  };
  push(s.x0, s.x1, dx, (k) => (k - s.x0) / dx);
  push(s.y0, s.y1, dy, (k) => (k - s.y0) / dy);
  ts.sort((a, b) => a - b);
  for (let k = 0; k + 1 < ts.length; k++) {
    const t = (ts[k] + ts[k + 1]) / 2;
    mark(Math.floor(s.y0 + t * dy), Math.floor(s.x0 + t * dx));
  }
}

/**
 * One ring clipped to the horizontal slab of row `i`, in index coordinates.
 *
 * Sutherland-Hodgman against a convex window returns the exact intersection REGION for a concave
 * ring too — the output can carry zero-width corridors along the window edge, and a shoelace over
 * those is unaffected, which is all this module asks of it.
 */
function clipSlab(ring: Position[], i: number): Position[] {
  const a = clipHalfPlane(
    ring,
    (p) => p[1] >= i,
    (u, v) => interpY(u, v, i),
  );
  return clipHalfPlane(
    a,
    (p) => p[1] <= i + 1,
    (u, v) => interpY(u, v, i + 1),
  );
}

/**
 * Area of one (slab-clipped) ring inside the cell square [j, j+1] x [i, i+1], in cell units — so
 * the number IS the fraction of the cell covered. The ring is translated to the cell's own corner
 * before the shoelace: over raw index coordinates of several thousand, the sub-1 % areas that
 * decide a `pct` would cancel down into float noise.
 */
function clippedArea(ring: Position[], j: number, i: number): number {
  let poly = clipHalfPlane(
    ring,
    (p) => p[0] >= j,
    (a, b) => interpX(a, b, j),
  );
  poly = clipHalfPlane(
    poly,
    (p) => p[0] <= j + 1,
    (a, b) => interpX(a, b, j + 1),
  );
  if (poly.length < 3) return 0;
  poly = poly.map(([x, y]) => [x - j, y - i] as Position);
  let s = 0;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    s += (poly[m][0] - poly[k][0]) * (poly[m][1] + poly[k][1]);
  }
  return Math.abs(s) / 2;
}

function interpX(a: Position, b: Position, x: number): Position {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}
function interpY(a: Position, b: Position, y: number): Position {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

function clipHalfPlane(
  poly: Position[],
  inside: (p: Position) => boolean,
  cross: (a: Position, b: Position) => Position,
): Position[] {
  if (!poly.length) return poly;
  const out: Position[] = [];
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    const cur = poly[k];
    const prev = poly[m];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(cross(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(cross(prev, cur));
    }
  }
  return out;
}
