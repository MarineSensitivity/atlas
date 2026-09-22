// parsers/geojson.ts — the commonest drop, and the only format with no parser to load (S4's "What
// was NOT measured" list: GeoJSON had no fixture in the spike precisely because it needs no
// dependency — it still needs the same normalizer, and the same tests).
import { classifyCrsText, crsLabel } from "../crs";
import type { DeclaredCrs, ParsedSource, RawFeature, RawGeometry } from "../types";

/**
 * The GeoJSON-2008 `crs` member. Dropped from RFC 7946 (which fixes CRS84 for every document), but
 * GDAL still writes it when a layer is not WGS84, and it is the ONLY in-band warning a projected
 * `.geojson` ever carries — so it is read, and it is authoritative (S4 rule 3).
 */
function readCrs(doc: Record<string, unknown>): DeclaredCrs | null {
  const crs = doc.crs as { properties?: { name?: unknown; href?: unknown } } | undefined;
  const name = crs?.properties?.name ?? crs?.properties?.href;
  if (typeof name !== "string" || !name.trim()) return null;
  return { raw: crsLabel(name), kind: classifyCrsText(name), reprojected: false };
}

const asFeature = (f: unknown): RawFeature => {
  const o = (f ?? {}) as Record<string, unknown>;
  const props = o.properties;
  return {
    geometry: (o.geometry ?? null) as RawGeometry | null,
    properties: props && typeof props === "object" ? (props as Record<string, unknown>) : {},
  };
};

/**
 * Accepts every shape RFC 7946 allows at the top level: a FeatureCollection, a single Feature, a
 * bare geometry, or a GeometryCollection — a hand-written paste is as often one of the last three
 * as it is the first, and refusing them would be a refusal about JSON rather than about geography.
 */
export function parseGeoJsonText(fileName: string, text: string): ParsedSource {
  const doc = JSON.parse(text) as Record<string, unknown>;
  const type = typeof doc.type === "string" ? doc.type : "";
  let features: RawFeature[];

  if (type === "FeatureCollection") {
    features = (Array.isArray(doc.features) ? doc.features : []).map(asFeature);
  } else if (type === "Feature") {
    features = [asFeature(doc)];
  } else if (type === "GeometryCollection") {
    const geoms = (doc.geometries ?? []) as RawGeometry[];
    features = (Array.isArray(geoms) ? geoms : []).map((g) => ({ geometry: g, properties: {} }));
  } else if (type) {
    features = [{ geometry: doc as unknown as RawGeometry, properties: {} }];
  } else {
    throw new Error("no GeoJSON “type” member at the top level");
  }

  return { format: "geojson", fileName, features, crs: readCrs(doc) };
}

export async function parseGeoJson(fileName: string, bytes: Uint8Array): Promise<ParsedSource> {
  return parseGeoJsonText(fileName, new TextDecoder("utf-8").decode(bytes));
}
