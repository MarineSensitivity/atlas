import { describe, expect, it } from "vitest";
import { densifyGeometry, densifyRing, DEFAULT_DENSIFY_STEP_DEG } from "../../src/places/densify";
import { closeRing, polygonsOf, ringArea2, type AreaGeometry } from "../../src/lib/geo/types";

describe("densifyRing", () => {
  it("inserts extra vertices so no edge exceeds maxStepDeg, including the wrap-around edge", () => {
    const square = closeRing([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]);
    const dense = densifyRing(square, 0.5);
    for (let i = 1; i < dense.length; i++) {
      const [x0, y0] = dense[i - 1];
      const [x1, y1] = dense[i];
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    // the wrap-around edge (last distinct vertex -> first) is walked too: the ring stays closed.
    expect(dense[0]).toEqual(dense[dense.length - 1]);
  });

  it("leaves an already-dense ring's vertex COUNT larger (never fewer points)", () => {
    const ring = closeRing([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]);
    expect(densifyRing(ring, 10).length).toBeGreaterThanOrEqual(ring.length);
  });

  it("a step <= 0 is a no-op (returns a copy, not a crash)", () => {
    const ring: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ];
    expect(densifyRing(ring, 0)).toEqual(ring);
  });

  it("the default step is a positive, sub-degree value", () => {
    expect(DEFAULT_DENSIFY_STEP_DEG).toBeGreaterThan(0);
    expect(DEFAULT_DENSIFY_STEP_DEG).toBeLessThan(1);
  });
});

describe("densifyGeometry", () => {
  const SQUARE: AreaGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
    ],
  };

  it("preserves the ring's shape (area unchanged) while adding vertices", () => {
    const dense = densifyGeometry(SQUARE, 0.2);
    const before = Math.abs(ringArea2(SQUARE.coordinates[0])) / 2;
    const [after] = polygonsOf(dense).map((p) => Math.abs(ringArea2(p[0])) / 2);
    expect(after).toBeCloseTo(before, 6);
    expect(dense.coordinates[0].length).toBeGreaterThan(SQUARE.coordinates[0].length);
  });

  it("handles a MultiPolygon, one ring at a time", () => {
    const multi: AreaGeometry = {
      type: "MultiPolygon",
      coordinates: [SQUARE.coordinates, SQUARE.coordinates],
    };
    const dense = densifyGeometry(multi, 0.2);
    expect(dense.type).toBe("MultiPolygon");
    expect((dense as { coordinates: unknown[] }).coordinates).toHaveLength(2);
  });
});
