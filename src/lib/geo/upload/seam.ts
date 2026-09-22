// geo/upload/seam.ts — the OTHER way a file writes a place that crosses the antimeridian, and the
// only cross-ring step in the whole normalizer (atlas-6 Deliverable 4, master plan D8 + ruling 2).
//
// There are exactly two ways the +/-180 line reaches us:
//
//   1. WRAPPED, as one ring that jumps `179.9 -> -179.9`. That is `unwrapRing()`'s case, and
//      `unwrap.ts` is the single shared rule for it (the twin of `msens::unwrap_ring()`). Nothing
//      in this file touches it.
//   2. SPLIT, the RFC 7946 way: the SAME place written as a MultiPolygon of two parts, one ending
//      exactly at +180 and the other starting exactly at -180. `unwrapRing()` cannot repair that —
//      every edge in both halves is already short, and `unwrap.ts` documents why a carry must never
//      run ACROSS rings (it would drag an unrelated part over its neighbour;
//      `normalize-multipolygon-split-global05.json` pins that).
//
// So case 2 gets a rule of its own, and it is deliberately the NARROWEST rule that can do the job:
// it fires only when the geometry contains a vertex at +180 AND a vertex at -180 — the literal
// signature of RFC 7946's antimeridian cut, and nothing else. It never looks at bbox width and
// never guesses from a longitude span, so a place that genuinely spans 340 degrees is left exactly
// as it was written. Framing puts both halves in one continuous frame; stitching then rejoins the
// two rings along the seam edge the cut created, which is simply that cut run backwards: the split
// and wrapped spellings of the same Aleutian rectangle come out as the SAME ring, vertex for
// vertex (`tests/geo/upload/dateline.test.ts`).
import { polygonsOf, type AreaGeometry, type Position, type Ring } from "../types";

/** how close to +/-180 a vertex must be to count as sitting ON the cut. */
export const SEAM_EPS = 1e-9;
/** where the two halves meet once the western half has been carried across. */
export const SEAM_LON = 180;

const near = (a: number, b: number): boolean => Math.abs(a - b) <= SEAM_EPS;

/** does this geometry carry RFC 7946's antimeridian cut — a vertex at +180 and one at -180? */
export function hasSeamSplit(geom: AreaGeometry): boolean {
  let plus = false;
  let minus = false;
  for (const rings of polygonsOf(geom)) {
    for (const ring of rings) {
      for (const [lon] of ring) {
        if (near(lon, 180)) plus = true;
        else if (near(lon, -180)) minus = true;
      }
    }
  }
  return plus && minus;
}

/**
 * Carry every WESTERN vertex a whole turn east, so both halves of a cut place share one frame.
 *
 * Applied only when {@link hasSeamSplit} is true, and applied to whole vertices, not to edges: it
 * is a change of frame, not a change of shape. `-180 -> 180`, `-177 -> 183`, and everything already
 * east of the prime meridian stays exactly where it was.
 */
export function frameSeamSplit(geom: AreaGeometry): AreaGeometry {
  const shift = (ring: Ring): Ring => ring.map(([x, y]) => [x < 0 ? x + 360 : x, y] as Position);
  return mapRings(geom, shift);
}

/**
 * Rejoin rings that share a reversed edge lying on the seam — RFC 7946's cut, run backwards.
 *
 * Two halves of a cut polygon always meet like this: the eastern half walks DOWN the seam where the
 * western half walks UP it, so one ring holds the edge `a -> b` and the other holds `b -> a`, both
 * endpoints at the seam longitude. Splicing the second ring into the first at that edge removes the
 * edge entirely and leaves one outline. The two seam vertices left behind are then collinear with
 * their new neighbours (they were interior points of what used to be a straight run across the cut)
 * and are dropped, which is what makes the result identical to the wrapped spelling rather than
 * merely equivalent to it.
 *
 * Only OUTER rings are joined; each part's holes are carried onto the merged polygon unchanged. A
 * shared edge NOT on the seam is left alone — this rule exists to undo one specific cut, not to
 * dissolve adjacent polygons in general.
 */
export function stitchSeam(geom: AreaGeometry, seamLon: number = SEAM_LON): AreaGeometry {
  const parts = polygonsOf(geom).map((rings) => rings.map((r) => r.slice()));
  if (parts.length < 2) return geom;

  for (let pass = 0; pass < parts.length; pass++) {
    let merged = false;
    outer: for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const join = mergeOnSeam(parts[i][0], parts[j][0], seamLon);
        if (!join) continue;
        parts[i] = [join, ...parts[i].slice(1), ...parts[j].slice(1)];
        parts.splice(j, 1);
        merged = true;
        break outer;
      }
    }
    if (!merged) break;
  }

  return parts.length === 1
    ? { type: "Polygon", coordinates: parts[0] }
    : { type: "MultiPolygon", coordinates: parts };
}

/** the three steps, in order, for a geometry that may have arrived cut at +/-180. */
export function joinSeamSplit(geom: AreaGeometry): AreaGeometry {
  if (!hasSeamSplit(geom)) return geom;
  return stitchSeam(frameSeamSplit(geom));
}

// ---- internals ---------------------------------------------------------------------------------

function mapRings(geom: AreaGeometry, f: (r: Ring) => Ring): AreaGeometry {
  const parts = polygonsOf(geom).map((rings) => rings.map(f));
  return geom.type === "Polygon"
    ? { type: "Polygon", coordinates: parts[0] ?? [] }
    : { type: "MultiPolygon", coordinates: parts };
}

const samePoint = (p: Position, q: Position): boolean => near(p[0], q[0]) && near(p[1], q[1]);

/** a closed ring without its repeated last position. */
const open = (ring: Ring): Ring => {
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) return ring.slice(0, -1);
  return ring.slice();
};

function mergeOnSeam(ringA: Ring, ringB: Ring, seamLon: number): Ring | null {
  const A = open(ringA);
  const B = open(ringB);
  if (A.length < 3 || B.length < 3) return null;

  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const b = A[(i + 1) % A.length];
    if (!near(a[0], seamLon) || !near(b[0], seamLon)) continue;
    for (let k = 0; k < B.length; k++) {
      // the same edge walked the other way: B[k] == b and B[k+1] == a
      if (!samePoint(B[k], b) || !samePoint(B[(k + 1) % B.length], a)) continue;
      const merged: Ring = [];
      for (let m = 0; m <= i; m++) merged.push(A[m]); // ... up to and including a
      for (let m = 2; m < B.length; m++) merged.push(B[(k + m) % B.length]); // B, skipping b and a
      for (let m = i + 1; m < A.length; m++) merged.push(A[m]); // from b onward
      return closeAndDropSeamCollinear(merged, seamLon);
    }
  }
  return null;
}

/** drop the seam vertices the cut introduced (now collinear), then close the ring. */
function closeAndDropSeamCollinear(ring: Ring, seamLon: number): Ring {
  const keep: Ring = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n];
    const c = ring[i];
    const q = ring[(i + 1) % n];
    const collinear =
      near(c[0], seamLon) &&
      Math.abs((c[0] - p[0]) * (q[1] - p[1]) - (c[1] - p[1]) * (q[0] - p[0])) <= SEAM_EPS;
    if (!collinear) keep.push(c);
  }
  const out = keep.length >= 3 ? keep : ring;
  return [...out, [out[0][0], out[0][1]] as Position];
}
