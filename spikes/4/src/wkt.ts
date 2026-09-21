// atlas-0 S4 spike — hand-rolled WKT -> GeoJSON for the "paste WKT" affordance. Deliberately NOT
// an npm dependency: spikes/4/package.json only pins shpjs, @tmcw/togeojson, flatgeobuf and
// duckdb-wasm (the plan's named spike-only deps), so this is written from scratch instead. That
// also makes its correctness properties honest: plain WKT carries no CRS at all, so this parser
// has zero notion of reprojection — pasting projected (e.g. UTM metre) coordinates in produces
// numbers that are silently treated as lon/lat. That gap is itself one of the fixtures' findings
// (see RESULTS.md, utm_zone), not a bug in this file.

function parseNumberPair(s: string): [number, number] {
  const parts = s.trim().split(/\s+/).map(Number);
  return [parts[0], parts[1]];
}

function parseRing(s: string): [number, number][] {
  return s
    .trim()
    .split(",")
    .map((pair) => parseNumberPair(pair));
}

/** splits "(ring1),(ring2)" into ["ring1 content", "ring2 content"] by matching top-level parens. */
function splitTopLevelParenGroups(body: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (body[i] === ")") {
      depth--;
      if (depth === 0) groups.push(body.slice(start, i));
    }
  }
  return groups;
}

function parsePolygonBody(body: string): [number, number][][] {
  return splitTopLevelParenGroups(body).map(parseRing);
}

export interface WktParseResult {
  type: "Feature";
  properties: Record<string, never>;
  geometry:
    | { type: "Polygon"; coordinates: [number, number][][] }
    | { type: "MultiPolygon"; coordinates: [number, number][][][] }
    | { type: "LineString"; coordinates: [number, number][] };
}

export function wktToGeoJSON(text: string): WktParseResult {
  const trimmed = text.trim();
  const match = trimmed.match(/^([A-Za-z]+)\s*\(([\s\S]*)\)\s*$/);
  if (!match) throw new Error(`unrecognized WKT (no TYPE(...) wrapper): ${trimmed.slice(0, 60)}`);
  const type = match[1].toUpperCase();
  const body = match[2];

  if (type === "POLYGON") {
    return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: parsePolygonBody(body) } };
  }

  if (type === "MULTIPOLYGON") {
    // body: "((ring),(ring)), ((ring))" — one top-level paren group per polygon part. Each group's
    // *captured* content ("(ring),(ring)") already has its own wrapping paren stripped, which is
    // exactly the shape parsePolygonBody expects for a single polygon's list of rings.
    const coordinates = splitTopLevelParenGroups(body).map((g) => parsePolygonBody(g));
    return { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates } };
  }

  if (type === "LINESTRING") {
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: parseRing(body) } };
  }

  throw new Error(`unsupported WKT geometry type for this hand-rolled parser: ${type}`);
}
