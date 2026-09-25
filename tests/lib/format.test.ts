// UI-4 (round-3 review): `formatSubject`/`formatValueLine`/`formatLatLon` -- the one subject/value
// line every popup, flower title and species-table header now shares. See src/lib/format.ts's own
// header for the reported defect (five different spellings of the same cell).
import { describe, expect, it } from "vitest";
import { formatLatLon, formatScore, formatSubject, formatValueLine } from "../../src/lib/format";

describe("formatScore", () => {
  it("rounds to exactly one decimal place", () => {
    expect(formatScore(45.6671707107685)).toBe("45.7");
    expect(formatScore(10)).toBe("10.0");
  });
});

describe("formatLatLon", () => {
  it("3 dp, sign folded into a compass letter", () => {
    expect(formatLatLon(28.625, -90.575)).toBe("28.625° N, 90.575° W");
  });

  it("negative latitude reads S, positive longitude reads E", () => {
    expect(formatLatLon(-12.5, 141.1)).toBe("12.500° S, 141.100° E");
  });

  it("zero reads N/E, never a negative-zero S/W", () => {
    expect(formatLatLon(0, 0)).toBe("0.000° N, 0.000° E");
  });
});

describe("formatSubject (UI-4/UI-5)", () => {
  it("no selection: 'All US waters' -- the Zoom-to-region select's own no-selection label", () => {
    expect(formatSubject(null)).toBe("All US waters");
  });

  it("a cell: 'Cell {id} · {lat}° N, {lon}° W'", () => {
    expect(formatSubject({ kind: "cell", cellId: 3350704, lon: -90.575, lat: 28.625 })).toBe(
      "Cell 3350704 · 28.625° N, 90.575° W",
    );
  });

  it("a zone: its own (already-resolved) name, verbatim", () => {
    expect(formatSubject({ kind: "zone", name: "GOA Program Area A (GAA)" })).toBe(
      "GOA Program Area A (GAA)",
    );
  });
});

describe("formatValueLine (UI-4)", () => {
  it("a label and a half-even-rounded integer value", () => {
    expect(formatValueLine("Score", 44.4)).toBe("Score 44");
    expect(formatValueLine("Suitability", 70.6)).toBe("Suitability 71");
  });

  it("null value: an em dash, never a blank or a throw", () => {
    expect(formatValueLine("Score", null)).toBe("Score —");
  });

  it("rounds .5 up like Math.round (not R's half-even) -- matches the popup's prior convention", () => {
    expect(formatValueLine("Score", 44.5)).toBe("Score 45");
  });
});
