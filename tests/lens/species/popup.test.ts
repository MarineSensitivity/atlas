// popup.ts: §6.5's swatch/luminance/text rules, generalized to the asset's own rescale (not a
// hard-coded [1,100]) so an AquaX Delivered click (raw band [0,1000]) still picks the right bin.
import { describe, expect, it } from "vitest";
import {
  luminance,
  popupContent,
  popupHtml,
  roundValue,
  textColorFor,
} from "../../../src/lens/species/popup";
import { RANGE_FILL_COLOR } from "../../../src/lib/map/colors";

// 11 stops, min->black-ish (dark) at index 0, max->white-ish (light) at index 10, so the bin math
// is easy to eyeball: this is a TEST fixture ramp, never a second app-wide palette.
const STOPS = [
  "#000000",
  "#191919",
  "#333333",
  "#4c4c4c",
  "#666666",
  "#7f7f7f",
  "#999999",
  "#b2b2b2",
  "#cccccc",
  "#e5e5e5",
  "#ffffff",
];

describe("luminance / textColorFor", () => {
  it("R's own weights, 0.299/0.587/0.114 — black on white, white on black", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(textColorFor("#ffffff")).toBe("black");
    expect(textColorFor("#000000")).toBe("white");
  });

  it("the exact 0.5 threshold", () => {
    // luminance(0.299,0.587,0.114) . (128,128,128)/255 ≈ 0.502 > 0.5 -> black
    expect(textColorFor("#808080")).toBe("black");
  });
});

describe("roundValue", () => {
  it("half-to-even at 3 decimals", () => {
    expect(roundValue(1.2345, 3)).toBeCloseTo(1.234, 5); // 1.2345*1000=1234.5 -> even 1234
    expect(roundValue(1.2335, 3)).toBeCloseTo(1.234, 5); // 1233.5 -> even 1234
  });
});

describe("popupContent", () => {
  it("a numeric value bins against the asset's OWN rescale, not a hard-coded [1,100]", () => {
    // AquaX Delivered: raw band [0,1000]; a value near the top should land near the light end
    const near1000 = popupContent({
      sci: "Dermochelys coriacea",
      lon: -70,
      lat: 30,
      cellId: 12345,
      kind: "value",
      value: 950,
      rescale: [0, 1000],
      stops: STOPS,
    });
    expect(near1000.pinColor).toBe("#ffffff");
    expect(near1000.textColor).toBe("black");
    expect(near1000.text).toBe("Value: 950");
    expect(near1000.displayValue).toBe(950);
  });

  it("the default [1,100] case (everything but AquaX Delivered)", () => {
    const p = popupContent({
      sci: "x",
      lon: 1,
      lat: 2,
      cellId: 1,
      kind: "value",
      value: 1,
      rescale: [1, 100],
      stops: STOPS,
    });
    expect(p.pinColor).toBe("#000000");
    expect(p.textColor).toBe("white");
  });

  it("no boot.palettes yet: the value still shows, with a neutral grey pin (no invented ramp)", () => {
    const p = popupContent({
      sci: "x",
      lon: 1,
      lat: 2,
      cellId: 1,
      kind: "value",
      value: 42.5,
      rescale: [1, 100],
      stops: null,
    });
    expect(p.pinColor).toBe("grey");
    expect(p.textColor).toBeNull();
    expect(p.text).toBe("Value: 42.5");
  });

  it("a range click reports 'presence only', swatch = the range fill color", () => {
    const p = popupContent({ sci: "x", lon: 1, lat: 2, cellId: 1, kind: "presence" });
    expect(p.text).toBe("presence only");
    expect(p.pinColor).toBe(RANGE_FILL_COLOR);
    expect(p.displayValue).toBeNull();
  });

  it("no value (a nodata COG pixel, or outside the grid): grey pin + 'no value here'", () => {
    const p = popupContent({ sci: "x", lon: 1, lat: 2, cellId: null, kind: "no-value" });
    expect(p.text).toBe("no value here");
    expect(p.pinColor).toBe("grey");
    expect(p.textColor).toBeNull();
  });

  it("kind 'value' with a missing value/rescale degrades to 'no value here' rather than throwing", () => {
    const p = popupContent({ sci: "x", lon: 1, lat: 2, cellId: 1, kind: "value" });
    expect(p.kind).toBe("no-value");
    expect(p.text).toBe("no value here");
  });
});

describe("popupHtml", () => {
  it("§6.5's name/cell/lon/lat/value shape, swatch colored, text contrast applied", () => {
    const html = popupHtml(
      popupContent({
        sci: "Dermochelys coriacea",
        lon: -70.1234,
        lat: 30.5678,
        cellId: 12345,
        kind: "value",
        value: 1,
        rescale: [1, 100],
        stops: STOPS,
      }),
    );
    expect(html).toContain("<i>Dermochelys coriacea</i>");
    expect(html).toContain("Cell ID: 12345");
    expect(html).toContain("Lon: -70.123");
    expect(html).toContain("Lat: 30.568");
    expect(html).toContain("background:#000000;color:white");
    expect(html).toContain("Value: 1");
  });

  it("no cell id renders an em dash, never 'null'", () => {
    const html = popupHtml(
      popupContent({ sci: "x", lon: 1, lat: 2, cellId: null, kind: "no-value" }),
    );
    expect(html).toContain("Cell ID: —");
    expect(html).not.toContain("null");
  });

  it("a species/common name is escaped, never raw markup, in a Popup#setHTML string", () => {
    const html = popupHtml(
      popupContent({
        sci: "<img src=x onerror=alert(1)>",
        lon: 1,
        lat: 2,
        cellId: 1,
        kind: "no-value",
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
