// parsers/wkt.ts — pasted WKT, hand-rolled and deliberately NOT a dependency (S4 verdict: 1.2 KB
// of our own code, fully under our own tests, against an npm package that would have to be pinned,
// audited and kept lazy for the same result).
//
// Grown from `spikes/4/src/wkt.ts` in one direction only: the spike parsed POLYGON, MULTIPOLYGON
// and LINESTRING and threw on everything else. Throwing is the wrong answer here — a pasted POINT
// must reach the normalizer so it earns the "points and lines are refused with a sentence, not
// buffered" copy rather than a parser stack trace — so every WKT geometry type is parsed to its
// GeoJSON equivalent and the judgement is left where all the other judgements live.
//
// WKT carries no coordinate system (that is the format, not an omission), so `crs` is null unless
// the text uses PostGIS's `SRID=nnnn;` prefix. Null means the normalizer's magnitude test decides,
// which is exactly right: pasted UTM metres look like a plausible geometry and nothing else in the
// text can tell you otherwise.
import { classifyEpsg } from "../crs";
import type { DeclaredCrs, ParsedSource, RawFeature, RawGeometry } from "../types";

const TYPES: Record<string, string> = {
  POINT: "Point",
  MULTIPOINT: "MultiPoint",
  LINESTRING: "LineString",
  LINEARRING: "LineString",
  MULTILINESTRING: "MultiLineString",
  POLYGON: "Polygon",
  MULTIPOLYGON: "MultiPolygon",
  GEOMETRYCOLLECTION: "GeometryCollection",
};

/** "(a),(b)" -> ["a", "b"], matching parentheses so nesting survives. */
function splitTopLevel(body: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) groups.push(body.slice(start, i));
    }
  }
  return groups;
}

/** a comma-separated run of "x y [z [m]]" — anything past the first two ordinates is dropped. */
function points(body: string): number[][] {
  return body
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const n = p.split(/\s+/).map(Number);
      return [n[0], n[1]];
    });
}

function parseBody(kind: string, body: string): unknown {
  switch (kind) {
    case "POINT":
      return points(body)[0] ?? [];
    case "MULTIPOINT":
      // both spellings are legal: "(1 2, 3 4)" and "((1 2),(3 4))"
      return /\(/.test(body) ? splitTopLevel(body).map((g) => points(g)[0]) : points(body);
    case "LINESTRING":
    case "LINEARRING":
      return points(body);
    case "MULTILINESTRING":
    case "POLYGON":
      return splitTopLevel(body).map(points);
    case "MULTIPOLYGON":
      return splitTopLevel(body).map((g) => splitTopLevel(g).map(points));
    default:
      return [];
  }
}

/** one geometry, from `TYPE [Z|M|ZM] (...)` or `TYPE EMPTY`. */
export function parseWktGeometry(text: string): RawGeometry {
  const t = text.trim();
  const head = /^([A-Za-z]+)\s*(?:(ZM|Z|M)\s*)?(EMPTY|\()/i.exec(t);
  if (!head) throw new Error(`no geometry keyword at "${t.slice(0, 40)}"`);
  const keyword = head[1].toUpperCase();
  const type = TYPES[keyword];
  if (!type) throw new Error(`${head[1]} is not a geometry type`);

  if (/^EMPTY$/i.test(head[3])) {
    return type === "GeometryCollection"
      ? { type, geometries: [] }
      : { type, coordinates: type === "Point" ? [] : [] };
  }

  const open = t.indexOf("(", head.index);
  const close = t.lastIndexOf(")");
  if (close < open) throw new Error("the geometry's parentheses do not close");
  const body = t.slice(open + 1, close);

  if (type === "GeometryCollection") {
    return { type, geometries: splitGeometryCollection(body).map(parseWktGeometry) };
  }
  return { type, coordinates: parseBody(keyword, body) };
}

/** a GEOMETRYCOLLECTION body is a comma-separated list of whole geometries, not of coordinates. */
function splitGeometryCollection(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Every non-blank line is one geometry, so a paste of several polygons is a multi-feature source
 * and goes through the same "one place per feature, or one union" question as a shapefile does.
 */
export function parseWktText(fileName: string, text: string): ParsedSource {
  let crs: DeclaredCrs | null = null;
  let body = text.trim();
  const srid = /^SRID\s*=\s*(\d+)\s*;/i.exec(body);
  if (srid) {
    const code = Number(srid[1]);
    crs = { raw: `EPSG:${code}`, kind: classifyEpsg(code), reprojected: false };
    body = body.slice(srid[0].length).trim();
  }

  const features: RawFeature[] = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => ({ geometry: parseWktGeometry(line), properties: {} }));

  return { format: "wkt", fileName, features, crs };
}

export async function parseWkt(fileName: string, bytes: Uint8Array): Promise<ParsedSource> {
  return parseWktText(fileName, new TextDecoder("utf-8").decode(bytes));
}
