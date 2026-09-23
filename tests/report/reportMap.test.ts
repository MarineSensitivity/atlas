import { describe, expect, it } from "vitest";
import {
  captureRejectionReason,
  combinedBbox,
  luminanceStatsFromRgba,
  scoreColorExpression,
} from "../../src/report/reportMap";

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

// fix round 2, item 6: `captureMapPng` used to reject only pure black/white; a reviewer's captured
// map (896x360, one flat colour, mid-range luminance) sailed through. `luminanceStatsFromRgba` and
// `captureRejectionReason` are the pure halves of that rule (this repo's vitest environment is
// `node`, so no real <canvas> exists here to draw a fixture into -- the DOM-touching half,
// `luminanceStats`, just calls these with a real ImageData buffer).
function solidRgba(r: number, g: number, b: number, count: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function gradientRgba(count: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const v = Math.round((i / (count - 1)) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = 255 - v;
    data[i * 4 + 2] = (v * 37) % 256;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("luminanceStatsFromRgba / captureRejectionReason", () => {
  it("a flat mid-grey fill has zero variance", () => {
    const stats = luminanceStatsFromRgba(solidRgba(128, 128, 128, 400));
    expect(stats.stdev).toBe(0);
    expect(stats.mean).toBeGreaterThan(1);
    expect(stats.mean).toBeLessThan(254);
  });

  it("real, varying map imagery (a gradient) is accepted", () => {
    const reason = captureRejectionReason(luminanceStatsFromRgba(gradientRgba(400)));
    expect(reason).toBeNull();
  });

  it("an all-black capture is rejected", () => {
    const reason = captureRejectionReason(luminanceStatsFromRgba(solidRgba(0, 0, 0, 400)));
    expect(reason).toContain("all-black/all-white");
  });

  it("an all-white capture is rejected", () => {
    const reason = captureRejectionReason(luminanceStatsFromRgba(solidRgba(255, 255, 255, 400)));
    expect(reason).toContain("all-black/all-white");
  });

  it("SEEDED FAULT: a flat, single-colour capture is rejected even though its luminance is mid-range -- a mean-only check (the pre-fix-round-2 rule) would have accepted it", () => {
    const flat = luminanceStatsFromRgba(solidRgba(140, 140, 140, 400));
    const meanOnlyWouldAccept = flat.mean >= 1 && flat.mean <= 254;
    expect(meanOnlyWouldAccept).toBe(true); // the exact gap the old rule had
    expect(captureRejectionReason(flat)).toContain("flat, single-colour");
  });
});
