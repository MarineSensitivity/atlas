// Plain GeoJSON area geometry, shared by the place codec and the coverage math (atlas-2).
// RFC 7946 edges are Cartesian lines in lon/lat, and that is how both modules treat them: planar
// degrees, no geodesics, no projection — the same plane msens computes pct_covered in.

export type Position = [number, number];
export type Ring = Position[];

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: Ring[];
}
export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: Ring[][];
}
export type AreaGeometry = PolygonGeometry | MultiPolygonGeometry;

/** every polygon of a geometry, as a list of rings (outer first, then holes). */
export function polygonsOf(g: AreaGeometry): Ring[][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

export function isAreaGeometry(g: unknown): g is AreaGeometry {
  if (!g || typeof g !== "object") return false;
  const t = (g as { type?: unknown }).type;
  const c = (g as { coordinates?: unknown }).coordinates;
  return (t === "Polygon" || t === "MultiPolygon") && Array.isArray(c);
}

/** twice the signed shoelace area of a ring, in squared degrees; sign follows the winding. */
export function ringArea2(ring: Ring): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return s;
}

/** planar area in squared degrees: outer rings minus holes, winding-agnostic. */
export function geometryArea(g: AreaGeometry): number {
  let a = 0;
  for (const rings of polygonsOf(g)) {
    rings.forEach((r, i) => {
      const area = Math.abs(ringArea2(r)) / 2;
      a += i === 0 ? area : -area;
    });
  }
  return a;
}

/** [xmin, ymin, xmax, ymax] in the geometry's own (unwrapped) longitudes. */
export function bboxOf(g: AreaGeometry): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const rings of polygonsOf(g)) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return [x0, y0, x1, y1];
}

/** a ring with its closing vertex present exactly once (RFC 7946 requires it). */
export function closeRing(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring : [...ring, [fx, fy]];
}

/** a ring without its closing vertex (what the codec stores). */
export function openRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring.slice(0, -1) : ring;
}
