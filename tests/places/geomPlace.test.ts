import { describe, expect, it } from "vitest";
import { geomPlaceFrom } from "../../src/places/geomPlace";
import { roundTrip } from "../../src/lib/geo/placeCodec";
import type { AreaGeometry } from "../../src/lib/geo/types";

const SQUARE: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-100.00012345, 40.00012345],
      [-100.00012345, 41],
      [-99, 41],
      [-99, 40.00012345],
      [-100.00012345, 40.00012345],
    ],
  ],
};

describe("geomPlaceFrom", () => {
  it("stores the ANALYSED geometry (unwrapped, quantized, round-tripped) -- decode(encode(x)) === it", () => {
    const place = geomPlaceFrom(SQUARE, "My Place");
    expect(place.geometry).toEqual(roundTrip(place.geometry));
  });

  it("clamps and trims the name", () => {
    const place = geomPlaceFrom(SQUARE, `  ${"x".repeat(90)}  `);
    expect(place.name.length).toBeLessThanOrEqual(60);
    expect(place.name.startsWith(" ")).toBe(false);
  });

  it("falls back to 'Place' for a blank name", () => {
    expect(geomPlaceFrom(SQUARE, "   ").name).toBe("Place");
  });

  it("is kind 'geom'", () => {
    expect(geomPlaceFrom(SQUARE, "x").kind).toBe("geom");
  });

  it("unwraps a wrapped Aleutian-style ring before storing it", () => {
    const wrapped: AreaGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [178, 51],
          [178, 53],
          [-177, 53],
          [-177, 51],
          [178, 51],
        ],
      ],
    };
    const place = geomPlaceFrom(wrapped, "Aleutian");
    expect(place.geometry.type).toBe("Polygon");
    // unwrapped: -177 becomes 183, so every longitude is >= 178 and the ring stays narrow.
    const ring = place.geometry.type === "Polygon" ? place.geometry.coordinates[0] : [];
    const lons = ring.map((p) => p[0]);
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(10);
  });
});
