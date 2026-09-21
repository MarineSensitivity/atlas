// The `g1` place codec — the link IS the analysis input (plan D8, atlas-2 "Place codec g1").
//
//   #pl   = place ("~" place)*
//   place = "z." set "." key ("," key)*      set in pa|pl|er|sr (the vintage comes from the release)
//         | "g1." name "." b64url(bytes)     name = percent-encoded UTF-8, <= 60 chars
//         | "u."  name "." sha256_8          an upload too large to carry; prompts a re-upload
//   bytes = 0x10, precision:u8 (3 by default; 4 when the bbox is < 0.5 deg), npoly:varint,
//           per polygon nring:varint, per ring npt:varint (the closing vertex is omitted),
//           per vertex zigzag-varint(dlon), zigzag-varint(dlat), units 10^-precision,
//           and the delta cursor RUNS ACROSS rings and polygons.
//
// No compression: delta varints are already dense, and raw-deflate has no base-R twin — msens has
// to decode these tokens too (tests/fixtures/place_codec.json == msens inst/fixtures/place_codec.json,
// byte for byte). Longitudes are stored UNWRAPPED (a Bering polygon runs 170...190), so a decoder
// never has to guess at the antimeridian.
//
// EVERY ANALYSIS RUNS ON decode(encode(geometry)) — see `roundTrip()`. Never on the geometry the
// user drew or uploaded: a shared link must reproduce the sender's numbers exactly, and the only
// geometry the recipient can possibly have is the decoded one.
import { roundHalfEven } from "./round";
import {
  bboxOf,
  closeRing,
  geometryArea,
  openRing,
  polygonsOf,
  type AreaGeometry,
  type Position,
} from "./types";
import { douglasPeucker, ringIsSimple } from "./simplify";
import { MAX_LON_STEP, wrappedEdge } from "./unwrap";

export const MAGIC = 0x10;
export const CODEC = "g1";
export const MAX_NAME_CHARS = 60;
/** whole-URL budgets: silent up to 2,000 characters, "long link" up to 8,000 (atlas-2) */
export const URL_SILENT_MAX = 2000;
export const URL_LONG_MAX = 8000;
/** Douglas-Peucker ladder: 0.001 deg doubling while it stays <= 0.02 deg */
export const SIMPLIFY_TOLERANCES = [0.001, 0.002, 0.004, 0.008, 0.016];
/** a simplification step is accepted only while the area moves by no more than this */
export const MAX_AREA_CHANGE = 0.01;

export const ZONE_SETS = ["pa", "pl", "er", "sr"] as const;
export type ZoneSet = (typeof ZONE_SETS)[number];

export interface GeomPlace {
  kind: "geom";
  name: string;
  geometry: AreaGeometry;
  /** forced precision; omitted means `choosePrecision(geometry)` */
  precision?: number;
}
export interface ZonePlace {
  kind: "zone";
  set: ZoneSet;
  keys: string[];
}
export interface UploadPlace {
  kind: "upload";
  name: string;
  /** the first 8 hex characters of the sha256 of the canonical GeoJSON */
  digest: string;
}
export type Place = GeomPlace | ZonePlace | UploadPlace;

export class PlaceCodecError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PlaceCodecError";
    this.code = code;
  }
}
const fail = (code: string, msg: string): never => {
  throw new PlaceCodecError(code, msg);
};

// ---- varints ---------------------------------------------------------------------------------

/** zigzag: 0 -> 0, -1 -> 1, 1 -> 2, -2 -> 3 ... (arithmetic, not bitwise: a delta can exceed 2^31) */
export const zigzag = (n: number): number => (n >= 0 ? 2 * n : -2 * n - 1);
export const unzigzag = (n: number): number => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function pushVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) + 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

function readVarint(b: Uint8Array, at: number): [number, number] {
  let v = 0;
  let scale = 1;
  let i = at;
  for (; i < b.length; i++) {
    v += (b[i] & 0x7f) * scale;
    if ((b[i] & 0x80) === 0) return [v, i + 1];
    scale *= 128;
    if (scale > 2 ** 53) fail("varint", "varint too long");
  }
  return fail("truncated", "varint runs past the end of the byte stream");
}

// ---- base64url -------------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INV = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < B64.length; i++) m.set(B64[i], i);
  return m;
})();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes.length - i;
    const a = bytes[i];
    const b = n > 1 ? bytes[i + 1] : 0;
    const c = n > 2 ? bytes[i + 2] : 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    if (n > 1) s += B64[((b & 15) << 2) | (c >> 6)];
    if (n > 2) s += B64[c & 63];
  }
  return s; // no padding: "=" would have to be percent-encoded in a URL
}

export function b64urlDecode(s: string): Uint8Array {
  if (s.length % 4 === 1) fail("b64", `not a base64url payload: length ${s.length}`);
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64_INV.get(ch);
    if (v === undefined) fail("b64", `'${ch}' is not a base64url character`);
    acc = acc * 64 + (v as number);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push(Math.floor(acc / 2 ** bits) & 0xff);
      acc %= 2 ** bits;
    }
  }
  return Uint8Array.from(out);
}

// ---- names and keys --------------------------------------------------------------------------

const UNRESERVED = /[A-Za-z0-9_-]/;

/**
 * Percent-encoded UTF-8 over the unreserved set `A-Za-z0-9_-`.
 *
 * NOT `encodeURIComponent`, which leaves `.` and `~` raw — and those two ARE the grammar's
 * delimiters, so a place called "St. George ~ Basin" would split into pieces that are not places.
 */
export function encodeName(s: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(s)) {
    const ch = String.fromCharCode(byte);
    out += UNRESERVED.test(ch) ? ch : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function decodeName(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "%") {
      const hex = s.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) fail("name", `bad percent escape at ${i}`);
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      if (!UNRESERVED.test(s[i])) fail("name", `'${s[i]}' must be percent-encoded`);
      bytes.push(s.charCodeAt(i));
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** the longest prefix of `name` whose encoded form fits MAX_NAME_CHARS (never splits a character). */
export function clampName(name: string): string {
  if (encodeName(name).length <= MAX_NAME_CHARS) return name;
  const chars = Array.from(name);
  let out = "";
  for (const c of chars) {
    if (encodeName(out + c).length > MAX_NAME_CHARS) break;
    out += c;
  }
  return out;
}

// ---- geometry <-> bytes ----------------------------------------------------------------------

/** poly -> ring -> vertex -> [lon, lat], in units of 10^-precision */
export type QuantGeometry = number[][][][];

/** precision 3 (about 110 m) by default; 4 for a small place, whose bbox is under half a degree. */
export function choosePrecision(geom: AreaGeometry): number {
  const [x0, y0, x1, y1] = bboxOf(geom);
  return x1 - x0 < 0.5 && y1 - y0 < 0.5 ? 4 : 3;
}

export function quantizeGeometry(geom: AreaGeometry, precision: number): QuantGeometry {
  const f = 10 ** precision;
  return polygonsOf(geom).map((rings) =>
    rings.map((ring) =>
      openRing(ring).map(([x, y]) => [roundHalfEven(x * f), roundHalfEven(y * f)]),
    ),
  );
}

/** the signed delta sequence exactly as it goes into the byte stream (lon, lat, lon, lat, ...). */
export function deltaStream(q: QuantGeometry): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (const rings of q) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        out.push(x - px, y - py);
        px = x;
        py = y;
      }
    }
  }
  return out;
}

/**
 * `g1` only ever stores UNWRAPPED rings (plan D8 addendum), so the encode path REFUSES a ring that
 * still steps more than 180 deg in longitude rather than storing it and letting the recipient's
 * coverage read the 359.8 deg complement of what the sender drew.
 *
 * The caller's fix is `normalizeForAnalysis()` from ./unwrap.ts, named in the message: unwrapping
 * is one explicit shared rule that runs at the input boundary, never quietly inside a codec.
 */
function refuseWrapped(geom: AreaGeometry): void {
  polygonsOf(geom).forEach((rings, p) =>
    rings.forEach((ring, r) => {
      const k = wrappedEdge(ring);
      if (k < 0) return;
      fail(
        "wrapped",
        `polygon ${p} ring ${r} steps ${(ring[k][0] - ring[k - 1][0]).toFixed(4)} deg of longitude ` +
          `between vertices ${k - 1} and ${k} (${ring[k - 1][0]} -> ${ring[k][0]}), more than the ` +
          `${MAX_LON_STEP} deg limit: g1 stores unwrapped longitudes only. ` +
          `Run normalizeForAnalysis() from geo/unwrap.ts on this geometry first.`,
      );
    }),
  );
}

export function encodeGeometry(geom: AreaGeometry, precision = choosePrecision(geom)): Uint8Array {
  if (!Number.isInteger(precision) || precision < 1 || precision > 9)
    fail("precision", `precision must be an integer 1-9, got ${precision}`);
  refuseWrapped(geom);
  const q = quantizeGeometry(geom, precision);
  if (!q.length) fail("empty", "a place needs at least one polygon");
  const out: number[] = [MAGIC, precision];
  pushVarint(out, q.length);
  let px = 0;
  let py = 0;
  for (const rings of q) {
    if (!rings.length) fail("empty", "a polygon needs at least one ring");
    pushVarint(out, rings.length);
    for (const ring of rings) {
      if (ring.length < 3) fail("degenerate", "a ring needs at least 3 distinct vertices");
      pushVarint(out, ring.length);
      for (const [x, y] of ring) {
        pushVarint(out, zigzag(x - px));
        pushVarint(out, zigzag(y - py));
        px = x;
        py = y;
      }
    }
  }
  return Uint8Array.from(out);
}

export function decodeGeometry(bytes: Uint8Array): { geometry: AreaGeometry; precision: number } {
  if (bytes.length < 3) fail("truncated", "byte stream too short");
  if (bytes[0] !== MAGIC)
    fail("magic", `expected magic 0x${MAGIC.toString(16)}, got 0x${bytes[0].toString(16)}`);
  const precision = bytes[1];
  if (precision < 1 || precision > 9) fail("precision", `precision ${precision} out of range`);
  const f = 10 ** precision;
  let at = 2;
  const next = (): number => {
    const [v, i] = readVarint(bytes, at);
    at = i;
    return v;
  };
  const npoly = next();
  if (npoly < 1) fail("empty", "npoly is 0");
  let px = 0;
  let py = 0;
  const polys: Position[][][] = [];
  for (let p = 0; p < npoly; p++) {
    const nring = next();
    if (nring < 1) fail("empty", `polygon ${p} has no rings`);
    const rings: Position[][] = [];
    for (let r = 0; r < nring; r++) {
      const npt = next();
      if (npt < 3) fail("degenerate", `ring ${r} of polygon ${p} has ${npt} vertices`);
      const ring: Position[] = [];
      for (let k = 0; k < npt; k++) {
        px += unzigzag(next());
        py += unzigzag(next());
        ring.push([px / f, py / f]);
      }
      rings.push(closeRing(ring));
    }
    polys.push(rings);
  }
  if (at !== bytes.length) fail("trailing", `${bytes.length - at} byte(s) after the last vertex`);
  const geometry: AreaGeometry =
    polys.length === 1
      ? { type: "Polygon", coordinates: polys[0] }
      : { type: "MultiPolygon", coordinates: polys };
  return { geometry, precision };
}

/**
 * decode(encode(geometry)) — the geometry every analysis must run on (plan D8).
 *
 * Call it once when a place enters the app (drawn, uploaded, or read from a link) and keep the
 * result: scores, species, area and the drawn outline then all describe the same polygon the
 * recipient of the link will see.
 */
export function roundTrip(geom: AreaGeometry, precision?: number): AreaGeometry {
  return decodeGeometry(encodeGeometry(geom, precision ?? choosePrecision(geom))).geometry;
}

// ---- tokens ----------------------------------------------------------------------------------

export function encodePlace(place: Place): string {
  if (place.kind === "zone") {
    if (!ZONE_SETS.includes(place.set)) fail("set", `unknown zone set '${place.set}'`);
    if (!place.keys.length) fail("empty", "a zone place needs at least one key");
    return `z.${place.set}.${place.keys.map(encodeName).join(",")}`;
  }
  if (place.kind === "upload") {
    if (!/^[0-9a-f]{8}$/.test(place.digest)) fail("digest", "digest must be 8 lowercase hex chars");
    return `u.${encodeName(clampName(place.name))}.${place.digest}`;
  }
  const bytes = encodeGeometry(place.geometry, place.precision ?? choosePrecision(place.geometry));
  return `${CODEC}.${encodeName(clampName(place.name))}.${b64urlEncode(bytes)}`;
}

export function decodePlace(token: string): Place {
  if (!token) fail("empty", "empty place token");
  const parts = token.split(".");
  if (parts.length !== 3)
    fail("shape", `a place token has exactly 3 dot-separated parts, got ${parts.length}`);
  const [scheme, name, payload] = parts;
  if (name.length > MAX_NAME_CHARS)
    fail("name", `name is ${name.length} > ${MAX_NAME_CHARS} chars`);
  if (scheme === "z") {
    if (!(ZONE_SETS as readonly string[]).includes(name)) fail("set", `unknown zone set '${name}'`);
    if (!payload) fail("empty", "a zone place needs at least one key");
    return { kind: "zone", set: name as ZoneSet, keys: payload.split(",").map(decodeName) };
  }
  if (scheme === "u") {
    if (!/^[0-9a-f]{8}$/.test(payload)) fail("digest", "digest must be 8 lowercase hex chars");
    return { kind: "upload", name: decodeName(name), digest: payload };
  }
  if (scheme !== CODEC) fail("scheme", `unknown place scheme '${scheme}'`);
  if (!payload) fail("empty", "empty payload");
  const { geometry, precision } = decodeGeometry(b64urlDecode(payload));
  return { kind: "geom", name: decodeName(name), geometry, precision };
}

/** decodePlace that answers null instead of throwing — the URL parser must never throw (atlas-2). */
export function tryDecodePlace(token: string): Place | null {
  try {
    return decodePlace(token);
  } catch {
    return null;
  }
}

export function encodePlaces(places: Place[]): string {
  return places.map(encodePlace).join("~");
}

/** every place in a `#pl` value; unreadable tokens are dropped, never thrown (atlas-2 state rules). */
export function decodePlaces(hash: string): Place[] {
  if (!hash) return [];
  return hash
    .split("~")
    .map(tryDecodePlace)
    .filter((p): p is Place => p !== null);
}

// ---- the URL-length ladder ---------------------------------------------------------------------

export interface FitOptions {
  /** length of everything in the URL that is not this `#pl` value */
  baseLength?: number;
  silentMax?: number;
  longMax?: number;
  /** injectable for tests; defaults to sha256 over the canonical GeoJSON */
  digest?: (geom: AreaGeometry) => Promise<string>;
}

export interface FitResult {
  places: Place[];
  hash: string;
  length: number;
  /** `ok` <= 2,000 chars; `long` <= 8,000 with a note; `upload` = the geometry could not be carried */
  status: "ok" | "long" | "upload";
  simplified: boolean;
  tolerance: number | null;
  note: string | null;
}

/** the first 8 hex characters of the sha256 of the canonical GeoJSON of a geometry. */
export async function digest8(geom: AreaGeometry): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(geom));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf).slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Fit places into the URL budget: silent to 2,000 characters, a "long link" note to 8,000, then the
 * Douglas-Peucker ladder (0.001 deg doubling to 0.02 deg, a step taken only while the area moves by
 * <= 1 % and every ring stays simple), then the `u.` form and "download place as GeoJSON".
 */
export async function fitPlacesToUrl(places: Place[], opts: FitOptions = {}): Promise<FitResult> {
  const base = opts.baseLength ?? 0;
  const silent = opts.silentMax ?? URL_SILENT_MAX;
  const long = opts.longMax ?? URL_LONG_MAX;
  const digest = opts.digest ?? digest8;

  const result = (p: Place[], status: FitResult["status"], tol: number | null): FitResult => {
    const hash = encodePlaces(p);
    return {
      places: p,
      hash,
      length: base + hash.length,
      status,
      simplified: tol !== null,
      tolerance: tol,
      note:
        status === "long"
          ? "long link"
          : status === "upload"
            ? "place too large to carry in a link — download it as GeoJSON"
            : tol !== null
              ? `simplified to ${tol} deg`
              : null,
    };
  };

  const at = (p: Place[], tol: number | null): FitResult | null => {
    const r = result(p, "ok", tol);
    if (r.length <= silent) return r;
    if (r.length <= long) return result(p, "long", tol);
    return null;
  };

  const first = at(places, null);
  if (first) return first;

  // each rung simplifies the ORIGINAL geometry at a coarser tolerance, never a simplification of a
  // simplification: the 1 % area test has to measure against what the user actually drew
  let best = places;
  let bestTol: number | null = null;
  for (const tol of SIMPLIFY_TOLERANCES) {
    const tried: Place[] = [];
    let accepted = true;
    for (const p of places) {
      if (p.kind !== "geom") {
        tried.push(p);
        continue;
      }
      const s = simplifyPlace(p, tol);
      if (!s) {
        accepted = false;
        break;
      }
      tried.push(s);
    }
    if (!accepted) continue; // refused rung: keep the last accepted geometry and try coarser
    best = tried;
    bestTol = tol;
    const r = at(best, tol);
    if (r && r.status === "ok") return r;
  }
  const last = at(best, bestTol);
  if (last) return last;

  // nothing fits: name the geometry and ask for it to be uploaded again
  const uploads: Place[] = [];
  for (const p of places) {
    uploads.push(
      p.kind === "geom" ? { kind: "upload", name: p.name, digest: await digest(p.geometry) } : p,
    );
  }
  return result(uploads, "upload", null);
}

/**
 * One rung of the ladder: Douglas-Peucker at `tol`, accepted only while the area moves by no more
 * than 1 % and every ring stays simple. `null` = this rung is refused, so the caller keeps the last
 * accepted geometry rather than shipping a self-intersecting or visibly different place.
 */
export function simplifyPlace(place: GeomPlace, tol: number): GeomPlace | null {
  const before = geometryArea(place.geometry);
  const rings = polygonsOf(place.geometry).map((poly) =>
    poly.map((ring) => closeRing(douglasPeucker(ring, tol))),
  );
  if (rings.some((poly) => poly.some((r) => r.length < 4 || !ringIsSimple(r)))) return null;
  const geometry: AreaGeometry =
    place.geometry.type === "Polygon"
      ? { type: "Polygon", coordinates: rings[0] }
      : { type: "MultiPolygon", coordinates: rings };
  const after = geometryArea(geometry);
  if (before > 0 && Math.abs(after - before) / before > MAX_AREA_CHANGE) return null;
  return { ...place, geometry };
}
