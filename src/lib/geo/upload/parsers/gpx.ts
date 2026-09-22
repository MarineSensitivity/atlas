// parsers/gpx.ts — GPX through `@tmcw/togeojson@7.1.2`, loaded lazily.
//
// S4 measured KML and left GPX untested, and package.json's pinReasons says so in as many words:
// "GPX shares the package but was NOT exercised by any fixture — add one before advertising GPX".
// atlas-6 adds the fixture, and adding it turns up the thing the spike could not have: **GPX has no
// polygon.** The format records waypoints, routes and tracks; togeojson returns Points,
// LineStrings and MultiLineStrings, and nothing else exists to return.
//
// THE RULE THAT MAKES GPX USABLE WITHOUT INVENTING ANYTHING. A track whose last point repeats its
// first is a closed loop — the person walked, flew or sailed the outline of an area and came back
// to where they started — and reading that as a ring adds no coordinate that is not already in the
// file. A track that does NOT close is refused by name (`gpxTrackNotClosed`), because closing it
// here would mean drawing the edge that was never travelled; buffering it would be worse, and
// Deliverable 4 forbids that outright. Both cases have a fixture.
import type { ParsedSource, RawFeature, RawGeometry } from "../types";
import { domXmlParse, parseXmlStrict, type XmlParse } from "./xml";

interface GjFeature {
  geometry?: RawGeometry | null;
  properties?: Record<string, unknown> | null;
}

type Pos = [number, number];

const closedRing = (line: unknown): Pos[] | null => {
  if (!Array.isArray(line) || line.length < 4) return null;
  const first = line[0] as Pos;
  const last = line[line.length - 1] as Pos;
  if (!Array.isArray(first) || !Array.isArray(last)) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) return null;
  return line as Pos[];
};

/**
 * A closed track (or a MultiLineString of closed tracks) becomes a Polygon / MultiPolygon; anything
 * else is passed through untouched, so `normalize.ts` reports it with the refusal that fits — a
 * waypoint gets "polygons only", an open track gets the GPX-specific sentence.
 */
export function trackToArea(geom: RawGeometry | null): RawGeometry | null {
  if (!geom) return null;
  if (geom.type === "LineString") {
    const ring = closedRing(geom.coordinates);
    return ring ? { type: "Polygon", coordinates: [ring] } : geom;
  }
  if (geom.type === "MultiLineString") {
    const lines = Array.isArray(geom.coordinates) ? (geom.coordinates as unknown[]) : [];
    const rings = lines.map(closedRing);
    if (!rings.length || rings.some((r) => r === null)) return geom;
    return { type: "MultiPolygon", coordinates: (rings as Pos[][]).map((r) => [r]) };
  }
  return geom;
}

export async function parseGpx(
  fileName: string,
  bytes: Uint8Array,
  xmlParse: XmlParse = domXmlParse,
): Promise<ParsedSource> {
  const doc = parseXmlStrict(new TextDecoder("utf-8").decode(bytes), xmlParse);
  const { gpx } = await import("@tmcw/togeojson");
  const fc = gpx(doc) as { features?: GjFeature[] };
  const features: RawFeature[] = (fc.features ?? []).map((f) => ({
    geometry: trackToArea((f?.geometry ?? null) as RawGeometry | null),
    properties: f?.properties && typeof f.properties === "object" ? f.properties : {},
  }));
  return {
    format: "gpx",
    fileName,
    features,
    // GPX 1.1 clause 2: every coordinate is WGS84 lon/lat; there is no other option in the schema
    crs: { raw: "EPSG:4326 (fixed by the GPX format)", kind: "geographic", reprojected: false },
  };
}
