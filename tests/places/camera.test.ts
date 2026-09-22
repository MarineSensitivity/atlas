import { describe, expect, it } from "vitest";
import {
  centerZoomForBbox,
  centerZoomForGeometry,
  MAX_ZOOM,
  MIN_ZOOM,
} from "../../src/places/camera";

describe("centerZoomForBbox", () => {
  it("centres on the bbox midpoint", () => {
    const cz = centerZoomForBbox([-100, 40, -96, 44]);
    expect(cz.lon).toBeCloseTo(-98);
    expect(cz.lat).toBeCloseTo(42);
  });

  it("a wider bbox gets a smaller (more zoomed-out) zoom than a narrower one", () => {
    const wide = centerZoomForBbox([-160, 10, -60, 60]);
    const narrow = centerZoomForBbox([-100, 40, -99, 41]);
    expect(wide.zoom).toBeLessThan(narrow.zoom);
  });

  it("clamps to [MIN_ZOOM, MAX_ZOOM] for a degenerate (point-like) or a whole-globe bbox", () => {
    const point = centerZoomForBbox([-100, 40, -100, 40]);
    expect(point.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    const globe = centerZoomForBbox([-180, -90, 180, 90]);
    expect(globe.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
  });

  it("reads a dateline-aware bbox (xmax > 180) literally, never re-wrapping it", () => {
    const cz = centerZoomForBbox([178, 51, 183, 53]);
    expect(cz.lon).toBeCloseTo(180.5);
  });

  it("never calls fitBounds -- centre+zoom only (CLAUDE.md)", () => {
    // static assertion via source scan lives in tests/map/no-fitbounds.test.ts for src/lib/map and
    // src/lens; this is the behavioural half for places' own camera helper.
    expect(centerZoomForBbox([-100, 40, -96, 44])).not.toHaveProperty("bounds");
  });
});

describe("centerZoomForGeometry", () => {
  it("delegates to the geometry's own bbox", () => {
    const square = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ] as [number, number][],
      ],
    };
    expect(centerZoomForGeometry(square)).toEqual(centerZoomForBbox([0, 0, 2, 2]));
  });
});
