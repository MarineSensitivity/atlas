// places/area.ts -- an APPROXIMATE area in km² for the places list's "area km²" column
// (Deliverable 1), shown the instant a place is drawn/uploaded/entered -- before any engine query
// has run. This is deliberately NOT the analysed area: the published, D7b-clipped number
// (per-component `area_km2`, `sql/species_for_cells.sql`) lands once Deliverable 5's results panel
// runs; this is a fast, honest estimate so the list has something to show immediately rather than
// a placeholder dash.
//
// Equirectangular approximation (a degree of longitude narrows by cos(lat); WGS84 mean radius
// 6371.0088 km): exact at the equator, off by design at high latitude, which is adequate for a LIST
// COLUMN and not claimed to be more than that -- see this module's tests for the measured error at
// a few reference latitudes.
import { geometryArea, polygonsOf, type AreaGeometry } from "../lib/geo/types";

export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_KM;

/** the mean latitude of a geometry's vertices -- a simple vertex mean, not an area centroid; this
 * is a display estimate, never a scoring input. */
export function meanLat(geom: AreaGeometry): number {
  let sum = 0;
  let n = 0;
  for (const rings of polygonsOf(geom)) {
    for (const ring of rings) {
      for (const [, y] of ring) {
        sum += y;
        n++;
      }
    }
  }
  return n ? sum / n : 0;
}

/** deg² (winding-agnostic, holes already subtracted by `geometryArea`) -> km², at the geometry's
 * own mean latitude. */
export function approxAreaKm2(geom: AreaGeometry): number {
  const degArea = geometryArea(geom);
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((meanLat(geom) * Math.PI) / 180);
  return degArea * KM_PER_DEG_LAT * Math.abs(kmPerDegLon);
}
