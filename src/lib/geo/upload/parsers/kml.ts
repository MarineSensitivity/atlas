// parsers/kml.ts — KML through `@tmcw/togeojson@7.1.2`, loaded lazily (3.8 KB gzip, S4).
//
// KML's own specification fixes the coordinate system: longitude/latitude on WGS84, always. So the
// declared CRS here is not read out of the file — there is nowhere in a KML to write a different
// one — it is a property of the format, and it is reported as such so the normalizer's magnitude
// test knows a 500000 in this file would be a real coordinate error rather than metres.
import type { ParsedSource, RawFeature, RawGeometry } from "../types";
import { domXmlParse, parseXmlStrict, type XmlParse } from "./xml";

interface GjFeature {
  geometry?: RawGeometry | null;
  properties?: Record<string, unknown> | null;
}

export async function parseKml(
  fileName: string,
  bytes: Uint8Array,
  xmlParse: XmlParse = domXmlParse,
): Promise<ParsedSource> {
  const doc = parseXmlStrict(new TextDecoder("utf-8").decode(bytes), xmlParse);
  const { kml } = await import("@tmcw/togeojson");
  const fc = kml(doc) as { features?: GjFeature[] };
  const features: RawFeature[] = (fc.features ?? []).map((f) => ({
    geometry: (f?.geometry ?? null) as RawGeometry | null,
    properties: f?.properties && typeof f.properties === "object" ? f.properties : {},
  }));
  return {
    format: "kml",
    fileName,
    features,
    // not read from the document: KML has no CRS element, the format IS WGS84 lon/lat
    crs: { raw: "EPSG:4326 (fixed by the KML format)", kind: "geographic", reprojected: false },
  };
}
