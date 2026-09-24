// V5 fix (Opus eyes-on, 2026-09-24): the report's species counts table hid columns inside a
// horizontal scroll box with no cue that more existed. `isOverflowingX` is the pure test
// `scrollAffordance`'s Svelte action measures a real element against -- see that file's header.
import { describe, expect, it } from "vitest";
import { isOverflowingX } from "../../src/lib/ui/scrollAffordance";

describe("isOverflowingX -- whether a scroll container's content is wider than its own box", () => {
  it("a table narrower than its box does not overflow", () => {
    expect(isOverflowingX(300, 390)).toBe(false);
  });

  it("a table wider than its box overflows (the phone-15 case: 8 ER columns past a 390px box)", () => {
    expect(isOverflowingX(820, 390)).toBe(true);
  });

  it("an exact fit does not overflow", () => {
    expect(isOverflowingX(390, 390)).toBe(false);
  });

  it(
    "SEEDED FAULT: without the 1px tolerance, sub-pixel rounding (390.4 vs 390) would wrongly " +
      "flip this to true on an exact fit -- this is exactly what the tolerance in isOverflowingX exists to absorb",
    () => {
      const noTolerance = (scrollWidth: number, clientWidth: number) => scrollWidth > clientWidth;
      expect(noTolerance(390.4, 390)).toBe(true);
      expect(isOverflowingX(390.4, 390)).toBe(false);
    },
  );
});
