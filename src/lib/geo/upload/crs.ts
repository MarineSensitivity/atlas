// geo/upload/crs.ts — is the coordinate system a file DECLARES geographic (lon/lat) or projected?
//
// S4 rule 3, restated: "the CRS, when present, is always authoritative over the range check". A
// projected file whose metre values happen to fall inside +/-180 and +/-90 exists (anything near a
// projection's origin), and the magnitude test cannot see it. So whenever a file says what it is —
// a shapefile's `.prj`, a FlatGeobuf header, a GeoJSON-2008 `crs` member, a GeoPackage's srs row —
// that statement decides, and the numbers only get a say when there is no statement at all.
//
// This is classification, NOT reprojection: nothing here converts a coordinate. The app carries no
// projection library (`shpjs` bundles its own proj4 and uses it before we ever see the geometry),
// and a projected file we cannot convert is refused with a sentence rather than silently scored.
import type { CrsKind } from "./types";

/** EPSG geodetic (geographic 2D/3D) CRS codes live in this block; everything else is projected. */
const EPSG_GEOGRAPHIC_MIN = 4000;
const EPSG_GEOGRAPHIC_MAX = 4999;

/** the spellings of "plain WGS84 longitude/latitude" that turn up in real files. */
const GEOGRAPHIC_NAMES = [
  "CRS84",
  "CRS:84",
  "OGC:CRS84",
  "WGS84",
  "WGS 84",
  "EPSG:4326",
  "EPSG::4326",
  "URN:OGC:DEF:CRS:OGC:1.3:CRS84",
];

/**
 * Classify an EPSG-style authority code.
 *
 * `4326` and its neighbours in the geodetic block are geographic; `32610` (UTM zone 10N, the S4
 * fixture) and every other block is projected. An unknown authority is `unknown`, which means the
 * magnitude check gets to speak — never that the file is waved through.
 */
export function classifyEpsg(code: number): CrsKind {
  if (!Number.isInteger(code) || code <= 0) return "unknown";
  return code >= EPSG_GEOGRAPHIC_MIN && code <= EPSG_GEOGRAPHIC_MAX ? "geographic" : "projected";
}

/**
 * Classify whatever text a file declares: a WKT1/WKT2 CRS definition (a `.prj`, a FlatGeobuf
 * header), an `EPSG:code`, or a CRS URN.
 *
 * WKT is read by its OUTERMOST keyword, and `PROJCS`/`PROJCRS` wins over the `GEOGCS`/`BASEGEOGCRS`
 * nested inside it — every projected definition contains its own base geographic one, so a naive
 * "does it mention GEOGCS" test calls UTM zone 10N geographic (and that is precisely the file that
 * put a Santa Barbara polygon in the Arctic, `msens/R/calc.R:1-13`).
 */
export function classifyCrsText(text: string): CrsKind {
  const t = text.trim();
  if (!t) return "unknown";
  const upper = t.toUpperCase();

  if (/\b(PROJCS|PROJCRS|PROJECTEDCRS)\s*\[/.test(upper)) return "projected";
  if (/\b(GEOGCS|GEOGCRS|GEODCRS|GEOGRAPHICCRS)\s*\[/.test(upper)) {
    // a WKT2 `GEOGCRS` whose axes are metres is not a thing; a WKT1 `GEOGCS` always is degrees.
    return "geographic";
  }

  for (const name of GEOGRAPHIC_NAMES) if (upper === name.toUpperCase()) return "geographic";

  const epsg = /(?:EPSG[:\s]*:?\s*|^)(\d{4,6})$/.exec(upper.replace(/^URN:OGC:DEF:CRS:/, ""));
  if (epsg) return classifyEpsg(Number(epsg[1]));

  return "unknown";
}

/** a short label for the refusal copy: "EPSG:32610", or the CRS's own name when it has one. */
export function crsLabel(raw: string, org?: string | null, code?: number | null): string {
  if (org && code) return `${org}:${code}`;
  const name = /^\s*(?:PROJCS|PROJCRS|GEOGCS|GEOGCRS|GEODCRS)\s*\[\s*"([^"]+)"/i.exec(raw);
  if (name) return name[1];
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
}
