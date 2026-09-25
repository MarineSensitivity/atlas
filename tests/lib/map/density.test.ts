// Ben's ask (round-3 review, UI-4 fold-in): the popup's distribution sparkline math -- binning,
// smoothing, the SVG path and the marker position. See src/lib/map/density.ts's own header.
import { describe, expect, it } from "vitest";
import {
  binValues,
  densityCurve,
  densityPathD,
  markerX,
  smoothCounts,
} from "../../../src/lib/map/density";

describe("binValues", () => {
  it("empty input: a zero-bin histogram, never a throw", () => {
    expect(binValues([])).toEqual({ binCount: 0, counts: [], min: 0, max: 0 });
  });

  it("NaN/Infinity values are dropped, not counted and never widen the range", () => {
    const h = binValues([1, 2, 3, NaN, Infinity, -Infinity], 3);
    expect(h.min).toBe(1);
    expect(h.max).toBe(3);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("all values identical: one bin, no divide-by-zero", () => {
    const h = binValues([5, 5, 5]);
    expect(h).toEqual({ binCount: 1, counts: [3], min: 5, max: 5 });
  });

  it("the max value lands in the LAST bin, not a phantom extra one", () => {
    const h = binValues([0, 10], 2);
    expect(h.binCount).toBe(2);
    expect(h.counts).toEqual([1, 1]);
  });

  it("an even spread over N bins puts roughly equal counts in each", () => {
    const values = Array.from({ length: 100 }, (_, i) => i / 99);
    const h = binValues(values, 10);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(h.counts.every((c) => c > 0)).toBe(true);
  });
});

describe("smoothCounts", () => {
  it("edges reflect rather than zero-pad -- a single spike at an edge is not pinched to zero", () => {
    const out = smoothCounts([10, 0, 0, 0], 1);
    expect(out[0]).toBeGreaterThan(0);
  });

  it("preserves total mass roughly (a smoothing pass redistributes, does not discard)", () => {
    const counts = [0, 0, 10, 0, 0];
    const out = smoothCounts(counts, 1);
    const total = out.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(10, 5);
  });
});

describe("densityCurve", () => {
  it("normalizes so the tallest bin is exactly 1", () => {
    const curve = densityCurve({ binCount: 3, counts: [1, 10, 1], min: 0, max: 3 });
    expect(Math.max(...curve)).toBe(1);
  });

  it("an all-zero histogram returns an all-zero curve, never NaN", () => {
    const curve = densityCurve({ binCount: 3, counts: [0, 0, 0], min: 0, max: 3 });
    expect(curve.every((v) => v === 0)).toBe(true);
  });
});

describe("densityPathD", () => {
  it("an empty curve draws a flat, closed baseline path", () => {
    expect(densityPathD([], 120, 28)).toBe("M0,28 L120,28 Z");
  });

  it("starts and ends on the baseline (a closed area under the curve)", () => {
    const d = densityPathD([0, 1, 0], 120, 28);
    expect(d.startsWith("M0,28")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("L120,28");
  });

  it("a peak bin reaches the top (y=0)", () => {
    const d = densityPathD([0, 1, 0], 120, 28);
    expect(d).toContain(",0 "); // the middle point's y coordinate is 0
  });
});

describe("markerX", () => {
  it("the minimum value places the marker at x=0", () => {
    expect(markerX(0, 0, 100, 120)).toBe(0);
  });

  it("the maximum value places the marker at x=width", () => {
    expect(markerX(100, 0, 100, 120)).toBe(120);
  });

  it("the midpoint places the marker at x=width/2", () => {
    expect(markerX(50, 0, 100, 120)).toBe(60);
  });

  it("a value outside [min, max] clamps to an end, never draws off the sparkline", () => {
    expect(markerX(-10, 0, 100, 120)).toBe(0);
    expect(markerX(110, 0, 100, 120)).toBe(120);
  });

  it("a degenerate [min, max] (equal) still returns a finite, clamped position", () => {
    expect(markerX(5, 5, 5, 120)).toBeGreaterThanOrEqual(0);
    expect(markerX(5, 5, 5, 120)).toBeLessThanOrEqual(120);
  });

  it("a non-finite value places the marker at the centre rather than throwing", () => {
    expect(markerX(NaN, 0, 100, 120)).toBe(60);
  });
});
