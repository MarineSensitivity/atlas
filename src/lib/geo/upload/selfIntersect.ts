// geo/upload/selfIntersect.ts — does this polygon's outline cross itself, and exactly where?
// (atlas-6 Deliverable 4: "self-intersection check (refuse and mark the crossing)".)
//
// WHY IT MATTERS HERE. coverage.ts fills a row by a scanline with a half-open crossing rule. Over a
// bow-tie that rule is not wrong so much as arbitrary: the two lobes have opposite winding, the
// crossings pair up differently depending on which side of the knot the scanline passes, and the
// answer it gives is a consequence of the sweep's implementation rather than of the shape. So a
// self-crossing outline is refused at the input boundary, with the crossing's coordinates, rather
// than scored into a number nobody can reproduce.
//
// WHY A GRID AND NOT ALL PAIRS. A place may carry 50,000 vertices (Deliverable 4's own cap), and
// every pair of those is 1.25e9 tests. Segments are bucketed by their bounding box into a uniform
// grid of about sqrt(n) cells a side, and only segments sharing a bucket are compared — near-linear
// on the outlines people actually upload, and still exact: two segments that cross necessarily
// share a bucket, because the crossing point lies in both their boxes.
import type { Position, Ring } from "../types";

export interface Crossing {
  /** ring index within the polygon (0 = outer, 1.. = holes) and the vertex the edge LEAVES. */
  a: { ring: number; vertex: number };
  b: { ring: number; vertex: number };
  /** where the two edges meet, in the ring's own (already unwrapped) longitudes. */
  at: Position;
}

interface Seg {
  ring: number;
  vertex: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** vertex count of this segment's ring, for the wrap-adjacency test. */
  n: number;
}

/** at most this many buckets a side; beyond it the index costs more than it saves. */
const MAX_SIDE = 256;

/**
 * The FIRST proper crossing among a polygon's rings, or `null` when the outline is clean.
 *
 * "Proper" means the two edges cross transversally, or overlap along a stretch: two edges that
 * merely touch at a shared endpoint are not reported, because a repeated vertex is common in
 * exported data and refusing it would reject files whose covered area is perfectly well defined.
 *
 * Rings are passed together (outer first, then holes) so a hole cutting through its own outer ring
 * is caught by the same sweep — it is the same defect, and it has the same consequence.
 *
 * Deterministic: the crossing returned is the one with the lowest (ring, vertex) pair, so a
 * refusal message names the same two edges on every run and in every browser.
 */
export function findSelfIntersection(rings: readonly Ring[]): Crossing | null {
  const segs: Seg[] = [];
  rings.forEach((ring, r) => {
    const n = ring.length - 1; // rings arrive closed: the last position repeats the first
    for (let i = 0; i < n; i++) {
      segs.push({
        ring: r,
        vertex: i,
        x0: ring[i][0],
        y0: ring[i][1],
        x1: ring[i + 1][0],
        y1: ring[i + 1][1],
        n,
      });
    }
  });
  if (segs.length < 4) return null;

  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const s of segs) {
    x0 = Math.min(x0, s.x0, s.x1);
    x1 = Math.max(x1, s.x0, s.x1);
    y0 = Math.min(y0, s.y0, s.y1);
    y1 = Math.max(y1, s.y0, s.y1);
  }
  const side = Math.max(1, Math.min(MAX_SIDE, Math.ceil(Math.sqrt(segs.length))));
  const w = Math.max(x1 - x0, Number.EPSILON) / side;
  const h = Math.max(y1 - y0, Number.EPSILON) / side;
  const clamp = (v: number): number => Math.max(0, Math.min(side - 1, v));
  const cellsOf = (s: Seg): number[] => {
    const ja = clamp(Math.floor((Math.min(s.x0, s.x1) - x0) / w));
    const jb = clamp(Math.floor((Math.max(s.x0, s.x1) - x0) / w));
    const ia = clamp(Math.floor((Math.min(s.y0, s.y1) - y0) / h));
    const ib = clamp(Math.floor((Math.max(s.y0, s.y1) - y0) / h));
    const out: number[] = [];
    for (let i = ia; i <= ib; i++) for (let j = ja; j <= jb; j++) out.push(i * side + j);
    return out;
  };

  const index = new Map<number, number[]>();
  segs.forEach((s, k) => {
    for (const c of cellsOf(s)) {
      const list = index.get(c);
      if (list) list.push(k);
      else index.set(c, [k]);
    }
  });

  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    const seen = new Set<number>();
    for (const c of cellsOf(s)) for (const m of index.get(c) ?? []) if (m > k) seen.add(m);
    const others = [...seen].sort((p, q) => p - q);
    for (const m of others) {
      const t = segs[m];
      if (adjacent(s, t)) continue;
      const at = properIntersection(s, t);
      if (at)
        return { a: { ring: s.ring, vertex: s.vertex }, b: { ring: t.ring, vertex: t.vertex }, at };
    }
  }
  return null;
}

/** consecutive edges of the SAME ring share an endpoint by construction, including the wrap. */
function adjacent(s: Seg, t: Seg): boolean {
  if (s.ring !== t.ring) return false;
  const d = Math.abs(s.vertex - t.vertex);
  return d === 1 || d === s.n - 1;
}

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/**
 * A transversal crossing, or a collinear overlap of more than a single point; `null` otherwise.
 *
 * Strict inequalities on both orientation pairs: an endpoint lying exactly ON the other segment (a
 * T-junction) is a touch, not a crossing, and is left alone for the same reason a shared endpoint
 * is — it is common, and the inside of the polygon is still unambiguous.
 */
function properIntersection(s: Seg, t: Seg): Position | null {
  const rx = s.x1 - s.x0;
  const ry = s.y1 - s.y0;
  const ux = t.x1 - t.x0;
  const uy = t.y1 - t.y0;
  const denom = cross(rx, ry, ux, uy);
  const qpx = t.x0 - s.x0;
  const qpy = t.y0 - s.y0;

  if (denom === 0) {
    if (cross(qpx, qpy, rx, ry) !== 0) return null; // parallel, not collinear
    const rr = rx * rx + ry * ry;
    if (rr === 0) return null;
    const t0 = (qpx * rx + qpy * ry) / rr;
    const t1 = t0 + (ux * rx + uy * ry) / rr;
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    if (hi - lo <= 0) return null; // touching at a point, or disjoint
    const mid = (lo + hi) / 2;
    return [s.x0 + mid * rx, s.y0 + mid * ry];
  }

  const a = cross(qpx, qpy, ux, uy) / denom;
  const b = cross(qpx, qpy, rx, ry) / denom;
  if (a <= 0 || a >= 1 || b <= 0 || b >= 1) return null;
  return [s.x0 + a * rx, s.y0 + a * ry];
}
