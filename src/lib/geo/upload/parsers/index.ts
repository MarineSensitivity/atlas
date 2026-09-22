// parsers/index.ts — format -> parser, every one of them behind its own `import()`.
//
// Two levels of laziness, both deliberate: the parser MODULE is dynamic here, so dropping a
// GeoJSON never loads the code that knows about zips; and each parser's LIBRARY is dynamic inside
// that module, so the 46.7 KB of `shpjs` is fetched only by an actual shapefile (S4's cost table,
// and CLAUDE.md's "every parser is a dynamic import(), never a static one").
// `tests/geo/upload/lazyImports.test.ts` re-reads this directory's source and fails on a static
// import of any pinned parser; `scripts/size-budget.mjs` fails the build if one reaches the entry's
// static graph anyway.
import type { ParsedSource, UploadFormat } from "../types";
import type { GeoPackageDeps } from "./geopackage";
import type { XmlParse } from "./xml";

export interface ParseDeps {
  /** browsers have `DOMParser`; node (and therefore the unit tests) must pass one in. */
  xmlParse?: XmlParse;
  /** required only for `.gpkg` — the consent prompt and the DuckDB connection (S4 rule 2). */
  geoPackage?: GeoPackageDeps;
}

export async function parseByFormat(
  format: UploadFormat,
  fileName: string,
  bytes: Uint8Array,
  deps: ParseDeps = {},
): Promise<ParsedSource> {
  switch (format) {
    case "geojson":
      return (await import("./geojson")).parseGeoJson(fileName, bytes);
    case "shapefile":
      return (await import("./shapefile")).parseShapefile(fileName, bytes);
    case "kml":
      return (await import("./kml")).parseKml(fileName, bytes, deps.xmlParse);
    case "gpx":
      return (await import("./gpx")).parseGpx(fileName, bytes, deps.xmlParse);
    case "flatgeobuf":
      return (await import("./flatgeobuf")).parseFlatgeobuf(fileName, bytes);
    case "wkt":
      return (await import("./wkt")).parseWkt(fileName, bytes);
    case "geopackage":
      return (await import("./geopackage")).parseGeoPackage(fileName, bytes, deps.geoPackage);
  }
}

/** what the panel shows in the picker and in the "formats this app reads" line. */
export const FORMAT_LABELS: Record<UploadFormat, string> = {
  geojson: "GeoJSON",
  shapefile: "zipped shapefile",
  kml: "KML",
  gpx: "GPX",
  flatgeobuf: "FlatGeobuf",
  wkt: "WKT",
  geopackage: "GeoPackage",
};
