import { describe, expect, it } from "vitest";
import { combinedBbox, scoreColorExpression } from "../../src/report/reportMap";

describe("combinedBbox", () => {
  it("null when no place carries a geometry or point", () => {
    expect(combinedBbox([{ name: "a", score: null }])).toBeNull();
  });

  it("unions a polygon bbox and a point's small box", () => {
    const box = combinedBbox([
      {
        name: "square",
        score: 50,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-10, -10],
              [10, -10],
              [10, 10],
              [-10, 10],
              [-10, -10],
            ],
          ],
        },
      },
      { name: "zone", score: 30, point: [20, 20] },
    ]);
    expect(box).toEqual([
      [-10, -10],
      [20.5, 20.5],
    ]);
  });
});

describe("scoreColorExpression", () => {
  const stops = ["#000000", "#ffffff"];

  it("falls back to the no-data color when hasScore is false", () => {
    const expr = scoreColorExpression(stops, [0, 100]) as unknown[];
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["==", ["get", "hasScore"], false]);
  });

  it("interpolates over the given domain, not a fixed 0-100", () => {
    const expr = scoreColorExpression(stops, [10, 20]) as unknown[];
    const interpolate = expr[3] as unknown[];
    expect(interpolate[0]).toBe("interpolate");
    expect(interpolate.slice(3)).toEqual([10, "#000000", 20, "#ffffff"]);
  });
});
