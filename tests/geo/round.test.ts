// atlas-4 addition: `signif3()`, R's `signif(x, digits)` — the raster legend's endpoint rule
// (parity doc §6.2 step 6: `values = signif(meta$rescale, 3)`, never re-rounded to fixed decimals).
import { describe, expect, it } from "vitest";
import { signif3 } from "../../src/lib/geo/round";

describe("signif3", () => {
  it("rounds to 3 significant digits, R's signif(x, 3) verbatim", () => {
    expect(signif3(4022.4221)).toBe(4020);
    expect(signif3(35.1489)).toBeCloseTo(35.1);
    expect(signif3(11033.6953)).toBe(11000);
  });

  it("small magnitudes", () => {
    expect(signif3(0.0031415)).toBeCloseTo(0.00314);
  });

  it("negative values keep their sign", () => {
    expect(signif3(-45.678)).toBeCloseTo(-45.7);
  });

  it("zero and non-finite pass through unchanged", () => {
    expect(signif3(0)).toBe(0);
    expect(signif3(NaN)).toBeNaN();
    expect(signif3(Infinity)).toBe(Infinity);
  });

  it("a value already at 3 or fewer significant digits is unchanged", () => {
    expect(signif3(100)).toBe(100);
    expect(signif3(96)).toBe(96);
  });
});
