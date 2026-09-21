import { describe, expect, it } from "vitest";
import { nextRovingIndex } from "../../src/lib/ui/roving";

describe("nextRovingIndex (the tool rail's roving tabindex)", () => {
  it("moves forward with ArrowDown in a vertical group (the desktop rail)", () => {
    expect(nextRovingIndex(0, 5, "ArrowDown", "vertical")).toBe(1);
  });

  it("moves forward with ArrowRight in a horizontal group (the phone bottom bar)", () => {
    expect(nextRovingIndex(0, 5, "ArrowRight", "horizontal")).toBe(1);
  });

  it("wraps from the last item back to the first", () => {
    expect(nextRovingIndex(4, 5, "ArrowDown", "vertical")).toBe(0);
  });

  it("wraps from the first item back to the last going backward", () => {
    expect(nextRovingIndex(0, 5, "ArrowUp", "vertical")).toBe(4);
  });

  it("Home always jumps to 0, End always jumps to the last index", () => {
    expect(nextRovingIndex(2, 5, "Home", "vertical")).toBe(0);
    expect(nextRovingIndex(2, 5, "End", "vertical")).toBe(4);
  });

  it("the horizontal keys do nothing in a vertical group, and vice versa", () => {
    expect(nextRovingIndex(0, 5, "ArrowRight", "vertical")).toBeNull();
    expect(nextRovingIndex(0, 5, "ArrowDown", "horizontal")).toBeNull();
  });

  it("an unrelated key moves nothing", () => {
    expect(nextRovingIndex(0, 5, "a", "vertical")).toBeNull();
  });

  it("an empty group never returns an index", () => {
    expect(nextRovingIndex(0, 0, "ArrowDown", "vertical")).toBeNull();
  });
});
