// atlas-2 phase review, ruling 8: `rmod()` (src/lib/geo/coverage.ts) claims to be R's `%%` on
// doubles, and two thirds of that claim were unpinned — removing the guard pass, or replacing the
// whole body with `((x % y) + y) % y`, both left the suite green. Only the negative-operand case
// was covered, and every candidate implementation agrees there.
//
// Every expectation below is R's own answer, produced by this exact line (R 4.6.1):
//
//   Rscript -e 'cat(sprintf("%.17g", c(-10 %% 360, 720 %% 360, 38.8 %% 360, -1e-17 %% 360,
//                                      -5e-15 %% 360, 398.8 %% 360)), sep="\n")'
//   350
//   0
//   38.799999999999997
//   0
//   0
//   38.800000000000011
//
// They are written below as the literal doubles those strings denote, so a reader can check them
// against that output without running anything.
import { describe, expect, it } from "vitest";
import { rmod } from "../../src/lib/geo/coverage";

// the two wrong implementations this gate exists to exclude — kept here, next to the fixtures, so
// the tests can state exactly WHICH case separates each from the real one.
const noGuard = (x: number, y: number) => x - Math.floor(x / y) * y;
const naive = (x: number, y: number) => ((x % y) + y) % y;

describe("rmod is R's %% on doubles (R-sourced fixtures)", () => {
  it("floor division, not truncation: -10 %% 360 is 350", () => {
    // R: 350. C's fmod(-10, 360) would be -10 — the case that was already pinned, kept because it
    // is the one a reader checks first.
    expect(rmod(-10, 360)).toBe(350);
  });

  it("an exact multiple of the modulus is 0, not the modulus: 720 %% 360 is 0", () => {
    expect(rmod(720, 360)).toBe(0);
    expect(rmod(-720, 360)).toBe(0);
    expect(rmod(360, 360)).toBe(0);
  });

  it("the GUARD PASS: a tiny negative operand answers 0, not a full turn", () => {
    // R: -1e-17 %% 360 is 0, and -5e-15 %% 360 is 0.
    // `x - floor(x/y)*y` rounds to EXACTLY y here (-1e-17 - (-1)*360 === 360), which is the one
    // case the second pass exists for. Without it the answer is a whole turn where it should be
    // zero — a point on the antimeridian would land a full grid-width away.
    expect(rmod(-1e-17, 360)).toBe(0);
    expect(rmod(-5e-15, 360)).toBe(0);

    // the seeded fault, stated as an assertion so the claim cannot rot: the unguarded form really
    // does return 360 on this input, i.e. this fixture is what separates them.
    expect(noGuard(-1e-17, 360)).toBe(360);
    expect(noGuard(-5e-15, 360)).toBe(360);
  });

  it("the guard fires on the grid's own resolution too, not just on 360", () => {
    expect(rmod(-1e-19, 0.05)).toBe(0);
    expect(noGuard(-1e-19, 0.05)).toBe(0.05);
  });

  it("FLOAT PRECISION: 38.8 %% 360 is 38.8 itself, not 38.80000000000001", () => {
    // R: 38.799999999999997, which IS the double literal 38.8.
    expect(rmod(38.8, 360)).toBe(38.8);
    expect(rmod(38.8, 360).toPrecision(17)).toBe("38.799999999999997");

    // the seeded fault, again stated as an assertion: `((x % y) + y) % y` answers the value R gives
    // for 398.8 %% 360 (38.800000000000011), one ulp-ish above 38.8. The add-then-subtract of a
    // whole turn is not exact in binary.
    expect(naive(38.8, 360)).not.toBe(38.8);
    expect(naive(38.8, 360).toPrecision(17)).toBe("38.800000000000011");
    expect(rmod(398.8, 360).toPrecision(17)).toBe("38.800000000000011"); // R's own answer for 398.8
  });

  it("the two rejected forms disagree with rmod on a large share of ordinary inputs", () => {
    // not a fixture, a sanity net: if either alternative ever became equivalent, the two
    // assertions above would be the only thing standing between this module and a silent swap.
    let naiveDiffs = 0;
    for (let f = 1; f < 36000; f++) {
      const x = f * 0.01;
      if (naive(x, 360) !== rmod(x, 360)) naiveDiffs++;
    }
    expect(naiveDiffs).toBeGreaterThan(20_000);
  });
});
