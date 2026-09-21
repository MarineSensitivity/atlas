// The shared `g1` codec vectors. This file BUILDS tests/fixtures/place_codec.json; the test asserts
// the committed file still equals what it builds (so the file can never drift from the code) and
// separately checks hand-computed bytes, so the fixture is pinned from both ends.
//
// The same file is copied byte-identically into msens as inst/fixtures/place_codec.json, where the R
// twin must decode these tokens to the same integers — hence every vector carries its input
// geometry, precision, the exact integer sequence, the byte stream in hex and the token.
import {
  b64urlEncode as b64url,
  encodeGeometry,
  encodePlace,
  encodePlaces,
  decodeGeometry,
  choosePrecision,
  encodeName,
  quantizeGeometry,
  deltaStream,
  MAX_NAME_CHARS,
  URL_SILENT_MAX,
  URL_LONG_MAX,
  SIMPLIFY_TOLERANCES,
  type Place,
  type GeomPlace,
} from "../../src/lib/geo/placeCodec";
import { normalizeForAnalysis, wrappedEdge } from "../../src/lib/geo/unwrap";
import type { AreaGeometry, Position, Ring } from "../../src/lib/geo/types";

export const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const ring = (pts: Position[]): Position[] => [...pts, pts[0]];
const box = (x0: number, y0: number, x1: number, y1: number): Position[] =>
  ring([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);

/** the 30-vertex polygon the gate measures: a drawn circle, radius 0.28 deg (bbox 0.56 > 0.5). */
export function circle30(): AreaGeometry {
  const pts: Position[] = [];
  for (let k = 0; k < 30; k++) {
    const t = (2 * Math.PI * k) / 30;
    pts.push([
      Number((-89 + 0.28 * Math.cos(t)).toFixed(3)),
      Number((28 + 0.28 * Math.sin(t)).toFixed(3)),
    ]);
  }
  return { type: "Polygon", coordinates: [ring(pts)] };
}

export const GEOMS: Record<string, { name: string; geometry: AreaGeometry; why: string }> = {
  rect: {
    name: "Gulf box",
    geometry: { type: "Polygon", coordinates: [box(-90.0, 27.5, -89.0, 28.5)] },
    why: "the anchor vector: one ring, four vertices, precision 3. the byte stream is hand-computed in tests/geo/placeCodec.test.ts.",
  },
  poly30: {
    name: "circle30",
    geometry: circle30(),
    why: "30 vertices; the gate is <= 170 characters for the whole token.",
  },
  hole: {
    name: "ring with hole",
    geometry: {
      type: "Polygon",
      coordinates: [box(-90.0, 27.5, -89.0, 28.5), box(-89.75, 27.75, -89.25, 28.25)],
    },
    why: "two rings: the delta cursor RUNS ON from the last vertex of the outer ring into the first vertex of the hole. hand-computed too.",
  },
  multipolygon: {
    name: "two parts",
    geometry: {
      type: "MultiPolygon",
      coordinates: [[box(-90.0, 27.5, -89.95, 27.55)], [box(-89.9, 27.5, -89.85, 27.55)]],
    },
    why: "npoly = 2; the cursor runs on across polygons as well as rings.",
  },
  bering: {
    name: "Bering box",
    geometry: { type: "Polygon", coordinates: [box(170, 51, 190, 56)] },
    why: "longitudes are stored UNWRAPPED: 190 stays 190, so a decoder needs no antimeridian guess.",
  },
  small_p4: {
    name: "small box",
    geometry: { type: "Polygon", coordinates: [box(-89.4, 28.2, -89.3, 28.3)] },
    why: "bbox 0.1 deg < 0.5, so precision is 4 (0.0001 deg) instead of 3.",
  },
  name_reserved: {
    name: "Bahía ~ São, 50% .test",
    geometry: { type: "Polygon", coordinates: [box(-89.4, 28.2, -89.3, 28.3)] },
    why: "non-ASCII plus every character the grammar reserves (~ . , %): the name is percent-encoded UTF-8 over the unreserved set A-Za-z0-9_- , so none of them survives raw into the token.",
  },
  empty_name: {
    name: "",
    geometry: { type: "Polygon", coordinates: [box(-89.4, 28.2, -89.3, 28.3)] },
    why: "an unnamed place: the name part is empty, the two dots stay.",
  },
};

export const ZONES: Record<string, { place: Place; why: string }> = {
  zone_pa: {
    place: { kind: "zone", set: "pa", keys: ["CGM", "SOC", "GEO"] },
    why: "the `z.` form with several keys; the vintage comes from the release, never from the token.",
  },
  zone_reserved: {
    place: { kind: "zone", set: "er", keys: ["Gulf, North", "Chukchi~Beaufort", "a.b"] },
    why: "zone keys are percent-encoded with the same rule as names, so a key may contain , ~ or . safely.",
  },
};

/**
 * The geometry the BYTE-LEVEL encoder must refuse: the Bering box written WRAPPED
 * (`170 -> -170`), which is the same ground as `GEOMS.bering` and a different byte stream if a
 * codec quietly repaired it.
 *
 * Owed to msens and quoted verbatim from its commit `4d99721` (atlas-1 A1 round 2): D8 addendum
 * ruling 2, after the two languages were found to disagree about the same geometry because the
 * first ruling's wording invited both readings. `place_encode_strict()` (R) and `encodeGeometry()`
 * (here) both signal `wrapped`; `place_encode()` (R) and `normalizeForAnalysis()` + `encodePlace()`
 * (here) both yield the token below. Same high-level call, same token; same low-level call, same
 * error.
 */
export const WRAPPED_RING: Ring = [
  [170, 51],
  [-170, 51],
  [-170, 56],
  [170, 56],
  [170, 51],
];

export const ENCODE_REJECT_GEOMETRY: AreaGeometry = {
  type: "Polygon",
  coordinates: [WRAPPED_RING],
};

/** the widest consecutive-vertex longitude step in the ring, in degrees -- 340 here. */
function maxLonStep(ring: Ring): number {
  let m = 0;
  for (let i = 1; i < ring.length; i++) m = Math.max(m, Math.abs(ring[i][0] - ring[i - 1][0]));
  return m;
}

function encodeRejectVector() {
  const geometry = ENCODE_REJECT_GEOMETRY;
  const name = "Bering box";
  const normalized = normalizeForAnalysis(geometry);
  return {
    id: "reject_wrapped_ring",
    kind: "encode_reject",
    why:
      "the BYTE-LEVEL encoder refuses a ring that is still wrapped; the high-level entry " +
      "normalizes first and yields the bering token",
    name,
    precision: choosePrecision(normalized),
    geometry,
    code: "wrapped",
    // asserted, not asserted-about: wrappedEdge() must find it, and the step must be this wide
    wrapped_edge: wrappedEdge(WRAPPED_RING),
    max_step_deg: maxLonStep(WRAPPED_RING),
    unwrapped: normalized,
    token_via_high_level: encodePlace({ kind: "geom", name, geometry: normalized }),
  };
}

export const UPLOAD: { place: Place; why: string } = {
  place: { kind: "upload", name: "Big survey area", digest: "3f1a9c04" },
  why: "the `u.` form: the geometry was too large to carry even after the ladder, so the link names it and prompts a re-upload. sha256_8 = the first 8 hex characters of the sha256 of the canonical GeoJSON.",
};

function geomVector(id: string, g: { name: string; geometry: AreaGeometry; why: string }) {
  const precision = choosePrecision(g.geometry);
  const bytes = encodeGeometry(g.geometry, precision);
  const place: GeomPlace = { kind: "geom", name: g.name, geometry: g.geometry };
  const token = encodePlace(place);
  const decoded = decodeGeometry(bytes);
  const ints = quantizeGeometry(g.geometry, precision);
  let dev = 0;
  const flat = (x: AreaGeometry) =>
    (x.type === "Polygon" ? [x.coordinates] : x.coordinates).flat(2) as Position[];
  const a = flat(g.geometry);
  const b = flat(decoded.geometry);
  for (let i = 0; i < a.length; i++) {
    dev = Math.max(dev, Math.abs(a[i][0] - b[i][0]), Math.abs(a[i][1] - b[i][1]));
  }
  return {
    id,
    kind: "geom",
    why: g.why,
    name: g.name,
    name_encoded: encodeName(g.name),
    precision,
    geometry: g.geometry,
    ints,
    deltas: deltaStream(ints),
    bytes_hex: hex(bytes),
    bytes_length: bytes.length,
    token,
    token_length: token.length,
    decoded: decoded.geometry,
    max_deviation_deg: dev,
  };
}

export function buildFixture() {
  const vectors = Object.entries(GEOMS).map(([id, g]) => geomVector(id, g));
  const zones = Object.entries(ZONES).map(([id, z]) => ({
    id,
    kind: "zone",
    why: z.why,
    place: z.place,
    token: encodePlace(z.place),
  }));
  const upload = {
    id: "upload",
    kind: "upload",
    why: UPLOAD.why,
    place: UPLOAD.place,
    token: encodePlace(UPLOAD.place),
  };
  const multi = [
    { kind: "geom", name: GEOMS.rect.name, geometry: GEOMS.rect.geometry } as Place,
    ZONES.zone_pa.place,
    UPLOAD.place,
  ];
  return {
    codec: "g1",
    note: [
      "Shared vectors for the atlas place codec `g1` (plan D8). This file is the SAME file in both",
      "repos: atlas tests/fixtures/place_codec.json == msens inst/fixtures/place_codec.json, byte for",
      "byte. The R twin must decode every `token` below to exactly the `ints` given, and encode the",
      "same geometry back to the same `token`.",
    ].join(" "),
    grammar: {
      hash: '#pl = place ("~" place)*',
      place: [
        '"z." set "." key ("," key)*   set in pa|pl|er|sr (the vintage comes from the release)',
        '"g1." name "." b64url(bytes)  name = percent-encoded UTF-8, <= 60 characters',
        '"u." name "." sha256_8        an upload too large to carry; prompts a re-upload',
      ],
      bytes: [
        "0x10, precision:u8 (3 by default; 4 when the bbox is < 0.5 deg),",
        "npoly:varint, per polygon nring:varint, per ring npt:varint (the closing vertex is omitted),",
        "per vertex zigzag-varint(dlon), zigzag-varint(dlat), in units of 10^-precision.",
        "The delta cursor starts at (0,0) and RUNS ACROSS rings and polygons.",
        "No compression: delta varints are already dense and raw-deflate has no base-R twin.",
        "Longitudes are stored UNWRAPPED (a Bering polygon runs 170..190).",
      ].join(" "),
      varint: "LEB128, 7 bits per byte, low group first, high bit = continue",
      zigzag: "n >= 0 ? 2n : -2n - 1  (so -1 -> 1, 1 -> 2, -2 -> 3)",
      base64url: "RFC 4648 section 5 alphabet A-Za-z0-9-_ , NO padding",
      name_encoding: {
        unreserved: "A-Za-z0-9_-",
        escape: "every other UTF-8 byte as %XX with UPPERCASE hex",
        max_encoded_chars: MAX_NAME_CHARS,
      },
      quantize:
        "q = round_half_even(coord * 10^precision); the decoded coord is q / 10^precision, so the deviation is <= 0.5 * 10^-precision",
    },
    budgets: {
      url_silent_max: URL_SILENT_MAX,
      url_long_max: URL_LONG_MAX,
      simplify_tolerances_deg: SIMPLIFY_TOLERANCES,
      simplify_rule:
        "Douglas-Peucker, tolerance 0.001 deg doubling to 0.02 deg, a step accepted only while the area change is <= 1 % and every ring stays simple; then the `u.` form.",
      analysis_rule: "every analysis runs on decode(encode(geometry)), never on the input geometry",
    },
    vectors,
    zones,
    upload,
    multiple: {
      why: 'several places in one hash, joined with "~"',
      places: multi,
      hash: encodePlaces(multi),
    },
    reject: rejects(),
    // tokens a DECODER must refuse live in `reject`; this is the one geometry an ENCODER must
    // refuse, which is a different question and therefore its own list (msens 4d99721).
    encode_reject: [encodeRejectVector()],
  };
}

/** tokens a decoder MUST refuse, each with the byte-level reason. */
function rejects() {
  const good = encodeGeometry(GEOMS.rect.geometry, 3);
  const tok = (bytes: number[] | Uint8Array) => `g1.name.${b64url(Uint8Array.from(bytes))}`;
  const badMagic = Uint8Array.from(good);
  badMagic[0] = 0x11;
  const longName = "x".repeat(MAX_NAME_CHARS + 1);
  return [
    { token: "", code: "empty", why: "empty token" },
    { token: "g1", code: "shape", why: "no dot-separated parts at all" },
    { token: "g1.name", code: "shape", why: "missing the payload part" },
    {
      token: "g1.name.AAAA.BBBB",
      code: "shape",
      why: "too many parts: a literal dot inside a name must be %2E",
    },
    { token: "g1.name.A+B/C=", code: "b64", why: "base64url has no +, / or = " },
    { token: "g1.name.", code: "empty", why: "empty payload" },
    { token: `g2.name.${b64url(good)}`, code: "scheme", why: "unknown codec prefix" },
    { token: "z.xx.CGM", code: "set", why: "unknown zone set (pa|pl|er|sr)" },
    { token: "z.pa.", code: "empty", why: "no zone keys" },
    { token: "u.name.3f1a9c0", code: "digest", why: "sha256_8 is exactly 8 lowercase hex chars" },
    { token: "u.name.3F1A9C04", code: "digest", why: "sha256_8 is lowercase" },
    { token: `g1.${longName}.${b64url(good)}`, code: "name", why: "name over 60 characters" },
    { token: tok(badMagic), code: "magic", why: "wrong magic byte (0x11, not 0x10)" },
    { token: tok([0x10, 0x00, 1, 1, 3]), code: "precision", why: "precision 0" },
    { token: tok([0x10, 3, 0]), code: "empty", why: "npoly = 0" },
    { token: tok([0x10, 3, 1, 0]), code: "empty", why: "a polygon with no rings" },
    {
      token: tok([0x10, 3, 1, 1, 2, 0, 0, 2, 2]),
      code: "degenerate",
      why: "a ring with fewer than 3 vertices",
    },
    {
      token: tok(good.slice(0, good.length - 3)),
      code: "truncated",
      why: "the vertex stream stops mid-ring",
    },
    { token: tok([...good, 0]), code: "trailing", why: "bytes after the last vertex" },
    { token: tok([0x10, 3, 0x80]), code: "truncated", why: "a varint that never terminates" },
  ];
}
