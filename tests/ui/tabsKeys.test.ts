import { describe, expect, it } from "vitest";
import { tabsKeyTarget } from "../../src/lib/ui/tabsKeys";

describe("tabsKeyTarget (Tabs.svelte's keyboard roving)", () => {
  it("ArrowRight selects the next tab", () => {
    expect(tabsKeyTarget(0, 3, "ArrowRight")).toBe(1);
  });
  it("ArrowLeft selects the previous tab", () => {
    expect(tabsKeyTarget(2, 3, "ArrowLeft")).toBe(1);
  });
  it("wraps at both ends", () => {
    expect(tabsKeyTarget(2, 3, "ArrowRight")).toBe(0);
    expect(tabsKeyTarget(0, 3, "ArrowLeft")).toBe(2);
  });
  it("Home and End jump to the first and last tab", () => {
    expect(tabsKeyTarget(1, 3, "Home")).toBe(0);
    expect(tabsKeyTarget(1, 3, "End")).toBe(2);
  });
  it("vertical arrows and other keys are not ours", () => {
    expect(tabsKeyTarget(1, 3, "ArrowDown")).toBeNull();
    expect(tabsKeyTarget(1, 3, "a")).toBeNull();
  });
});
