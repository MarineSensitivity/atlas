import { describe, expect, it } from "vitest";
import { approxAreaKm2, EARTH_RADIUS_KM, meanLat } from "../../src/places/area";
import type { AreaGeometry } from "../../src/lib/geo/types";

// a 1deg x 1deg square straddling the equator: km-per-degree is exact there (cos(0) = 1), so the
// expected area is a plain (111.something)^2 km^2 -- a fixture anyone can hand-check. No explicit
// closing vertex (unlike a codec-decoded ring): both `ringArea2`'s shoelace sum and `meanLat`'s
// plain average treat the ring as cyclic already, and a bare 4-corner ring keeps the vertex mean
// exactly symmetric (a duplicated closing vertex would double-count one corner's latitude).
const EQUATOR_SQUARE: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
      [0.5, -0.5],
    ],
  ],
};

describe("meanLat", () => {
  it("is the plain mean of every vertex's latitude", () => {
    expect(meanLat(EQUATOR_SQUARE)).toBeCloseTo(0);
  });

  it("is 0 for an empty ring set rather than NaN", () => {
    expect(meanLat({ type: "Polygon", coordinates: [] })).toBe(0);
  });
});

describe("approxAreaKm2", () => {
  it("matches the exact equirectangular formula at the equator (cos(0) = 1)", () => {
    const kmPerDeg = (Math.PI / 180) * EARTH_RADIUS_KM;
    expect(approxAreaKm2(EQUATOR_SQUARE)).toBeCloseTo(kmPerDeg * kmPerDeg, 3);
  });

  it("shrinks as the same-degree square moves toward the pole (cos(lat) narrowing)", () => {
    const at60: AreaGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [-0.5, 59.5],
          [-0.5, 60.5],
          [0.5, 60.5],
          [0.5, 59.5],
        ],
      ],
    };
    expect(approxAreaKm2(at60)).toBeLessThan(approxAreaKm2(EQUATOR_SQUARE));
    // cos(60deg) = 0.5, so the area should be about half the equatorial one.
    expect(approxAreaKm2(at60) / approxAreaKm2(EQUATOR_SQUARE)).toBeCloseTo(0.5, 1);
  });

  it("is always non-negative, even for a clockwise-wound ring", () => {
    const reversed: AreaGeometry = {
      type: "Polygon",
      coordinates: [[...EQUATOR_SQUARE.coordinates[0]].reverse()],
    };
    expect(approxAreaKm2(reversed)).toBeGreaterThan(0);
  });
});
