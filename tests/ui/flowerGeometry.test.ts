// atlas-3 step 2b: the flower plot's geometry -- equal angular widths, "absent is not zero",
// clamping, and the mean rule. Each is the seeded-fault gate for one line of docs/design/spec.md /
// the plan: "a null component drawn as a zero-length petal or counted in the mean" and "petals
// given unequal widths" must each turn one of these tests red if reintroduced.
import { describe, expect, it } from "vitest";
import {
  computeFlowerGeometry,
  sectorPath,
  type FlowerComponentInput,
} from "../../src/lib/ui/flowerGeometry";

const EIGHT: FlowerComponentInput[] = [
  { key: "bird", score: 62 },
  { key: "coral", score: 18 },
  { key: "fish", score: 40 },
  { key: "invertebrate", score: 55 },
  { key: "mammal", score: 70 },
  { key: "other", score: 5 },
  { key: "primprod", score: 33 },
  { key: "turtle", score: 12 },
];

describe("computeFlowerGeometry: petal count (7 vs 8, parity scores app.md:826-830)", () => {
  it("8 components (v8/v9): every slot is 45 degrees wide", () => {
    const g = computeFlowerGeometry(EIGHT);
    expect(g.sliceCount).toBe(8);
    expect(g.petals).toHaveLength(8);
    for (const p of g.petals) expect(p.endAngle - p.startAngle).toBeCloseTo(45, 10);
  });

  it("7 components (v7, no primprod raster component): every slot is 360/7 degrees wide", () => {
    const seven = EIGHT.slice(0, 7);
    const g = computeFlowerGeometry(seven);
    expect(g.sliceCount).toBe(7);
    expect(g.petals).toHaveLength(7);
    for (const p of g.petals) expect(p.endAngle - p.startAngle).toBeCloseTo(360 / 7, 10);
  });

  it("slots tile the full circle exactly once, with no gap or overlap", () => {
    const g = computeFlowerGeometry(EIGHT);
    expect(g.petals[0].startAngle).toBe(0);
    expect(g.petals[g.petals.length - 1].endAngle).toBeCloseTo(360, 10);
    for (let i = 1; i < g.petals.length; i++) {
      expect(g.petals[i].startAngle).toBeCloseTo(g.petals[i - 1].endAngle, 10);
    }
  });
});

describe("equal angular widths, regardless of score (the seeded fault: unequal widths)", () => {
  it("a 0-score and a 100-score petal are exactly the same angular width", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 0 },
      { key: "coral", score: 100 },
      { key: "fish", score: 50 },
    ]);
    const widths = g.petals.map((p) => p.endAngle - p.startAngle);
    expect(widths[0]).toBeCloseTo(widths[1], 10);
    expect(widths[1]).toBeCloseTo(widths[2], 10);
    expect(widths[0]).toBeCloseTo(120, 10); // 360 / 3
  });
});

describe("a null component draws no petal ('absent is not zero')", () => {
  it("is excluded from petals[] entirely -- not a zero-length petal", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 62 },
      { key: "coral", score: null },
      { key: "fish", score: 40 },
    ]);
    expect(g.petals.map((p) => p.key)).toEqual(["bird", "fish"]);
    expect(g.noData.map((s) => s.key)).toEqual(["coral"]);
  });

  it("still reserves its angular slot (the ring's layout does not shift)", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 62 },
      { key: "coral", score: null },
      { key: "fish", score: 40 },
    ]);
    expect(g.sliceCount).toBe(3);
    // "fish" is slot index 2 of 3 -> [240, 360), not shifted to [120, 240) as it would be if the
    // null slot were simply dropped before computing angles
    const fish = g.petals.find((p) => p.key === "fish")!;
    expect(fish.startAngle).toBeCloseTo(240, 10);
    expect(fish.endAngle).toBeCloseTo(360, 10);
  });

  it("is NEVER counted in the mean (the seeded fault: counting a null as 0)", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 10 },
      { key: "coral", score: null },
      { key: "fish", score: 90 },
    ]);
    // mean of the PRESENT values only: (10 + 90) / 2 = 50 -- NOT (10 + 0 + 90) / 3 = 33.33
    expect(g.centerValue).toBeCloseTo(50, 10);
  });
});

describe("all components null", () => {
  it("draws no petals and the centre value is null (not 0, not NaN)", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: null },
      { key: "coral", score: null },
    ]);
    expect(g.petals).toEqual([]);
    expect(g.noData).toHaveLength(2);
    expect(g.centerValue).toBeNull();
  });
});

describe("values clamped to 0-100", () => {
  it("clamps a score above 100 down to 100", () => {
    const g = computeFlowerGeometry([{ key: "bird", score: 150 }]);
    expect(g.petals[0].score).toBe(100);
  });

  it("clamps a negative score up to 0 (and draws no path -- degenerate, not an error)", () => {
    const g = computeFlowerGeometry([{ key: "bird", score: -10 }]);
    expect(g.petals[0].score).toBe(0);
    expect(g.petals[0].path).toBe("");
  });

  it("the mean is computed from CLAMPED values, not raw out-of-range ones", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 150 }, // clamped to 100
      { key: "coral", score: -50 }, // clamped to 0
    ]);
    expect(g.centerValue).toBeCloseTo(50, 10);
  });
});

describe("the mean rule: centre = mean of the non-null components (even weights)", () => {
  it("with every weight equal (even = 1), weighted.mean reduces to a plain mean", () => {
    const g = computeFlowerGeometry([
      { key: "bird", score: 20 },
      { key: "coral", score: 40 },
      { key: "fish", score: 60 },
    ]);
    expect(g.centerValue).toBeCloseTo(40, 10);
  });
});

describe("categories.ts resolution (the two primary-producer spellings)", () => {
  it("'primprod' and 'primary producer' petals share the same color token", () => {
    const g = computeFlowerGeometry([
      { key: "primprod", score: 50 },
      { key: "primary producer", score: 50 },
    ]);
    expect(g.petals[0].category.color).toBe(g.petals[1].category.color);
    expect(g.petals[0].category.color).toBe("--cat-primprod");
  });
});

describe("sectorPath", () => {
  it("a full quarter circle (90deg, radius 10) starts and ends on the expected axis points", () => {
    const d = sectorPath(0, 0, 10, 0, 90);
    expect(d).toContain("M 0 0");
    // start at angle 0 (12 o'clock): (0, -10); end at angle 90 (3 o'clock): (10, 0)
    expect(d).toMatch(/L 0\.000 -10\.000/);
    expect(d).toMatch(/10\.000 0\.000 Z$/);
  });

  it("radius 0 draws nothing", () => {
    expect(sectorPath(0, 0, 0, 0, 90)).toBe("");
  });

  it("a span > 180deg sets the SVG large-arc-flag", () => {
    const d = sectorPath(0, 0, 10, 0, 200);
    expect(d).toMatch(/A 10 10 0 1 1/);
  });

  it("a span <= 180deg clears the large-arc-flag", () => {
    const d = sectorPath(0, 0, 10, 0, 180);
    expect(d).toMatch(/A 10 10 0 0 1/);
  });
});
