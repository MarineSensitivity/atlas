// the `g1` place codec (plan D8, atlas-2). Three independent kinds of check:
//
//  1. HAND-COMPUTED bytes for two vectors (one ring, two rings). Encode and decode are inverses of
//     each other, so a sign flip in zigzag or a delta cursor reset per ring would round-trip
//     perfectly and prove nothing — only a literal byte stream catches those.
//  2. the committed tests/fixtures/place_codec.json, which is the SAME FILE msens carries as
//     inst/fixtures/place_codec.json: every token decodes to the integers the file states.
//  3. the gates: deviation <= 0.5 * 10^-precision, a 30-vertex polygon <= 170 characters, and the
//     rule that every analysis runs on decode(encode(geometry)).
//
// Regenerate the fixture (and then hand it to msens) with:
//   UPDATE_FIXTURES=1 npx vitest run tests/geo/placeCodec.test.ts && npm run format
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import {
  MAX_NAME_CHARS,
  PlaceCodecError,
  b64urlDecode,
  b64urlEncode,
  choosePrecision,
  decodeGeometry,
  decodeName,
  decodePlace,
  decodePlaces,
  encodeGeometry,
  encodeName,
  encodePlace,
  encodePlaces,
  fitPlacesToUrl,
  quantizeGeometry,
  roundTrip,
  simplifyPlace,
  tryDecodePlace,
  zigzag,
  unzigzag,
  type GeomPlace,
  type Place,
} from "../../src/lib/geo/placeCodec";
import { douglasPeucker, ringIsSimple } from "../../src/lib/geo/simplify";
import { geometryArea, type AreaGeometry, type Position } from "../../src/lib/geo/types";
import { GEOMS, buildFixture, circle30, hex } from "./placeCodecVectors";

const fixtureUrl = new URL("../fixtures/place_codec.json", import.meta.url);

describe("hand-computed byte streams (the spec, not the implementation)", () => {
  // the rectangle (-90.0, 27.5) - (-89.0, 28.5) at precision 3, cursor starting at (0, 0):
  //   dlon -90000 -> zigzag 179999 -> 9f fe 0a      dlat  27500 -> zigzag 55000 -> d8 ad 03
  //   dlon   1000 -> zigzag   2000 -> d0 0f         dlat      0 -> zigzag     0 -> 00
  //   dlon      0 -> zigzag      0 -> 00            dlat   1000 -> zigzag  2000 -> d0 0f
  //   dlon  -1000 -> zigzag   1999 -> cf 0f         dlat      0 -> zigzag     0 -> 00
  const RECT_BYTES = "1003" + "01" + "01" + "04" + "9ffe0ad8ad03" + "d00f00" + "00d00f" + "cf0f00";

  it("rect: magic, precision, npoly, nring, npt, then zigzag varint deltas", () => {
    expect(hex(encodeGeometry(GEOMS.rect.geometry, 3))).toBe(RECT_BYTES);
    expect(RECT_BYTES.slice(0, 2)).toBe("10"); // the g1 magic byte
  });

  it("hole: the delta cursor RUNS ON from the outer ring into the hole", () => {
    // the outer ring ends at (-90000, 28500); the hole's first vertex is (-89750, 27750), so its
    // delta is (+250, -750) -> zigzag (500, 1499) -> f4 03, db 0b. Were the cursor reset per ring
    // it would be (-89750, 27750) -> three-byte varints, and this literal would not match.
    expect(hex(encodeGeometry(GEOMS.hole.geometry, 3))).toBe(
      "1003" +
        "01" +
        "02" +
        "04" +
        "9ffe0ad8ad03d00f0000d00fcf0f00" +
        "04" +
        "f403db0b" +
        "e80700" +
        "00e807" +
        "e70700",
    );
  });

  it("zigzag maps small negatives to small unsigned values", () => {
    expect([-2, -1, 0, 1, 2].map(zigzag)).toEqual([3, 1, 0, 2, 4]);
    expect([0, 1, 2, 3, 4].map(unzigzag)).toEqual([0, -1, 1, -2, 2]);
    for (const n of [-1234567, -1, 0, 1, 987654]) expect(unzigzag(zigzag(n))).toBe(n);
  });

  it("base64url uses -_ , no padding, and refuses +/= ", () => {
    expect(b64urlEncode(Uint8Array.from([251, 255, 190]))).toBe("-_--");
    expect(Array.from(b64urlDecode("-_--"))).toEqual([251, 255, 190]);
    expect(() => b64urlDecode("AA=")).toThrow(PlaceCodecError);
    expect(() => b64urlDecode("A+B/")).toThrow(PlaceCodecError);
  });
});

describe("tests/fixtures/place_codec.json (shared with msens inst/fixtures/place_codec.json)", () => {
  const built = buildFixture();
  if (process.env.UPDATE_FIXTURES) writeFileSync(fixtureUrl, JSON.stringify(built, null, 2) + "\n");
  const fx = JSON.parse(readFileSync(fixtureUrl, "utf8"));

  it("the committed file still equals what the codec produces", () => {
    expect(fx).toEqual(JSON.parse(JSON.stringify(built)));
  });

  for (const v of fx.vectors) {
    describe(`vector ${v.id}`, () => {
      it("decodes to the integers the file states", () => {
        const got = decodeGeometry(b64urlDecode(v.token.split(".")[2]));
        expect(got.precision).toBe(v.precision);
        expect(quantizeGeometry(got.geometry, v.precision)).toEqual(v.ints);
      });
      it("encodes back to the same bytes and the same token", () => {
        expect(hex(encodeGeometry(v.geometry, v.precision))).toBe(v.bytes_hex);
        expect(encodePlace({ kind: "geom", name: v.name, geometry: v.geometry })).toBe(v.token);
      });
      it("stays within half a quantisation step", () => {
        expect(v.max_deviation_deg).toBeLessThanOrEqual(0.5 * 10 ** -v.precision + 1e-12);
      });
      it("round-trips through the token", () => {
        const p = decodePlace(v.token) as GeomPlace;
        expect(p.name).toBe(v.name);
        expect(p.geometry).toEqual(v.decoded);
      });
    });
  }

  it("the zone and upload forms round-trip", () => {
    for (const z of fx.zones) expect(decodePlace(z.token)).toEqual(z.place);
    expect(decodePlace(fx.upload.token)).toEqual(fx.upload.place);
  });

  it("several places join with ~", () => {
    expect(decodePlaces(fx.multiple.hash)).toEqual(
      fx.multiple.places.map((p: Place) => decodePlace(encodePlace(p))),
    );
    expect(fx.multiple.hash.split("~")).toHaveLength(3);
  });

  for (const r of fx.reject) {
    it(`rejects ${JSON.stringify(r.token).slice(0, 40)} — ${r.why}`, () => {
      let err: unknown;
      try {
        decodePlace(r.token);
      } catch (e) {
        err = e;
      }
      expect(err, "should have thrown").toBeInstanceOf(PlaceCodecError);
      expect((err as PlaceCodecError).code).toBe(r.code);
      expect(tryDecodePlace(r.token)).toBeNull(); // the URL parser never throws
    });
  }
});

describe("names", () => {
  it("percent-encodes every reserved character, including . and ~", () => {
    const n = "Bahía ~ São, 50% .test";
    const enc = encodeName(n);
    expect(enc).not.toMatch(/[.~, ]/); // none of the grammar's delimiters survives raw
    expect(enc.match(/%/g)?.length).toBeGreaterThan(5); // the escapes themselves
    expect(decodeName(enc)).toBe(n);
  });

  it("does not use encodeURIComponent's unreserved set (it leaves . and ~ raw)", () => {
    expect(encodeURIComponent("a.b~c")).toBe("a.b~c");
    expect(encodeName("a.b~c")).toBe("a%2Eb%7Ec");
  });

  it("clamps a long name on a character boundary", () => {
    const p: GeomPlace = { kind: "geom", name: "é".repeat(40), geometry: GEOMS.rect.geometry };
    const name = encodePlace(p).split(".")[1];
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_CHARS);
    expect(decodeName(name)).toBe("é".repeat(10)); // %C3%A9 = 6 chars each
  });
});

describe("gates", () => {
  it("a 30-vertex polygon costs <= 170 characters", () => {
    const token = encodePlace({ kind: "geom", name: "circle30", geometry: circle30() });
    console.log(`30-vertex token: ${token.length} chars — ${token}`);
    expect(token.length).toBeLessThanOrEqual(170);
  });

  it("max deviation <= 0.5 * 10^-precision on every vector", () => {
    for (const [id, g] of Object.entries(GEOMS)) {
      const p = choosePrecision(g.geometry);
      const back = roundTrip(g.geometry);
      const flat = (x: AreaGeometry) =>
        (x.type === "Polygon" ? [x.coordinates] : x.coordinates).flat(2) as Position[];
      const a = flat(g.geometry);
      const b = flat(back);
      for (let i = 0; i < a.length; i++) {
        expect(Math.abs(a[i][0] - b[i][0]), `${id} lon`).toBeLessThanOrEqual(
          0.5 * 10 ** -p + 1e-12,
        );
        expect(Math.abs(a[i][1] - b[i][1]), `${id} lat`).toBeLessThanOrEqual(
          0.5 * 10 ** -p + 1e-12,
        );
      }
    }
  });

  it("picks precision 4 only for a place whose bbox is under half a degree", () => {
    expect(choosePrecision(GEOMS.small_p4.geometry)).toBe(4); // 0.1 x 0.1 deg
    expect(choosePrecision(GEOMS.rect.geometry)).toBe(3); // 1 x 1 deg
    expect(choosePrecision(GEOMS.bering.geometry)).toBe(3); // 20 x 5 deg
  });

  it("decode(encode(g)) is idempotent — the geometry every analysis must use", () => {
    for (const g of Object.values(GEOMS)) {
      const once = roundTrip(g.geometry);
      expect(roundTrip(once)).toEqual(once);
      expect(hex(encodeGeometry(once, choosePrecision(g.geometry)))).toBe(
        hex(encodeGeometry(g.geometry, choosePrecision(g.geometry))),
      );
    }
  });

  it("keeps longitudes unwrapped, so a Bering polygon decodes at 190 and not -170", () => {
    const back = roundTrip(GEOMS.bering.geometry) as AreaGeometry;
    const lons = (back.type === "Polygon" ? back.coordinates : back.coordinates[0])
      .flat()
      .map((p) => (p as Position)[0]);
    expect(Math.max(...lons)).toBeCloseTo(190, 9);
  });
});

describe("the URL-length ladder", () => {
  /** a smooth blob: Douglas-Peucker can throw most of its vertices away */
  const blob = (n: number, amp: number, r = 5): AreaGeometry => {
    const ring: Position[] = [];
    for (let k = 0; k < n; k++) {
      const t = (2 * Math.PI * k) / n;
      const rr = r * (1 + amp * Math.sin(37 * t));
      ring.push([-90 + rr * Math.cos(t), 28 + rr * Math.sin(t)]);
    }
    ring.push(ring[0]);
    return { type: "Polygon", coordinates: [ring] };
  };
  /**
   * an archipelago: many tiny parts, each already at its minimum vertex count. Simplification has
   * nothing to remove (a coarse rung only collapses a square into a line, which is refused), so
   * this is the shape that reaches the `u.` form.
   */
  const archipelago = (n: number, side = 0.05, step = 0.2): AreaGeometry => ({
    type: "MultiPolygon",
    coordinates: Array.from({ length: n }, (_, k) => {
      const x = -95 + (k % 40) * step;
      const y = 25 + Math.floor(k / 40) * step;
      return [
        [
          [x, y],
          [x + side, y],
          [x + side, y + side],
          [x, y + side],
          [x, y],
        ] as Position[],
      ];
    }),
  });
  const place = (g: AreaGeometry): GeomPlace => ({ kind: "geom", name: "place", geometry: g });

  it("a small place is silent", async () => {
    const r = await fitPlacesToUrl([place(GEOMS.rect.geometry)], { baseLength: 100 });
    expect(r.status).toBe("ok");
    expect(r.simplified).toBe(false);
    expect(r.length).toBeLessThanOrEqual(2000);
  });

  it("between 2,000 and 8,000 characters it is a long link, not a simplification", async () => {
    const r = await fitPlacesToUrl([place(blob(1500, 0.002))], { baseLength: 100 });
    expect(r.length).toBeGreaterThan(2000);
    expect(r.length).toBeLessThanOrEqual(8000);
    expect(r.status).toBe("long");
    expect(r.note).toBe("long link");
    expect(r.simplified).toBe(false);
  });

  it("past 8,000 characters it simplifies, and says by how much", async () => {
    const r = await fitPlacesToUrl([place(blob(4000, 0.0005))], { baseLength: 100 });
    expect(r.simplified).toBe(true);
    expect(r.tolerance).not.toBeNull();
    expect(r.tolerance as number).toBeLessThanOrEqual(0.02);
    expect(r.length).toBeLessThanOrEqual(8000);
    // and the simplified place is still the same place
    const kept = (r.places[0] as GeomPlace).geometry;
    expect(
      Math.abs(geometryArea(kept) - geometryArea(blob(4000, 0.0005))) /
        geometryArea(blob(4000, 0.0005)),
    ).toBeLessThanOrEqual(0.01);
  });

  it("falls back to the u. form when even 0.02 deg will not fit", async () => {
    const huge = archipelago(1600);
    const r = await fitPlacesToUrl([place(huge)], {
      baseLength: 100,
      digest: async () => "deadbeef",
    });
    expect(r.status).toBe("upload");
    expect(r.places[0]).toEqual({ kind: "upload", name: "place", digest: "deadbeef" });
    expect(r.hash).toBe("u.place.deadbeef");
  });

  it("refuses a rung that collapses a ring", () => {
    // one of the archipelago's squares is 0.05 deg across: at 0.08 deg Douglas-Peucker leaves two
    // points, which is not a ring — the rung is refused rather than shipping a line as a place
    const one = place(archipelago(1));
    expect(simplifyPlace(one, 0.001)).not.toBeNull();
    expect(simplifyPlace(one, 0.08)).toBeNull();
  });

  it("refuses a rung that moves the area by more than 1 %", () => {
    // a drawn circle 1 deg across, 200 vertices. Simplifying an inscribed ring always cuts INSIDE
    // it, so the loss is systematic: ~0.1 % at 0.001 deg (fine) but ~3 % at 0.02 deg, where the
    // circle is down to about 16 vertices and visibly is not the place the user drew
    const c: Position[] = [];
    for (let k = 0; k < 200; k++) {
      const t = (2 * Math.PI * k) / 200;
      c.push([-90 + Math.cos(t), 28 + Math.sin(t)]);
    }
    c.push(c[0]);
    const p = place({ type: "Polygon", coordinates: [c] });
    expect(simplifyPlace(p, 0.001)).not.toBeNull();
    expect(simplifyPlace(p, 0.02)).toBeNull();
  });

  it("Douglas-Peucker keeps the ring closed and the endpoints anchored", () => {
    const ring = (blob(200, 0.001).coordinates as Position[][])[0];
    const out = douglasPeucker(ring, 0.01);
    expect(out.length).toBeLessThan(ring.length);
    expect(out[0]).toEqual(ring[0]);
    expect(out[out.length - 1]).toEqual(ring[ring.length - 1]);
    expect(ringIsSimple(out)).toBe(true);
  });

  it("ringIsSimple catches a bow tie", () => {
    const bow: Position[] = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
      [0, 0],
    ];
    expect(ringIsSimple(bow)).toBe(false);
  });
});

describe("hash round trip", () => {
  it("a whole #pl value survives encode -> decode", () => {
    const places: Place[] = [
      { kind: "geom", name: "St. George ~ Basin", geometry: GEOMS.rect.geometry },
      { kind: "zone", set: "pa", keys: ["CGM", "SOC"] },
      { kind: "upload", name: "big", digest: "0123abcd" },
    ];
    const hash = encodePlaces(places);
    expect(hash.split("~")).toHaveLength(3); // the ~ in the name is escaped, so it does not split
    const back = decodePlaces(hash);
    expect(back).toHaveLength(3);
    expect((back[0] as GeomPlace).name).toBe("St. George ~ Basin");
    expect(back[1]).toEqual(places[1]);
    expect(back[2]).toEqual(places[2]);
  });

  it("drops an unreadable token instead of throwing away the whole hash", () => {
    const good = encodePlace({ kind: "zone", set: "pa", keys: ["CGM"] });
    expect(decodePlaces(`${good}~g1.broken~${good}`)).toHaveLength(2);
    expect(decodePlaces("")).toEqual([]);
  });
});
