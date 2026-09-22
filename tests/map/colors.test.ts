// GATE (atlas-6 Deliverable 3): pin SELECTION_COLOR's literal value. Before this file, every test
// that touched SELECTION_COLOR imported the constant and compared other code against IT -- so the
// constant itself could drift to any other hex value and every one of those tests would stay green.
// This is the one place a literal `"#ff00aa"` appears, on purpose: the fill/line color a drawn
// place, a picked zone or a selected cell renders in (atlas-4 §6.6/§7.1-7.3) is "the one hue absent
// from every data ramp" -- changing it is a design decision, not a refactor, and must show up as a
// diff here.
import { describe, expect, it } from "vitest";
import { SELECTION_COLOR } from "../../src/lib/map/colors";

describe("SELECTION_COLOR is pinned", () => {
  it('is exactly "#ff00aa"', () => {
    expect(SELECTION_COLOR).toBe("#ff00aa");
  });
});
