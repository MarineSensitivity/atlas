// atlas-4 fix round 3: the scores lens' click popup text — cell id, lon/lat (3 dp), the displayed
// layer's value (the Selection checklist), and the zone tooltip text (§6.4, `zoneFill.ts`'s
// `zoneTooltip()`, now actually wired to something).
import { describe, expect, it } from "vitest";
import {
  cellPopupAnnounceText,
  cellPopupLoadingText,
  cellPopupText,
  escapeHtml,
  zonePopupText,
} from "../../../src/lens/scores/popup";
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

  // D3 (Opus 5.5 eyes-on, 2026-09-24): a click outside the scored area (Utah, on the owner's
  // screenshot) used to read "Cell 2711027 · lon -113.526, lat 38.932 · {30-word layer
  // description}: no value" -- a cell id (implying the app found a scored cell — it did not) and
  // the FULL layer title, both misleading. Superseded by the fixture below: the OLD assertion
  // ("Cell 1 · lon 0.000, lat 0.000 · Overall score: no value") is the exact bug, not a spec to
  // keep passing.
  it("D3: a click with NO value (off-grid / unscored) reads a plain 'No scored cell here' + coordinates — never a cell id, never the layer label", () => {
    const text = cellPopupText({
      cellId: 2711027,
      lon: -113.526,
      lat: 38.932,
      layerLabel: "Primary productivity: Oregon State Vertically Generalized Production Model",
      value: null,
    });
    expect(text).toBe("No scored cell here · lon -113.526, lat 38.932");
    expect(text).not.toContain("2711027");
    expect(text).not.toContain("Primary productivity");
    expect(text).not.toContain("no value"); // the old, data-blaming wording
  });

  it("D3: the announce() text matches (no escaping needed — no dynamic label is interpolated)", () => {
    const text = cellPopupAnnounceText({
      cellId: 2711027,
      lon: -113.526,
      lat: 38.932,
      layerLabel: "<b>whatever</b>",
      value: null,
    });
    expect(text).toBe("No scored cell here · lon -113.526, lat 38.932");
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
  // V4 fix (owner phone report, 2026-09-24, docs fact-check item 3): both the has-value branch
  // (via `zoneValuesFor`'s own `paLabel()` fix) and the no-value branch (this module's own
  // `paLabel()` call) now show "Full Name (KEY)", the same label the Zones table already shows,
  // instead of the bare published name.
  it("'{name}: {round(value)}' — parity doc §6.4, verbatim (half-to-even, 0 dp)", () => {
    expect(zonePopupText(ZONES, "score", { key: "GAA", name: "Gulf of America, Eastern" })).toBe(
      "Gulf of America, Eastern (GAA): 33",
    );
  });

  it("falls back to the key when the zone carries no name (and no PROGRAM_AREA_NAMES fallback)", () => {
    expect(zonePopupText(ZONES, "score", { key: "NONAME", name: "NONAME" })).toBe("NONAME: 10");
  });

  it("no value for this layer -> '{name} (KEY): no value', never a throw", () => {
    expect(zonePopupText(ZONES, "score", { key: "MDA", name: "Mid Atlantic" })).toBe(
      "Mid Atlantic (MDA): no value",
    );
  });

  it("lyr === null (no boot.layers yet) -> 'no value' rather than guessing a metric", () => {
    expect(zonePopupText(ZONES, null, { key: "GAA", name: "Gulf of America, Eastern" })).toBe(
      "Gulf of America, Eastern (GAA): no value",
    );
  });

  it("the zone's own name is escaped too (paLabel's parenthetical key is plain text, never escaped away)", () => {
    expect(zonePopupText([], "score", { key: "X", name: "<i>X</i>" })).toBe(
      "&lt;i&gt;X&lt;/i&gt; (X): no value",
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the four characters that matter in an innerHTML string", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});

// usability M9: the popup opens at once with this line, before the engine has answered.
describe("cellPopupLoadingText", () => {
  it("cell id, lon/lat at 3 dp, and a loading line -- no value yet, never a throw", () => {
    const text = cellPopupLoadingText({ cellId: 123456, lon: -70.123456, lat: 41.987654 });
    expect(text).toBe("Cell 123456 · lon -70.123, lat 41.988 · Loading value…");
  });
});
