// places/coords.ts -- Deliverable 3's "Enter coordinates" dialog: the keyboard/screen-reader
// alternative to drawing ("drawing is never the only way"). Three input shapes, ONE result shape
// (`NormalizeResult`, geo/upload's own -- everything downstream, and every rule Deliverable 4
// already enforces, applies uniformly whether a place came from a dropped file, a drawn shape, or
// typed text):
//
//   1. a bounding box:      "xmin, ymin, xmax, ymax"
//   2. lon,lat lines:       one "lon, lat" pair per line, closed automatically, >= 3 lines
//   3. pasted WKT/GeoJSON:  handed to the SAME normalizeUpload() the upload pipeline uses (its own
//                           `detectFormat()` sniffs the content; the format never has to be told)
//
// Bbox and lon/lat-lines are built as plain GeoJSON, then run through `normalizeParsed()` -- the
// SAME rule pipeline (rings closed, RFC 7946 winding, self-intersection, the antimeridian, the
// vertex cap) a dropped file goes through, so a typed shape cannot skip a check a file would hit.
//
// `geo/upload/normalize.ts` (and its `messages.ts`, which is where the size-budget checker's
// forbidden-marker text scan actually trips) is reached ONLY through the dynamic `import()` below,
// never a static one -- docs/upload.md's own rule for the whole upload pipeline ("nothing in src/
// imports it yet") applies just as much to atlas-6's own UI code as to anyone else's: a static
// import here would have pulled the refusal catalogue's copy (which quotes "extensions.duckdb.org"
// and ".shp" verbatim) into index.html's entry chunk, tripping `scripts/size-budget.mjs`'s
// FORBIDDEN_LAZY_MARKERS scan on "duckdb"/"shp" even though neither library is actually loaded --
// measured, this exact failure, before this file used `import type` + a lazy `import()` instead.
import type { NormalizeOptions, NormalizeResult } from "../lib/geo/upload/normalize";
import type { ParsedSource, RawGeometry, Refusal } from "../lib/geo/upload/types";

type NormalizeModule = typeof import("../lib/geo/upload/normalize");

function loadNormalize(): Promise<NormalizeModule> {
  return import("../lib/geo/upload/normalize");
}

const R = (rule: string, what: string, why: string, fix: string): Refusal => ({
  rule,
  what,
  why,
  fix,
});

export const emptyCoordinateEntry = (): Refusal =>
  R(
    "coordEmpty",
    "There's nothing typed in the box yet.",
    "This dialog needs a bounding box, a list of coordinates or a pasted shape to build a place from.",
    'Type four numbers for a box, one "lon, lat" pair per line for an outline, or paste WKT/GeoJSON.',
  );

export const unrecognizedCoordinateEntry = (sample: string): Refusal =>
  R(
    "coordUnrecognized",
    `This text doesn't read as a bounding box, a list of coordinates or WKT/GeoJSON: "${sample}".`,
    "None of the three accepted shapes matched — four comma-separated numbers, one lon,lat pair per line, or a pasted geometry.",
    'A box looks like "-124.5, 40.0, -123.0, 41.5"; an outline looks like one "lon, lat" per line, at least three lines.',
  );

const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

function parseNum(s: string): number | null {
  const t = s.trim();
  if (!NUMBER_RE.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "a, b, c, d" or "a b c d" -- comma OR whitespace, never both required. */
function splitNums(line: string): (number | null)[] {
  return line
    .trim()
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map(parseNum);
}

function ringFromRawGeometry(
  normalize: NormalizeModule,
  geometry: RawGeometry,
  fileName: string,
  options: NormalizeOptions,
): NormalizeResult {
  return normalize.normalizeParsed(
    {
      format: "geojson",
      fileName,
      features: [{ geometry, properties: {} }],
      crs: null,
    } satisfies ParsedSource,
    options,
  );
}

/** rule 1: a single line of exactly four numbers -- a rectangle bbox. */
function tryBbox(
  normalize: NormalizeModule,
  text: string,
  options: NormalizeOptions,
): NormalizeResult | null {
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length !== 1) return null;
  const nums = splitNums(lines[0]);
  if (nums.length !== 4 || nums.some((n) => n === null)) return null;
  const [xmin, ymin, xmax, ymax] = nums as number[];
  const geometry: RawGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [xmin, ymin],
        [xmin, ymax],
        [xmax, ymax],
        [xmax, ymin],
        [xmin, ymin],
      ],
    ],
  };
  return ringFromRawGeometry(normalize, geometry, "bounding box", options);
}

/** rule 2: >= 3 lines, each exactly two numbers -- an outline ring (closed automatically). */
function tryLonLatLines(
  normalize: NormalizeModule,
  text: string,
  options: NormalizeOptions,
): NormalizeResult | null {
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length < 3) return null;
  const points: [number, number][] = [];
  for (const line of lines) {
    const nums = splitNums(line);
    if (nums.length !== 2 || nums.some((n) => n === null)) return null;
    points.push(nums as [number, number]);
  }
  const first = points[0];
  const last = points[points.length - 1];
  const ring = first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
  const geometry: RawGeometry = { type: "Polygon", coordinates: [ring] };
  return ringFromRawGeometry(normalize, geometry, "coordinate list", options);
}

/** does this look like it starts a WKT geometry or JSON text -- `detect.ts`'s own sniffs, so the
 * dialog only ever hands `normalizeUpload` text it would itself recognize as one of those two. */
const WKT_HEAD =
  /^\s*(?:SRID\s*=\s*\d+\s*;\s*)?(POINT|LINESTRING|LINEARRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*(?:[ZM]{1,2}\s*)?[(E]/i;

function looksLikeWktOrGeoJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[") || WKT_HEAD.test(t);
}

/**
 * Parse whatever was typed or pasted into the "Enter coordinates" dialog. `options` is the SAME
 * `NormalizeOptions` the upload pipeline takes (multi-feature choice, the study-area hook) --
 * pasted WKT/GeoJSON can carry more than one geometry, and the caller asks the same question either
 * way.
 */
export async function parseCoordinateEntry(
  text: string,
  options: NormalizeOptions = {},
): Promise<NormalizeResult> {
  if (!text.trim()) return { ok: false, refusal: emptyCoordinateEntry() };

  const normalize = await loadNormalize();

  if (looksLikeWktOrGeoJson(text)) {
    return normalize.normalizeUpload(
      { name: "entered-coordinates.txt", bytes: new TextEncoder().encode(text) },
      options,
    );
  }

  const bbox = tryBbox(normalize, text, options);
  if (bbox) return bbox;

  const lines = tryLonLatLines(normalize, text, options);
  if (lines) return lines;

  const sample = text.trim().slice(0, 60);
  return { ok: false, refusal: unrecognizedCoordinateEntry(sample) };
}
