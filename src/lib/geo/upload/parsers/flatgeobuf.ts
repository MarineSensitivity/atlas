// parsers/flatgeobuf.ts — FlatGeobuf through `flatgeobuf@4.4.0`, loaded lazily (11.4 KB gzip and
// 2.3 ms for 40,000 vertices, the fastest parser S4 measured).
//
// The division of labour this pin exists for: FlatGeobuf's header CARRIES the source CRS correctly
// (`EPSG:32610` on the UTM fixture) and the reader hands back RAW METRES — it never reprojects.
// That is not a defect to work around in here; it is why the header is read and reported, and why
// `normalize.ts` refuses a projected header rather than scoring the metres (S4 rule 3, and
// package.json's pinReason for this package spells out that the behaviour is version-specific).
import { classifyCrsText, classifyEpsg, crsLabel } from "../crs";
import type { CrsKind, DeclaredCrs, ParsedSource, RawFeature, RawGeometry } from "../types";

interface FgbCrs {
  org?: string | null;
  code?: number | null;
  name?: string | null;
  wkt?: string | null;
}
interface FgbHeader {
  crs?: FgbCrs | null;
}
interface FgbFeature {
  geometry?: RawGeometry | null;
  properties?: Record<string, unknown> | null;
}

export function crsFromHeader(header: FgbHeader | null): DeclaredCrs | null {
  const crs = header?.crs;
  if (!crs) return null;
  const org = crs.org ?? null;
  const code = typeof crs.code === "number" && crs.code > 0 ? crs.code : null;
  let kind: CrsKind = "unknown";
  if (org && /^EPSG$/i.test(org) && code) kind = classifyEpsg(code);
  else if (crs.wkt) kind = classifyCrsText(crs.wkt);
  if (kind === "unknown" && crs.wkt) kind = classifyCrsText(crs.wkt);
  if (kind === "unknown" && !org && !code && !crs.wkt) return null;
  return { raw: crsLabel(crs.wkt ?? crs.name ?? "", org, code), kind, reprojected: false };
}

export async function parseFlatgeobuf(fileName: string, bytes: Uint8Array): Promise<ParsedSource> {
  // deep path on purpose: `flatgeobuf` publishes no `exports` map, and this is the GeoJSON facade
  // (`deserialize` -> an async iterable of GeoJSON features) rather than the whole library.
  const { deserialize } = await import("flatgeobuf/lib/mjs/geojson.js");
  let header: FgbHeader | null = null;
  const iter = deserialize(bytes, undefined, (h: unknown) => {
    header = h as FgbHeader;
  }) as AsyncIterable<FgbFeature>;

  const features: RawFeature[] = [];
  for await (const f of iter) {
    features.push({
      geometry: (f?.geometry ?? null) as RawGeometry | null,
      properties: f?.properties && typeof f.properties === "object" ? f.properties : {},
    });
  }
  return { format: "flatgeobuf", fileName, features, crs: crsFromHeader(header) };
}
