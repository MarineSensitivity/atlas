// atlas-4 fix round 3: the scores lens' click popup text — cell id, lon/lat (3 dp), the displayed
// layer's value (the Selection checklist), and the zone tooltip text (§6.4, `zoneFill.ts`'s
// `zoneTooltip()`, now actually wired to something).
import { describe, expect, it } from "vitest";
import { cellPopupText, escapeHtml, zonePopupText } from "../../../src/lens/scores/popup";
import type { ZoneRow } from "../../../src/lens/scores/boot";

describe("cellPopupText", () => {
  it("cell id, lon/lat at EXACTLY 3 dp, and the displayed layer's value", () => {
    const text = cellPopupText({
      cellId: 123456,
      lon: -70.123456,
      lat: 41.987654,
      layerLabel: "Overall score",
      value: 42,
    });
    expect(text).toBe("Cell 123456 · lon -70.123, lat 41.988 · Overall score: 42");
  });

  it("2 dp instead of 3 is the exact fault this popup must never regress to", () => {
    const text = cellPopupText({
      cellId: 1,
      lon: -70.123456,
      lat: 41.987654,
      layerLabel: "x",
      value: 1,
    });
    expect(text).not.toContain("lon -70.12,");
    expect(text).toContain("lon -70.123,");
    expect(text).toContain("lat 41.988");
  });

  it("the value is round(value, 2), half-to-even (the flower panel's own per-component convention)", () => {
    expect(cellPopupText({ cellId: 1, lon: 0, lat: 0, layerLabel: "x", value: 17.005 })).toContain(
      "x: 17",
    );
    expect(
      cellPopupText({ cellId: 1, lon: 0, lat: 0, layerLabel: "x", value: 17.005001 }),
    ).toContain("x: 17.01");
  });

  it("no value (off-grid / unscored) reads 'no value', never NaN or blank", () => {
    const text = cellPopupText({
      cellId: 1,
      lon: 0,
      lat: 0,
      layerLabel: "Overall score",
      value: null,
    });
    expect(text).toBe("Cell 1 · lon 0.000, lat 0.000 · Overall score: no value");
  });

  it("the layer label is escaped (a release string is untrusted text, never markup)", () => {
    const text = cellPopupText({ cellId: 1, lon: 0, lat: 0, layerLabel: "<b>x</b>", value: 1 });
    expect(text).not.toContain("<b>");
    expect(text).toContain("&lt;b&gt;");
  });
});

const ZONES: ZoneRow[] = [
  { key: "GAA", name: "Gulf of America, Eastern", n_taxa: 10, metrics: { score: 33.09 } },
  { key: "MDA", name: "Mid Atlantic", n_taxa: 10, metrics: {} },
  { key: "NONAME", n_taxa: 10, metrics: { score: 10 } },
];

describe("zonePopupText", () => {
  it("'{name}: {round(value)}' — parity doc §6.4, verbatim (half-to-even, 0 dp)", () => {
    expect(zonePopupText(ZONES, "score", { key: "GAA", name: "Gulf of America, Eastern" })).toBe(
      "Gulf of America, Eastern: 33",
    );
  });

  it("falls back to the key when the zone carries no name", () => {
    expect(zonePopupText(ZONES, "score", { key: "NONAME", name: "NONAME" })).toBe("NONAME: 10");
  });

  it("no value for this layer -> '{name}: no value', never a throw", () => {
    expect(zonePopupText(ZONES, "score", { key: "MDA", name: "Mid Atlantic" })).toBe(
      "Mid Atlantic: no value",
    );
  });

  it("lyr === null (no boot.layers yet) -> 'no value' rather than guessing a metric", () => {
    expect(zonePopupText(ZONES, null, { key: "GAA", name: "Gulf of America, Eastern" })).toBe(
      "Gulf of America, Eastern: no value",
    );
  });

  it("the zone's own name is escaped too", () => {
    expect(zonePopupText([], "score", { key: "X", name: "<i>X</i>" })).toBe(
      "&lt;i&gt;X&lt;/i&gt;: no value",
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the four characters that matter in an innerHTML string", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
