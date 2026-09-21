// atlas-3 step 3, spec.md §5.1/§5.2: the rail is FIVE controls, the SAME five, in the SAME order,
// on every viewport; the Flower control fades in place (never removed) in the Species lens. This
// pins src/shell/tools.ts's data against that rule directly, and also closes the loop on the ONE
// piece of text index.html's static skeleton duplicates by hand (its default "Layers" panel body):
// if this drifts from TOOL_BODY.layers, the CLS gate would eventually catch the resulting height
// mismatch in a real browser, but this test catches the TEXT drift itself, immediately.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRailItems, TOOL_BODY, TOOL_LABEL, TOOL_ORDER } from "../../src/shell/tools";

describe("TOOL_ORDER: the rail is Layers, Places, Flower, Table, Report -- in that order", () => {
  it("has exactly these five tools, in this exact order (spec.md §5.1)", () => {
    expect(TOOL_ORDER).toEqual(["layers", "places", "flower", "table", "report"]);
  });

  it("every tool has a label and a body sentence -- nothing is missing", () => {
    for (const name of TOOL_ORDER) {
      expect(TOOL_LABEL[name]).toBeTruthy();
      expect(TOOL_BODY[name]).toBeTruthy();
    }
  });
});

describe("buildRailItems", () => {
  it("returns the five tools in TOOL_ORDER, with the right icon and label", () => {
    const items = buildRailItems(false);
    expect(items.map((i) => i.name)).toEqual([...TOOL_ORDER]);
    for (const item of items) {
      expect(item.icon).toBe(item.name); // icon-paths.ts names these five icons identically
      expect(item.label).toBe(TOOL_LABEL[item.name]);
    }
  });

  it("no tool is inactive in the Scores lens", () => {
    const items = buildRailItems(false);
    expect(items.every((i) => !i.inactive)).toBe(true);
  });

  it("ONLY Flower is inactive in the Species lens, and it says why (spec.md §5.2)", () => {
    const items = buildRailItems(true);
    const flower = items.find((i) => i.name === "flower")!;
    expect(flower.inactive).toBe(true);
    expect(flower.inactiveReason).toBe("Flower plot — Scores only");
    for (const item of items) {
      if (item.name === "flower") continue;
      expect(item.inactive).toBeFalsy();
    }
  });

  it("Flower stays in its third position in the Species lens -- never removed", () => {
    expect(buildRailItems(true)[2].name).toBe("flower");
  });
});

describe("the skeleton's default panel body text equals TOOL_BODY.layers", () => {
  it("index.html's static skeleton shows the exact same sentence main.ts's default tool shows", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(TOOL_BODY.layers);
  });
});
