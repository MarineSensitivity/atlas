// geo/upload/normalize.ts — the ONE normalizer every parser's output goes through (atlas-6
// Deliverable 4; S4 verdict rule 3; CLAUDE.md "Uploads (atlas-6)").
//
// THE RULES, IN THE ORDER DELIVERABLE 4 STATES THEM:
//
//   1. size            <= 10 MB; a zip <= 50 MB uncompressed and <= 200 entries, read from the
//                      CENTRAL DIRECTORY, before extraction and before any parser is imported
//   2. parse           (the caller's job; a parser failure arrives here as a refusal)
//   3. polygons only   points and lines are refused with a sentence, never buffered
//   4. coordinates     finite, in range, and NOT projected (a declared CRS beats the magnitudes)
//   5. <= 50 k vertices
//   6. rings           closed, RFC 7946 winding, holes kept
//   7. self-intersection, refused with the crossing's vertex indices
//   8. 180 deg         through `unwrapRing()` and the seam join, never a heuristic of our own
//   9. features        one place per feature (cap 20) or one union, as the CALLER asks
//  10. study area      "must touch `in_usa`" is the CALLER's check: it needs the release's cells.
//                      Exposed as {@link StudyAreaCheck}; deliberately NOT implemented here.
//
// ONE DEVIATION, STATED OUT LOUD. Steps 6, 7 and 8 are computed in the order close -> unwrap ->
// join-seam -> rewind -> self-intersection, because both of the others are meaningless in a wrapped
// frame: a shoelace sign taken across a 359.8 deg edge is not this ring's winding (unwrap.ts says
// so in as many words: "the shoelace sign is only computed AFTER normalization"), and an outline
// written `179.9 -> -179.9` crosses ITSELF in naive coordinates when it does nothing of the kind on
// the ground. The order in which refusals are REPORTED is exactly the order above, because steps 6
// and 8 can only raise `ringTooShort` and `spanTooWide`, which are checked in their own places.
import { bboxOf, closeRing, polygonsOf, ringArea2, type AreaGeometry, type Ring } from "../types";
import { isUnwrapped, unwrapPolygon } from "../unwrap";
import { joinSeamSplit } from "./seam";
import { findSelfIntersection } from "./selfIntersect";
import * as msg from "./messages";
import { detectFormat } from "./detect";
import { parseByFormat, FORMAT_LABELS, type ParseDeps } from "./parsers";
import { readZipCentralDirectory, zipTotals, ZipFormatError } from "./zip";
import { UploadParseError, type ParsedSource, type Refusal, type UploadFormat } from "./types";

// ---- the limits, all of them from Deliverable 4 -------------------------------------------------

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 200;
export const MAX_VERTICES = 50_000;
export const MAX_PLACES = 20;
/** the panel's inline-rename cap (Deliverable 1), applied here so a file cannot exceed it. */
export const MAX_NAME_CHARS = 60;
/**
 * S4 rule 3's magnitude test, and where its two thresholds come from.
 *
 * Latitude is the strong signal: every projected system measures northing in metres, so a UTM file
 * arrives with y in the millions and there is nothing else it could be. Longitude is NOT, because a
 * longitude past 180 is ordinary here — `usa05` IS a 0-360 grid, `unwrapRing()` deliberately
 * carries a Bering place out to 183, and a place round-tripped out of this app's own link comes
 * back unwrapped. So the longitude threshold is a whole turn, not half of one: a projected file
 * whose easting fell between 180 and 360 metres of its origin would have to be 180 m across.
 *
 * THE RESIDUAL GAP, STATED HONESTLY (S4 asks for exactly this). A projected file whose values
 * happen to fall inside +/-360 and +/-90 — a local grid in kilometres, say — still passes this
 * test. That is why a DECLARED CRS is always authoritative and is checked first: the magnitudes
 * only ever get to speak for a file that says nothing about itself.
 */
const LAT_LIMIT = 90;
const LON_LIMIT = 360;
const RANGE_EPS = 1e-9;

// ---- what comes out ------------------------------------------------------------------------------

export interface NormalizedPlace {
  /** the ONE property that survives the file, as PLAIN TEXT — see {@link plainText}. */
  name: string;
  /** unwrapped longitudes, rings closed, RFC 7946 winding: what `placeCodec` encodes and
   * `coverage` consumes, with no further conditioning needed by either. */
  geometry: AreaGeometry;
  /** dateline-aware, because it is measured on the unwrapped geometry: `[178, 51, 183, 53]` for the
   * Aleutian fixture where every parser S4 measured reports a 355 deg-wide box. */
  bbox: [number, number, number, number];
  vertices: number;
  /** which feature of the file this came from (`-1` for a union of all of them). */
  sourceIndex: number;
}

export type NormalizeResult =
  { ok: true; places: NormalizedPlace[] } | { ok: false; refusal: Refusal };

/**
 * Deliverable 4's LAST rule — "must touch the release's study area (`in_usa` cells), else
 * 'outside US waters: no scores'" — as a hook, not an implementation.
 *
 * It cannot live in here: it needs the release's cell table, which means the engine, the boot
 * manifest and a version. The caller (atlas-6 step 3's panel, or atlas-7's report) runs coverage
 * over these places against the release it already has, and returns a refusal if nothing lands.
 */
export type StudyAreaCheck = (places: NormalizedPlace[]) => Refusal | null;

export interface NormalizeOptions {
  /** what a multi-feature file becomes. The panel ASKS once; this module never decides. */
  multiFeature?: "perFeature" | "union";
  /** which property the name is taken from. `null`/absent -> the file name. */
  nameProperty?: string | null;
  /** used when the property is missing, empty, or the source is a union. */
  fallbackName?: string;
  maxVertices?: number;
  maxPlaces?: number;
  studyArea?: StudyAreaCheck;
}

// ---- rule 1: size, before extraction and before any parser is loaded ------------------------------

/**
 * The size rules, applied to BYTES ALONE.
 *
 * Deliberately separate from {@link normalizeParsed} and called first by {@link normalizeUpload}:
 * a zip bomb has to be refused by the sizes its own central directory declares, which means before
 * `shpjs` is imported, let alone run. Moving this call after the parse is one of the five seeded
 * faults in `docs/upload.md` § "Seeded faults", with the test it turns red.
 */
export function checkSize(
  fileName: string,
  bytes: Uint8Array,
  limits: { maxBytes?: number; maxZipBytes?: number; maxZipEntries?: number } = {},
): Refusal | null {
  const maxBytes = limits.maxBytes ?? MAX_FILE_BYTES;
  const maxZipBytes = limits.maxZipBytes ?? MAX_ZIP_UNCOMPRESSED_BYTES;
  const maxZipEntries = limits.maxZipEntries ?? MAX_ZIP_ENTRIES;

  if (bytes.length > maxBytes) return msg.fileTooLarge(fileName, bytes.length, maxBytes);
  if (!isZip(bytes)) return null;

  let totals: { entryCount: number; uncompressedBytes: number };
  try {
    totals = zipTotals(readZipCentralDirectory(bytes));
  } catch (err) {
    return msg.zipUnreadable(fileName, err instanceof ZipFormatError ? err.message : "unreadable");
  }
  if (totals.entryCount > maxZipEntries) {
    return msg.zipTooManyEntries(fileName, totals.entryCount, maxZipEntries);
  }
  if (totals.uncompressedBytes > maxZipBytes) {
    return msg.zipUncompressedTooLarge(fileName, totals.uncompressedBytes, maxZipBytes);
  }
  return null;
}

const isZip = (b: Uint8Array): boolean =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);

// ---- rules 3-9 -----------------------------------------------------------------------------------

/**
 * Every rule from "polygons only" onward, over one parser's output.
 *
 * Returns the FIRST refusal in Deliverable 4's order — never a list — because a person fixing a
 * file fixes one thing at a time, and a rule further down the order may only have fired because of
 * the one above it.
 */
export function normalizeParsed(
  parsed: ParsedSource,
  options: NormalizeOptions = {},
): NormalizeResult {
  const file = parsed.fileName;
  const maxVertices = options.maxVertices ?? MAX_VERTICES;
  const maxPlaces = options.maxPlaces ?? MAX_PLACES;

  if (!parsed.features.length) return no(msg.noFeatures(file));

  // --- rule 3: polygons only ---------------------------------------------------------------------
  const areas: { rings: Ring[][]; properties: Record<string, unknown>; index: number }[] = [];
  for (let i = 0; i < parsed.features.length; i++) {
    const f = parsed.features[i];
    if (!f.geometry || !f.geometry.type) return no(msg.noGeometry(file, i));
    const rings = ringsOfRawGeometry(f.geometry);
    if (!rings) {
      if (parsed.format === "gpx" && /LineString/.test(f.geometry.type)) {
        return no(msg.gpxTrackNotClosed(file));
      }
      return no(msg.notPolygon(file, article(f.geometry.type)));
    }
    areas.push({ rings, properties: f.properties, index: i });
  }

  // --- rule 4: finite, in range, not projected ---------------------------------------------------
  const crs = parsed.crs;
  const geographic = crs !== null && (crs.reprojected || crs.kind === "geographic");
  if (crs && !crs.reprojected && crs.kind === "projected") {
    return no(msg.projectedCrs(file, crs.raw));
  }
  let maxAbsLon = 0;
  let maxAbsLat = 0;
  for (const a of areas) {
    for (const poly of a.rings) {
      for (const ring of poly) {
        for (let v = 0; v < ring.length; v++) {
          const [x, y] = ring[v];
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return no(msg.coordinatesNotFinite(file, `vertex ${v + 1} of feature ${a.index + 1}`));
          }
          maxAbsLon = Math.max(maxAbsLon, Math.abs(x));
          maxAbsLat = Math.max(maxAbsLat, Math.abs(y));
        }
      }
    }
  }
  if (!geographic && (maxAbsLon > LON_LIMIT + RANGE_EPS || maxAbsLat > LAT_LIMIT + RANGE_EPS)) {
    // S4 rule 3, and rule 4's reason for existing: shpjs returns raw metres SILENTLY when the zip
    // has no .prj, so this is the only thing between those metres and a plausible-looking score.
    const where =
      maxAbsLat > LAT_LIMIT + RANGE_EPS
        ? `y up to ${format(maxAbsLat)}`
        : `x up to ${format(maxAbsLon)}`;
    return no(msg.projectedCoordinates(file, where));
  }
  if (maxAbsLat > LAT_LIMIT + RANGE_EPS) {
    return no(msg.coordinatesOutOfRange(file, `a latitude of ${format(maxAbsLat)}`));
  }
  if (maxAbsLon > LON_LIMIT + RANGE_EPS) {
    return no(msg.coordinatesOutOfRange(file, `a longitude of ${format(maxAbsLon)}`));
  }

  // --- rule 5: vertex budget ---------------------------------------------------------------------
  let vertices = 0;
  for (const a of areas)
    for (const poly of a.rings) for (const ring of poly) vertices += ring.length;
  if (vertices > maxVertices) return no(msg.tooManyVertices(file, vertices, maxVertices));

  // --- rules 6-8: rings, self-intersection, the antimeridian -------------------------------------
  const geometries: AreaGeometry[] = [];
  for (const a of areas) {
    let ringIndex = 0;
    for (const poly of a.rings) {
      for (const ring of poly) {
        if (closeRing(ring).length < 4) return no(msg.ringTooShort(file, ringIndex, ring.length));
        ringIndex++;
      }
    }
    // close -> unwrap -> join a seam split -> rewind. See this module's header for why the last two
    // cannot precede the first two, and why the reported ORDER is still Deliverable 4's.
    const closed: AreaGeometry = {
      type: "MultiPolygon",
      coordinates: a.rings.map((poly) => poly.map(closeRing)),
    };
    const rewound = collapse(rewind(joinSeamSplit(unwrapPolygon(closed))));

    for (const rings of polygonsOf(rewound)) {
      const hit = findSelfIntersection(rings);
      if (hit) return no(msg.selfIntersection(file, hit.a, hit.b, hit.at));
    }
    if (!isUnwrapped(rewound)) return no(msg.spanTooWide(file));
    geometries.push(rewound);
  }

  // --- rule 9: one place per feature, or one union ------------------------------------------------
  const mode = options.multiFeature ?? "perFeature";
  const fallback = options.fallbackName ?? baseName(file);
  if (mode === "union") {
    const parts = geometries.flatMap((g) => polygonsOf(g));
    return done(
      [place(fallback, collapse({ type: "MultiPolygon", coordinates: parts }), -1)],
      options,
    );
  }
  if (geometries.length > maxPlaces) {
    return no(msg.tooManyFeatures(file, geometries.length, maxPlaces));
  }
  const places = geometries.map((geometry, i) =>
    place(
      nameOf(areas[i].properties, options.nameProperty, fallback, i, geometries.length),
      geometry,
      areas[i].index,
    ),
  );
  return done(places, options);
}

// ---- the whole pipeline, bytes to places ----------------------------------------------------------

export interface UploadInput {
  name: string;
  bytes: Uint8Array;
}

/**
 * What the panel calls: bytes in, places or a refusal out, no parser loaded that the file does not
 * need. The size check runs BEFORE detection, and detection before any `import()`.
 */
export async function normalizeUpload(
  input: UploadInput,
  options: NormalizeOptions = {},
  deps: ParseDeps = {},
): Promise<NormalizeResult> {
  const sized = checkSize(input.name, input.bytes);
  if (sized) return { ok: false, refusal: sized };

  const { format, evidence } = detectFormat(input.name, input.bytes);
  if (!format) return { ok: false, refusal: msg.unknownFormat(input.name, evidence) };

  let parsed: ParsedSource;
  try {
    parsed = await parseByFormat(format, input.name, input.bytes, deps);
  } catch (err) {
    if (err instanceof UploadParseError) return { ok: false, refusal: err.refusal };
    return { ok: false, refusal: msg.parseFailed(input.name, label(format), detail(err)) };
  }
  return normalizeParsed(parsed, options);
}

// ---- helpers ---------------------------------------------------------------------------------------

const no = (refusal: Refusal): NormalizeResult => ({ ok: false, refusal });

function done(places: NormalizedPlace[], options: NormalizeOptions): NormalizeResult {
  const outside = options.studyArea?.(places) ?? null;
  return outside ? { ok: false, refusal: outside } : { ok: true, places };
}

/**
 * A one-part MultiPolygon is written back as a Polygon.
 *
 * Not cosmetic: the two spellings of the SAME Aleutian rectangle — wrapped in one ring, and split
 * RFC 7946-style into two parts that the seam join rejoins — must come out identical, and they
 * would otherwise differ only in this wrapper. It also keeps the `g1` codec's output the shorter of
 * the two shapes for the commonest case.
 */
export function collapse(geom: AreaGeometry): AreaGeometry {
  if (geom.type === "Polygon") return geom;
  return geom.coordinates.length === 1
    ? { type: "Polygon", coordinates: geom.coordinates[0] }
    : geom;
}

function place(name: string, geometry: AreaGeometry, sourceIndex: number): NormalizedPlace {
  let vertices = 0;
  for (const rings of polygonsOf(geometry)) for (const r of rings) vertices += r.length;
  return { name, geometry, bbox: bboxOf(geometry), vertices, sourceIndex };
}

/**
 * The rings of a raw geometry, or `null` when it is not an area.
 *
 * A GeometryCollection is accepted only when every member is an area — a mixed one is refused as
 * what it mostly is, because there is no defensible way to drop half a file silently.
 */
function ringsOfRawGeometry(g: {
  type: string;
  coordinates?: unknown;
  geometries?: unknown;
}): Ring[][] | null {
  if (g.type === "Polygon") {
    const rings = asRings(g.coordinates);
    return rings ? [rings] : null;
  }
  if (g.type === "MultiPolygon") {
    const parts = Array.isArray(g.coordinates) ? g.coordinates : null;
    if (!parts) return null;
    const out: Ring[][] = [];
    for (const p of parts) {
      const rings = asRings(p);
      if (!rings) return null;
      out.push(rings);
    }
    return out;
  }
  if (g.type === "GeometryCollection") {
    const members = Array.isArray(g.geometries) ? (g.geometries as { type: string }[]) : [];
    if (!members.length) return null;
    const out: Ring[][] = [];
    for (const m of members) {
      const rings = ringsOfRawGeometry(m);
      if (!rings) return null;
      out.push(...rings);
    }
    return out;
  }
  return null;
}

/**
 * A coordinate, or NaN — never a silent zero.
 *
 * `Number(null)` is 0 and `Number("")` is 0, so the obvious spelling turns a missing coordinate
 * into the Gulf of Guinea and rule 4 never fires. Only a real number, or a non-empty numeric
 * string, is a coordinate here; everything else is NaN and is refused by name.
 */
const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
};

function asRings(coords: unknown): Ring[] | null {
  if (!Array.isArray(coords) || !coords.length) return null;
  const out: Ring[] = [];
  for (const ring of coords) {
    if (!Array.isArray(ring)) return null;
    const positions: Ring = [];
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) return null;
      positions.push([num(p[0]), num(p[1])]);
    }
    out.push(positions);
  }
  return out;
}

/**
 * RFC 7946 winding: exterior rings counterclockwise, holes clockwise — computed only AFTER
 * unwrapping, because GDAL's shapefile writer stores the dateline fixture's ring in reverse
 * traversal order and `shpjs` faithfully reports the bytes it was given (S4). No downstream code
 * may read meaning from the input's ring order, so this is where it stops mattering.
 */
export function rewind(geom: AreaGeometry): AreaGeometry {
  const parts = polygonsOf(geom).map((rings) =>
    rings.map((ring, i) => {
      const ccw = ringArea2(ring) > 0;
      const want = i === 0; // outer ring CCW, holes CW
      return ccw === want ? ring : [...ring].reverse();
    }),
  );
  return geom.type === "Polygon"
    ? { type: "Polygon", coordinates: parts[0] ?? [] }
    : { type: "MultiPolygon", coordinates: parts };
}

/**
 * A name from an untrusted file, as PLAIN TEXT.
 *
 * It is NOT escaped and NOT sanitized beyond removing control characters and collapsing runs of
 * whitespace: escaping here would be a second encoding the panel would have to know about, and the
 * panel binds it as text (Svelte's `{name}`), which is the actual defence. So
 * `<img src=x onerror=alert(1)>` comes back byte for byte as those 28 characters — and
 * `tests/geo/upload/names.test.ts` asserts that byte-identity, because an escaped name passing
 * through a text binding would be VISIBLE to the user as `&lt;img ...&gt;`, which is its own bug.
 */
/** by code point rather than by a regex: a control-character class is itself unreadable source. */
function stripControl(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || c === 0x7f ? " " : ch;
  }
  return out;
}

export function plainText(value: unknown, max = MAX_NAME_CHARS): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  const cleaned = stripControl(s).replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max).trimEnd() : cleaned;
}

function nameOf(
  properties: Record<string, unknown>,
  property: string | null | undefined,
  fallback: string,
  index: number,
  total: number,
): string {
  const picked = property ? plainText(properties[property]) : "";
  if (picked) return picked;
  return total > 1 ? `${fallback} ${index + 1}` : fallback;
}

const baseName = (fileName: string): string => plainText(fileName.replace(/\.[A-Za-z0-9]+$/, ""));

const article = (type: string): string => (/^[AEIOU]/i.test(type) ? `an ${type}` : `a ${type}`);

const format = (v: number): string =>
  Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Number(v.toFixed(4)));

const label = (f: UploadFormat): string => FORMAT_LABELS[f];

const detail = (err: unknown): string => {
  const m = err instanceof Error ? err.message : String(err);
  const first = m.split("\n")[0].trim();
  return first.length > 90 ? `${first.slice(0, 87)}…` : first || "no reason given";
};
