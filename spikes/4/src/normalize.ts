// atlas-0 S4 spike — a tiny, shared, format-agnostic reader of "whatever GeoJSON-shaped object a
// parser handed back" into the handful of raw numbers RESULTS.md reports per fixture per parser:
// vertex count, a NAIVE bbox (deliberately no antimeridian unwrapping — that naivety is itself
// the "what happens at 180 degrees" measurement), and the winding of the first ring found.
// Measurement-only helper: no verdict, no format preference baked in here.

export type LonLat = [number, number];

export interface NormalizedResult {
  featureCount: number;
  vertexCount: number;
  /** [minLon, minLat, maxLon, maxLat], naive min/max over every raw coordinate seen. */
  bbox: [number, number, number, number];
  firstRingOrientation: "CW" | "CCW" | "N/A";
  firstRingSignedArea: number | null;
}

function eachCoordinate(geom: any, visit: (pt: LonLat) => void): void {
  if (!geom) return;
  switch (geom.type) {
    case "Point":
      visit(geom.coordinates as LonLat);
      break;
    case "MultiPoint":
    case "LineString":
      for (const c of geom.coordinates) visit(c as LonLat);
      break;
    case "MultiLineString":
    case "Polygon":
      for (const ring of geom.coordinates) for (const c of ring) visit(c as LonLat);
      break;
    case "MultiPolygon":
      for (const poly of geom.coordinates) for (const ring of poly) for (const c of ring) visit(c as LonLat);
      break;
    case "GeometryCollection":
      for (const g of geom.geometries) eachCoordinate(g, visit);
      break;
    default:
      break;
  }
}

/** first ring found: outer ring of the first Polygon, or outer ring of the first part of a MultiPolygon. */
function firstRing(geom: any): LonLat[] | null {
  if (!geom) return null;
  if (geom.type === "Polygon") return (geom.coordinates[0] ?? null) as LonLat[] | null;
  if (geom.type === "MultiPolygon") return (geom.coordinates?.[0]?.[0] ?? null) as LonLat[] | null;
  if (geom.type === "GeometryCollection") {
    for (const g of geom.geometries) {
      const r = firstRing(g);
      if (r) return r;
    }
  }
  return null;
}

/** shoelace signed area; > 0 is counter-clockwise, < 0 is clockwise, in plain (unwrapped) x/y. */
export function signedArea(ring: LonLat[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function asFeatureArray(geojson: any): any[] {
  if (!geojson) return [];
  if (geojson.type === "FeatureCollection") return geojson.features ?? [];
  if (geojson.type === "Feature") return [geojson];
  if (Array.isArray(geojson)) return geojson.flatMap(asFeatureArray);
  // a bare geometry (e.g. some flatgeobuf feature shapes) — wrap it
  if (geojson.type) return [{ type: "Feature", properties: {}, geometry: geojson }];
  return [];
}

export function normalizeGeoJSON(geojson: any): NormalizedResult {
  const features = asFeatureArray(geojson);
  let vertexCount = 0;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let ring: LonLat[] | null = null;

  for (const f of features) {
    const geom = f.geometry ?? f;
    eachCoordinate(geom, ([lon, lat]) => {
      vertexCount++;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
    if (!ring) ring = firstRing(geom);
  }

  const area = ring ? signedArea(ring) : null;
  const orientation: NormalizedResult["firstRingOrientation"] =
    area === null || area === 0 ? "N/A" : area > 0 ? "CCW" : "CW";

  return {
    featureCount: features.length,
    vertexCount,
    bbox: [minLon, minLat, maxLon, maxLat],
    firstRingOrientation: orientation,
    firstRingSignedArea: area,
  };
}
