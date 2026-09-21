// Douglas-Peucker and the two tests that decide whether a simplification may be shipped
// (atlas-2's URL-length ladder): the area must move by no more than 1 % and the ring must stay
// simple. Planar in degrees, like everything else in geo/ — the tolerance in the plan (0.001 deg
// doubling to 0.02 deg) is a degree tolerance, not metres.
import type { Position, Ring } from "./types";

/** perpendicular distance from `p` to the segment a-b, in degrees. */
function segDist(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Douglas-Peucker on a vertex list, keeping the first and last vertex.
 *
 * A closed ring is passed in closed (first === last), so both copies are anchors and the result
 * comes back closed: the ring's start vertex is never the thing that moves.
 */
export function douglasPeucker(pts: Ring, tol: number): Ring {
  if (pts.length <= 2 || tol <= 0) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop() as [number, number];
    let far = -1;
    let best = tol;
    for (let i = lo + 1; i < hi; i++) {
      const d = segDist(pts[i], pts[lo], pts[hi]);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([lo, far], [far, hi]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** do two segments cross at a point interior to both? (touching at a shared endpoint does not) */
function crosses(a: Position, b: Position, c: Position, d: Position): boolean {
  const cross = (p: Position, q: Position, r: Position) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Is a ring free of self-intersections?
 *
 * The ladder needs this because Douglas-Peucker can pull a bay's two shores through each other: the
 * result still has an area, but it is no longer the place the user drew, and the coverage scanline
 * would report a nonsense cell set for it. O(n^2), run only on already-simplified rings.
 */
export function ringIsSimple(ring: Ring): boolean {
  const n = ring.length - 1; // the closing vertex repeats ring[0]
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (i === 0 && j === n - 1) || j === i + 1) continue; // adjacent segments touch
      if (crosses(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false;
    }
  }
  return true;
}
