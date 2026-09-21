// geo/unwrap.ts — the ONE explicit rule that turns a ring written WRAPPED into a ring whose
// longitudes run continuously (plan D8 addendum, 2026-09-21). The twin of `msens::unwrap_ring()` /
// `unwrap_polygon()` (msens/R/place.R:76-113), and the two sides share the `normalize-*` fixtures.
//
// A polygon crossing the antimeridian is usually WRITTEN wrapped: `179.9` then `-179.9`. Read
// literally — which is what both coverage twins do, every RFC 7946 edge being a Cartesian line in
// lon/lat — that edge runs 359.8 degrees the wrong way round the world and the polygon is its own
// complement: 7,196 cells on global05 instead of 4. The fix is not a guess inside the coverage
// math; it is this rule, applied once at the input boundary.
//
// THE RULE. Walking a ring, whenever consecutive vertices differ by more than 180 degrees of
// longitude, carry -/+360 ONWARD (the shortest-path convention). The carry is a running total, not
// a per-vertex correction: every vertex after a crossing keeps it until a later crossing cancels
// it. The first vertex is never moved, so a ring keeps whichever frame it arrived in; only its
// EDGES are made short. The result may leave [-180, 180] — that is the point, and it is what the
// `g1` codec stores and what `cellsInPolygon()` expects.
//
// WHERE IT RUNS. At every input boundary — an upload or a drawn place (atlas-6's normalizer), the
// codec's encode path — and NEVER inside coverage.ts, which reads coordinates literally and guesses
// nothing. That separation is the whole reason this is its own module with its own fixtures.
//
// THE LIMIT. A ring that genuinely spans MORE than 180 degrees of longitude cannot be expressed
// wrapped: each of its long edges is indistinguishable from a crossing and the shortest-path
// convention turns it inside out. Such a ring must arrive already unwrapped. That is a property of
// the wrapped representation, not of this implementation — R documents the same limit.
import { polygonsOf, type AreaGeometry, type Position, type Ring } from "./types";

/** an edge longer than this in longitude is read as a crossing, not as a real edge. */
export const MAX_LON_STEP = 180;

/**
 * Index of the first vertex reached by an edge that steps more than `MAX_LON_STEP` degrees in
 * longitude, or -1 when the ring is already unwrapped.
 *
 * Only the edges `unwrapRing()` itself walks are considered (vertex i-1 -> i, as the ring is
 * given), so `wrappedEdge(unwrapRing(r)) === -1` holds for every ring — the property the codec's
 * refusal below leans on.
 */
export function wrappedEdge(ring: Ring): number {
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > MAX_LON_STEP) return i;
  }
  return -1;
}

/** does every ring of this geometry already have short edges? */
export function isUnwrapped(geom: AreaGeometry): boolean {
  for (const rings of polygonsOf(geom)) {
    for (const ring of rings) if (wrappedEdge(ring) >= 0) return false;
  }
  return true;
}

/**
 * One ring, unwrapped — `msens::unwrap_ring()` (place.R:76-91), vertex for vertex.
 *
 * The carry runs ON: `d` is measured against the PREVIOUS vertex as already moved, exactly as the R
 * loop compares against `lon[i - 1]` after it was written back. Applying the -/+360 to the current
 * vertex alone and leaving the next one to fend for itself is a different (and wrong) rule — it
 * leaves the second vertex of a two-vertex run on the far side of the line.
 */
export function unwrapRing(ring: Ring): Ring {
  if (ring.length < 2) return ring.map(([x, y]) => [x, y] as Position);
  const out: Ring = [[ring[0][0], ring[0][1]]];
  let carry = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] + carry - out[i - 1][0];
    if (d > MAX_LON_STEP) carry -= 360;
    if (d < -MAX_LON_STEP) carry += 360;
    out.push([ring[i][0] + carry, ring[i][1]]);
  }
  return out;
}

/**
 * Every ring of a Polygon or MultiPolygon, unwrapped — `msens::unwrap_polygon()` (place.R:105-113).
 *
 * HOW A HOLE STAYS IN ITS OUTER RING'S FRAME. Each ring is unwrapped INDEPENDENTLY, from its own
 * first vertex, and no ring's carry ever leaks into the next one. That is what keeps a hole with
 * its outer ring: both arrive in the frame of the same source document, the rule never moves a
 * ring's first vertex, and it only lengthens later vertices by the whole turns their own edges ask
 * for. So an outer ring carried out to 180.2 and a hole sitting at 179.9 both still start in the
 * source frame and still describe the same ground; and a hole that crosses the line itself is
 * carried out to 180.1 by its own edges, landing inside the outer ring exactly as it was drawn.
 * Carrying ACROSS rings instead would drag a multipolygon part on the far side of the line over the
 * top of its neighbour (`normalize-multipolygon-split-global05.json` pins that), and unwrapping only
 * the outer ring would leave a crossing hole reading as the 359.8-degree complement.
 *
 * R does exactly this: `unwrap_polygon()` is `.map_rings(g, unwrap_ring)`, one independent
 * `unwrap_ring()` call per ring with `carry <- 0` re-initialised inside each, and
 * `normalize-hole-outer-crosses-global05.json` is the shared vector for it.
 *
 * The one case neither twin can repair — again a property of the wrapped representation — is a hole
 * written ENTIRELY on the far side of the line (every one of its own edges short, e.g. a hole at
 * -179.9 under an outer ring that unwraps to 179.8...180.2). Nothing local distinguishes it from a
 * hole that really is 360 degrees away, so both sides leave it where it was written.
 */
export function unwrapPolygon(geom: AreaGeometry): AreaGeometry {
  const polys = polygonsOf(geom).map((rings) => rings.map(unwrapRing));
  return geom.type === "Polygon"
    ? { type: "Polygon", coordinates: polys[0] ?? [] }
    : { type: "MultiPolygon", coordinates: polys };
}

/**
 * The single entry point a caller at an input boundary uses — an upload, a drawn place, the codec's
 * encode path — so no caller has to remember the list of steps.
 *
 * Today it is unwrapping alone. atlas-6's normalizer adds its remaining steps HERE (reject
 * projected coordinates, rewind rings to RFC 7946 winding, and the dateline-aware bbox all four
 * upload parsers get wrong — see CLAUDE.md's "Uploads (atlas-6)" rule), so that everything which
 * must happen to geometry before it is analysed happens in one composed function and a new step
 * cannot be added to only some of the callers.
 */
export function normalizeForAnalysis(geom: AreaGeometry): AreaGeometry {
  return unwrapPolygon(geom);
}
