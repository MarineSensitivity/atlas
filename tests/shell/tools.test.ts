// atlas-3 step 3, spec.md §5.1: the rail is THREE controls, the SAME three, in the SAME order, on
// every viewport AND every lens (R3-W8 item 4 moved the Flower plot into the Layers pane as its own
// second tab; item 5 folded Places into the Report pane as its own first tab -- every remaining
// tool is active in both lenses, so `buildRailItems` needs no lens argument or an
// inactive/inactiveReason concept). This pins src/shell/tools.ts's data against that rule directly,
// and also closes the loop on the ONE piece of text index.html's static skeleton duplicates by hand
// (its default "Layers" panel body): if this drifts from TOOL_BODY.layers, the CLS gate would
// eventually catch the resulting height mismatch in a real browser, but this test catches the TEXT
// drift itself, immediately.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRailItems, TOOL_BODY, TOOL_LABEL, TOOL_ORDER } from "../../src/shell/tools";

describe("TOOL_ORDER: the rail is Layers, Table, Report -- in that order", () => {
  it("has exactly these three tools, in this exact order (spec.md §5.1)", () => {
    expect(TOOL_ORDER).toEqual(["layers", "table", "report"]);
  });

  it("every tool has a label and a body sentence -- nothing is missing", () => {
    for (const name of TOOL_ORDER) {
      expect(TOOL_LABEL[name]).toBeTruthy();
      expect(TOOL_BODY[name]).toBeTruthy();
    }
  });
});

describe("buildRailItems", () => {
  it("returns the three tools in TOOL_ORDER, with the right icon and label", () => {
    const items = buildRailItems();
    expect(items.map((i) => i.name)).toEqual([...TOOL_ORDER]);
    for (const item of items) {
      expect(item.icon).toBe(item.name); // icon-paths.ts names these three icons identically
      expect(item.label).toBe(TOOL_LABEL[item.name]);
    }
  });

  it("no tool is ever inactive -- every remaining tool is active in both lenses (R3-W8 item 4/5)", () => {
    const items = buildRailItems();
    for (const item of items) {
      expect("inactive" in item).toBe(false);
    }
  });
});

describe("the skeleton's default panel body text equals TOOL_BODY.layers", () => {
  it("index.html's static skeleton shows the exact same sentence main.ts's default tool shows", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(TOOL_BODY.layers);
  });
});
