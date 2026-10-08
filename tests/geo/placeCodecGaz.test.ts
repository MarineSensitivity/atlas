// the `p.` (gazetteer place_id) token kind of the g1 codec (gazetteer-places). Four checks:
//  1. the HAND-WRITTEN vectors in tests/fixtures/place_codec_place_id.json, both directions (the
//     file msens copies when its R mirror adds the kind -- so the strings below are the spec);
//  2. round trip of arbitrary ids/names (dots, tildes, spaces, non-ASCII), and the length limits;
//  3. BACKWARD COMPATIBILITY: every token in the shared place_codec.json still decodes exactly as
//     before, an OLD hash (no `p.` token) decodes to the same places, and mixed hashes work;
//  4. rejection: malformed `p.` tokens are errors from decodePlace and silently dropped from a hash
//     (decodePlaces never throws), never mis-read as another kind.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_ID_CHARS,
  MAX_NAME_CHARS,
  PlaceCodecError,
  decodePlace,
  decodePlaces,
  encodePlace,
  encodePlaces,
  fitPlacesToUrl,
  tryDecodePlace,
  type GazPlace,
  type Place,
} from "../../src/lib/geo/placeCodec";

const fx = JSON.parse(
  readFileSync(new URL("../fixtures/place_codec_place_id.json", import.meta.url), "utf8"),
);
const shared = JSON.parse(
  readFileSync(new URL("../fixtures/place_codec.json", import.meta.url), "utf8"),
);

describe("p. vectors (tests/fixtures/place_codec_place_id.json)", () => {
  for (const v of fx.vectors) {
    it(`${v.id} <-> ${v.token}`, () => {
      expect(encodePlace({ kind: "gaz", id: v.id, name: v.name })).toBe(v.token);
      expect(decodePlace(v.token)).toEqual({ kind: "gaz", id: v.id, name: v.name });
    });
  }
  it("the literal grammar example from the docs", () => {
    expect(encodePlace({ kind: "gaz", id: "BOEM:OCS-P 0562", name: "" })).toBe(
      "p.BOEM%3AOCS-P%200562.",
    );
  });
  it("the hash vector decodes to the stated kinds and re-encodes byte for byte", () => {
    for (const h of fx.hash_vectors) {
      const places = decodePlaces(h.hash);
      expect(places.map((p) => p.kind)).toEqual(h.kinds);
      expect(encodePlaces(places)).toBe(h.hash);
    }
  });
});

describe("round trip", () => {
  const cases: GazPlace[] = [
    { kind: "gaz", id: "BOEM:OCS-P 0562", name: "Lease OCS-P 0562" },
    { kind: "gaz", id: "a.b.c~d", name: "x.y~z" },
    { kind: "gaz", id: "MRGID:8439", name: "" },
    { kind: "gaz", id: "NMS:HIHWNMS", name: "Hawaiian Islands Humpback Whale" },
    { kind: "gaz", id: "ÅÖ:日本", name: "日本海" },
  ];
  for (const c of cases) {
    it(`${JSON.stringify(c.id)}`, () => {
      const token = encodePlace(c);
      expect(token.split(".")).toHaveLength(3); // the delimiters stay unambiguous
      expect(token).not.toMatch(/[~\s:]/);
      expect(decodePlace(token)).toEqual(c);
    });
  }
  it("a clamped name round-trips to the clamped name (60 encoded chars, never mid-character)", () => {
    const long = "é".repeat(40); // 6 encoded chars each... clampName cuts at 60
    const back = decodePlace(encodePlace({ kind: "gaz", id: "X:1", name: long })) as GazPlace;
    expect(long.startsWith(back.name)).toBe(true);
    expect(encodePlace(back).split(".")[2].length).toBeLessThanOrEqual(MAX_NAME_CHARS);
  });
  it("encodePlace refuses an empty id and an over-long id", () => {
    expect(() => encodePlace({ kind: "gaz", id: "", name: "x" })).toThrow(PlaceCodecError);
    expect(() =>
      encodePlace({ kind: "gaz", id: "A:" + "b".repeat(MAX_ID_CHARS), name: "" }),
    ).toThrow(/place_id/);
    // the boundary itself is fine (all-unreserved characters encode 1:1)
    expect(() =>
      encodePlace({ kind: "gaz", id: "b".repeat(MAX_ID_CHARS), name: "" }),
    ).not.toThrow();
  });
  it("fitPlacesToUrl carries a p. place through untouched (it has no geometry to simplify)", async () => {
    const places: Place[] = [{ kind: "gaz", id: "NMS:CINMS", name: "Channel Islands" }];
    const r = await fitPlacesToUrl(places);
    expect(r.status).toBe("ok");
    expect(r.hash).toBe("p.NMS%3ACINMS.Channel%20Islands");
  });
});

describe("backward compatibility: old hashes keep decoding", () => {
  it("every shared-fixture token still decodes (kind and payload) with the new kind present", () => {
    expect(shared.vectors.length).toBeGreaterThan(0);
    for (const v of shared.vectors) {
      const p = decodePlace(v.token);
      expect(p.kind).toBe(v.kind);
      expect(encodePlace(p)).toBe(v.token);
    }
  });
  it("an old hash (zone + upload + geom, no p.) decodes to the same places as before", () => {
    const geomToken = shared.vectors.find((v: { kind: string }) => v.kind === "geom").token;
    const hash = `z.pa.GAA,WGA~${geomToken}~u.Big%20one.deadbeef`;
    const places = decodePlaces(hash);
    expect(places.map((p) => p.kind)).toEqual(["zone", "geom", "upload"]);
    expect(places[0]).toEqual({ kind: "zone", set: "pa", keys: ["GAA", "WGA"] });
    expect(places[2]).toEqual({ kind: "upload", name: "Big one", digest: "deadbeef" });
    expect(encodePlaces(places)).toBe(hash);
  });
  it("a mixed hash round-trips in order", () => {
    const geomToken = shared.vectors.find((v: { kind: string }) => v.kind === "geom").token;
    const hash = `p.BOEM%3AOCS-P%200562.~${geomToken}~z.pl.ABC~p.NMS%3ACINMS.Channel%20Islands`;
    const places = decodePlaces(hash);
    expect(places.map((p) => p.kind)).toEqual(["gaz", "geom", "zone", "gaz"]);
    expect(encodePlaces(places)).toBe(hash);
  });
  it("a hash from BEFORE this kind existed is not changed by `p` being a known scheme", () => {
    // 'p' was an unknown scheme (dropped); the other unknown schemes still are
    expect(tryDecodePlace("q.abc.def")).toBeNull();
    expect(decodePlaces("q.abc.def~z.pa.GAA")).toEqual([
      { kind: "zone", set: "pa", keys: ["GAA"] },
    ]);
  });
});

describe("malformed p. tokens", () => {
  for (const bad of fx.invalid) {
    it(`${bad.token}: ${bad.why}`, () => {
      expect(() => decodePlace(bad.token)).toThrow(PlaceCodecError);
      expect(tryDecodePlace(bad.token)).toBeNull();
    });
  }
  it("decodePlaces drops a malformed p. token and keeps its neighbours", () => {
    expect(decodePlaces("z.pa.GAA~p.NMS%3ACINMS~p.NMS%3ACINMS.ok")).toEqual([
      { kind: "zone", set: "pa", keys: ["GAA"] },
      { kind: "gaz", id: "NMS:CINMS", name: "ok" },
    ]);
  });
  it("an over-long id or name is rejected on decode", () => {
    expect(() => decodePlace(`p.${"a".repeat(MAX_ID_CHARS + 1)}.x`)).toThrow(/place_id/);
    expect(() => decodePlace(`p.NMS%3AX.${"a".repeat(MAX_NAME_CHARS + 1)}`)).toThrow(/name/);
  });
});
