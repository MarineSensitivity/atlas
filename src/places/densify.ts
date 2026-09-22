// places/densify.ts -- Deliverable 3: "the outline is redrawn from the decoded geometry densified
// along lon/lat lines, so what is displayed is what is analyzed".
//
// Coverage (geo/coverage.ts) and the codec (geo/placeCodec.ts) both treat an edge as a straight
// CARTESIAN line in the lon/lat plane -- that is the plane `pct_covered` is computed in. MapLibre's
// globe projection does not: a straight line between two vertices is interpolated on the sphere
// (a great-circle-ish curve in screen space), so a long edge of the ANALYSED polygon would be drawn
// bowed on the globe -- visibly a different shape than the one `cellsInPolygon()` actually covered.
// Densifying inserts extra vertices along each edge, spaced no more than `maxStepDeg` apart in
// lon/lat, so the rendered polyline hugs the analysed straight line closely enough that globe
// projection's own interpolation between adjacent (now-close) vertices cannot visibly bow it.
import { closeRing, polygonsOf, type AreaGeometry, type Ring } from "../lib/geo/types";

/** dense enough to look straight at any zoom this app's camera reaches (places.ts's own
 * MAX_ZOOM/MIN_ZOOM range), coarse enough that a Program-Area-sized ring (tens of thousands of
 * vertices already) does not multiply into something that stalls the renderer. */
export const DEFAULT_DENSIFY_STEP_DEG = 0.25;

/**
 * A CLOSED ring (first vertex repeated as the last -- pass it through {@link closeRing} first),
 * with extra vertices inserted so no edge exceeds `maxStepDeg`, INCLUDING the wrap-around edge from
 * the last distinct vertex back to the first: closing before densifying is what turns that edge
 * into an ordinary consecutive pair in the loop below, so it is walked (and densified) exactly like
 * every other edge instead of being silently skipped.
 */
export function densifyRing(ring: Ring, maxStepDeg = DEFAULT_DENSIFY_STEP_DEG): Ring {
  if (ring.length < 2 || maxStepDeg <= 0) return ring.map(([x, y]) => [x, y]);
  const out: Ring = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = ring[i - 1];
    const [x1, y1] = ring[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / maxStepDeg));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([x0 + dx * t, y0 + dy * t]);
    }
  }
  return out;
}

/**
 * Every ring of a geometry, densified -- what Deliverable 3 asks the drawn/edited outline to be
 * redrawn as. Applies to the geometry that ALREADY WENT through
 * `analysis/place.ts`'s `analysisGeometry()` (unwrapped, quantized, round-tripped): "what is
 * displayed is what is analyzed" means densifying the ANALYSED geometry, never the raw drawn one.
 */
export function densifyGeometry(
  geom: AreaGeometry,
  maxStepDeg = DEFAULT_DENSIFY_STEP_DEG,
): AreaGeometry {
  const rings = polygonsOf(geom).map((poly) =>
    poly.map((ring) => densifyRing(closeRing(ring), maxStepDeg)),
  );
  return geom.type === "Polygon"
    ? { type: "Polygon", coordinates: rings[0] ?? [] }
    : { type: "MultiPolygon", coordinates: rings };
}
