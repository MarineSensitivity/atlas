import { describe, expect, it } from "vitest";
import { compositionTree } from "../../../src/lens/scores/composition";

describe("compositionTree", () => {
  it("groups by category, summed by suit_er_area", () => {
    const tree = compositionTree([
      { sp_cat: "bird", suit_er_area: 10 },
      { sp_cat: "bird", suit_er_area: 5 },
      { sp_cat: "fish", suit_er_area: 3 },
    ]);
    expect(tree.children).toEqual([
      { name: "Bird", categoryKey: "bird", value: 15 },
      { name: "Fish", categoryKey: "fish", value: 3 },
    ]);
  });

  it("folds synonym spellings into the same category (the primary producer bug fix)", () => {
    const tree = compositionTree([
      { sp_cat: "primary_producer", suit_er_area: 4 },
      { sp_cat: "primprod", suit_er_area: 6 },
    ]);
    expect(tree.children).toEqual([
      { name: "Primary producer", categoryKey: "primprod", value: 10 },
    ]);
  });

  it("drops a category with no positive sum, never a zero-size box", () => {
    const tree = compositionTree([{ sp_cat: "bird", suit_er_area: 0 }]);
    expect(tree.children).toEqual([]);
  });

  it("an unrecognized sp_cat still gets a box under its own name", () => {
    const tree = compositionTree([{ sp_cat: "reptile", suit_er_area: 2 }]);
    expect(tree.children).toEqual([{ name: "reptile", value: 2 }]);
  });
});
