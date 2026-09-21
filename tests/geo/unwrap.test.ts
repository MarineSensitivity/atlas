// geo/unwrap.ts — the shared unwrapping rule (plan D8 addendum), beyond what the shared
// `normalize-*` fixtures already pin in coverage.test.ts.
//
// Those fixtures are the cross-language contract and they carry the cases msens and this repo must
// agree on. What they do NOT carry is a case for every way the rule could be mis-stated, because a
// fixture is chosen to be meaningful, not to be adversarial. The tests here are the seeded faults'
// tripwires, one per way the rule can go wrong:
//
//   * the threshold is 180 — not 90 (a 179 deg edge is a real edge and must not be carried) and not
//     270 (a 199.9 deg edge IS a crossing and must be)
//   * the carry runs ONWARD, not on the vertex that triggered it alone
//   * every ring is unwrapped, holes included, each from its own first vertex
//   * `g1` refuses a ring that is still wrapped, rather than storing the sender's complement
import { describe, it, expect } from "vitest";
import {
  MAX_LON_STEP,
  isUnwrapped,
  normalizeForAnalysis,
  unwrapPolygon,
  unwrapRing,
  wrappedEdge,
} from "../../src/lib/geo/unwrap";
import { encodeGeometry, encodePlace, PlaceCodecError } from "../../src/lib/geo/placeCodec";
import type { AreaGeometry, Ring } from "../../src/lib/geo/types";

const lons = (r: Ring) => r.map((p) => p[0]);
const ring = (...lon: number[]): Ring => lon.map((x, i) => [x, 50 + (i % 2) * 0.05]);

describe("unwrapRing — the 180-degree threshold, from both sides", () => {
  it("leaves a 179-degree edge alone: it is a real edge, not a crossing", () => {
    // the seeded fault "threshold 90" moves this vertex to 79 - 360 = -281
    expect(lons(unwrapRing(ring(-100, 79, 79, -100, -100)))).toEqual([-100, 79, 79, -100, -100]);
  });

  it("leaves an edge of exactly 180 degrees alone (the rule is strictly MORE than 180)", () => {
    expect(lons(unwrapRing(ring(-90, 90, 90, -90, -90)))).toEqual([-90, 90, 90, -90, -90]);
    expect(MAX_LON_STEP).toBe(180);
  });

  it("carries a 199.9-degree edge: the seeded fault 'threshold 270' leaves it at -20", () => {
    expect(lons(unwrapRing(ring(179.9, -20, -20, 179.9, 179.9)))).toEqual([
      179.9, 340, 340, 179.9, 179.9,
    ]);
  });
});

describe("unwrapRing — the carry runs ONWARD", () => {
  it("keeps a RUN of vertices past the line on the far side", () => {
    // the seeded fault "apply the carry to the current vertex only" moves 179.95 to 180.05 and then
    // leaves 179.98 at -180.02, because measured against the ORIGINAL previous vertex its own step
    // is short. This is the exact shape of the msens normalize-box-180 fixture, one vertex longer.
    const got = lons(unwrapRing(ring(179.9, -179.95, -179.98, -179.9, 179.9, 179.9)));
    expect(got).toEqual([179.9, 180.05, 180.02, 180.1, 179.9, 179.9]);
  });

  it("brings the carry back to zero on a ring that crosses twice", () => {
    expect(lons(unwrapRing(ring(178, -178, 178, -178, 178, 178)))).toEqual([
      178, 182, 178, 182, 178, 178,
    ]);
  });

  it("never moves the first vertex, so a ring keeps the frame it arrived in", () => {
    expect(unwrapRing(ring(-179.9, 179.9, 179.9, -179.9, -179.9))[0][0]).toBe(-179.9);
    expect(lons(unwrapRing(ring(-179.9, 179.9, 179.9, -179.9, -179.9)))).toEqual([
      -179.9, -180.1, -180.1, -179.9, -179.9,
    ]);
  });

  it("is idempotent, and its output always satisfies wrappedEdge() === -1", () => {
    const once = unwrapRing(ring(179.9, -179.9, -179.9, 179.9, 179.9));
    expect(wrappedEdge(once)).toBe(-1);
    expect(unwrapRing(once)).toEqual(once);
  });
});

describe("unwrapPolygon — a hole and its outer ring stay in one frame", () => {
  // the shared normalize-hole-outer-crosses fixture covers the case where only the OUTER ring
  // crosses. This is the other half: the hole crosses too, and the seeded fault "a hole left in a
  // different frame from its outer ring" (unwrap only rings[0]) leaves it reading as the 359.8 deg
  // complement inside a 0.4 deg outer ring.
  const wrapped: AreaGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [179.8, 49.95],
        [-179.8, 49.95],
        [-179.8, 50.1],
        [179.8, 50.1],
        [179.8, 49.95],
      ],
      [
        [179.9, 50],
        [-179.9, 50],
        [-179.9, 50.05],
        [179.9, 50.05],
        [179.9, 50],
      ],
    ],
  };

  it("unwraps the hole too, from its own first vertex", () => {
    const got = unwrapPolygon(wrapped) as { coordinates: Ring[] };
    expect(lons(got.coordinates[0])).toEqual([179.8, 180.2, 180.2, 179.8, 179.8]);
    expect(lons(got.coordinates[1])).toEqual([179.9, 180.1, 180.1, 179.9, 179.9]);
    expect(isUnwrapped(got as AreaGeometry)).toBe(true);
  });

  it("leaves the hole strictly inside its outer ring afterwards", () => {
    const got = unwrapPolygon(wrapped) as { coordinates: Ring[] };
    const [ox0, ox1] = [
      Math.min(...lons(got.coordinates[0])),
      Math.max(...lons(got.coordinates[0])),
    ];
    for (const x of lons(got.coordinates[1])) {
      expect(x).toBeGreaterThan(ox0);
      expect(x).toBeLessThan(ox1);
    }
  });

  it("does not let one ring's carry leak into the next", () => {
    // two parts either side of the line: part 2 starts at -179.95 and must STAY there (the shared
    // normalize-multipolygon-split fixture pins the same rule on the msens side)
    const mp: AreaGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [179.9, 50],
            [179.95, 50],
            [179.95, 50.05],
            [179.9, 50.05],
            [179.9, 50],
          ],
        ],
        [
          [
            [-179.95, 50],
            [-179.9, 50],
            [-179.9, 50.05],
            [-179.95, 50.05],
            [-179.95, 50],
          ],
        ],
      ],
    };
    expect(normalizeForAnalysis(mp)).toEqual(mp);
  });
});

describe("the g1 codec only ever stores unwrapped rings", () => {
  const wrappedBox: AreaGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [179.9, 50],
        [-179.9, 50],
        [-179.9, 50.05],
        [179.9, 50.05],
        [179.9, 50],
      ],
    ],
  };

  it("refuses a ring with a > 180 degree step, with a message that names the fix", () => {
    // the seeded fault "the codec accepts a wrapped ring" turns this green-by-omission: the token
    // would encode the sender's complement and the recipient would analyse 7,196 cells
    expect(() => encodeGeometry(wrappedBox)).toThrow(PlaceCodecError);
    try {
      encodeGeometry(wrappedBox);
      expect.unreachable("encodeGeometry accepted a wrapped ring");
    } catch (e) {
      const err = e as PlaceCodecError;
      expect(err.code).toBe("wrapped");
      expect(err.message).toContain("179.9 -> -179.9");
      expect(err.message).toContain("normalizeForAnalysis()");
    }
  });

  it("refuses a wrapped HOLE under an unwrapped outer ring", () => {
    const geom: AreaGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [179.8, 49.95],
          [180.2, 49.95],
          [180.2, 50.1],
          [179.8, 50.1],
          [179.8, 49.95],
        ],
        wrappedBox.coordinates[0] as Ring,
      ],
    };
    expect(() => encodeGeometry(geom)).toThrow(/ring 1/);
  });

  it("accepts the same box once normalizeForAnalysis() has run", () => {
    const token = encodePlace({
      kind: "geom",
      name: "Bering box",
      geometry: normalizeForAnalysis(wrappedBox),
    });
    expect(token.startsWith("g1.Bering%20box.")).toBe(true);
  });
});
