import { describe, expect, it } from "vitest";
import { legendLayout } from "../../src/lib/download/legendLayout";

describe("legendLayout", () => {
  it("places the bar bottom-left of the MAP area, above the footer band", () => {
    const l = legendLayout({ canvasWidth: 800, canvasHeight: 646, footerHeight: 46 });
    expect(l.x).toBe(16);
    expect(l.width).toBe(160);
    expect(l.height).toBe(10);
    // the bar's bottom edge sits (margin + labelGap) above the map's own bottom edge (646-46=600).
    expect(l.y + l.height).toBeLessThan(600);
    expect(l.labelY).toBeGreaterThan(l.y + l.height); // labels sit below the bar
  });

  it("honors custom margin/bar size", () => {
    const l = legendLayout({
      canvasWidth: 400,
      canvasHeight: 300,
      footerHeight: 46,
      margin: 8,
      barWidth: 100,
      barHeight: 6,
    });
    expect(l.x).toBe(8);
    expect(l.width).toBe(100);
    expect(l.height).toBe(6);
  });

  it("is deterministic for the same inputs", () => {
    const opts = { canvasWidth: 1280, canvasHeight: 846, footerHeight: 46 };
    expect(legendLayout(opts)).toEqual(legendLayout(opts));
  });
});
