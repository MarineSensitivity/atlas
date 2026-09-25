// R3-W8 item 3: the `ui=` token's parse/format core. See src/shell/uiState.ts's own header for
// what it carries and why it is a SEPARATE token from Sel's own query keys. R3-W8 item 4 bumped
// the token to version 2 (a 7th field, `tab`, for the Layers pane's own two tabs) and kept a
// read-only version-1 decode path so an old `?tool=flower` link (the retired rail tool's own v1
// code) still lands on the Layers pane's "info" tab.
import { describe, expect, it } from "vitest";
import { PANEL_SIZE_MAX, PANEL_SIZE_MIN } from "../../src/lib/ui/panelGeometry";
import { formatUi, parseUi, UI_TOKEN_VERSION, type UiState } from "../../src/shell/uiState";

const FULL: UiState = {
  tool: "table",
  dock: "left",
  size: 420,
  detent: "full",
  expandedRow: "data-zones",
  tab: "info",
};

describe("formatUi / parseUi: round trip", () => {
  it("round-trips every tool", () => {
    for (const tool of ["layers", "places", "table", "report"] as const) {
      const token = formatUi({ ...FULL, tool });
      expect(parseUi(token)).toEqual({ ...FULL, tool });
    }
  });

  it("round-trips every dock", () => {
    for (const dock of ["left", "right", "bottom"] as const) {
      expect(parseUi(formatUi({ ...FULL, dock }))).toEqual({ ...FULL, dock });
    }
  });

  it("round-trips every detent", () => {
    for (const detent of ["peek", "half", "full"] as const) {
      expect(parseUi(formatUi({ ...FULL, detent }))).toEqual({ ...FULL, detent });
    }
  });

  it("round-trips every expandedRow, including null (neither row expanded)", () => {
    for (const expandedRow of ["data-raster", "data-zones", null] as const) {
      expect(parseUi(formatUi({ ...FULL, expandedRow }))).toEqual({ ...FULL, expandedRow });
    }
  });

  it("round-trips every tab", () => {
    for (const tab of ["layers", "info"] as const) {
      expect(parseUi(formatUi({ ...FULL, tab }))).toEqual({ ...FULL, tab });
    }
  });

  it("round-trips the panel size boundaries", () => {
    expect(parseUi(formatUi({ ...FULL, size: PANEL_SIZE_MIN }))?.size).toBe(PANEL_SIZE_MIN);
    expect(parseUi(formatUi({ ...FULL, size: PANEL_SIZE_MAX }))?.size).toBe(PANEL_SIZE_MAX);
  });

  it("formatUi's own token shape starts with the version and has 7 dot-separated fields", () => {
    const token = formatUi(FULL);
    expect(UI_TOKEN_VERSION).toBe("2");
    expect(token.startsWith(`${UI_TOKEN_VERSION}.`)).toBe(true);
    expect(token.split(".")).toHaveLength(7);
  });
});

describe("parseUi: unknown/malformed input is ignored entirely (never a partial apply)", () => {
  it("null/undefined is absent", () => {
    expect(parseUi(null)).toBeNull();
    expect(parseUi(undefined)).toBeNull();
  });

  it("a wrong version is rejected whole", () => {
    expect(parseUi("3.l.r.380.h.d.l")).toBeNull();
  });

  it("a wrong field count is rejected whole (v2 needs exactly 7 fields)", () => {
    expect(parseUi("2.l.r.380.h.d")).toBeNull();
    expect(parseUi("2.l.r.380.h.d.l.x")).toBeNull();
  });

  it("an unrecognized tool/dock/detent/tab code is rejected whole", () => {
    expect(parseUi("2.x.r.380.h.d.l")).toBeNull();
    expect(parseUi("2.l.x.380.h.d.l")).toBeNull();
    expect(parseUi("2.l.r.380.x.d.l")).toBeNull();
    expect(parseUi("2.l.r.380.h.d.x")).toBeNull();
  });

  it("an unrecognized expandedRow code is rejected whole", () => {
    expect(parseUi("2.l.r.380.h.x.l")).toBeNull();
  });

  it("a non-numeric or out-of-range size is rejected whole", () => {
    expect(parseUi("2.l.r.bogus.h.d.l")).toBeNull();
    expect(parseUi("2.l.r.-10.h.d.l")).toBeNull();
    expect(parseUi(`2.l.r.${PANEL_SIZE_MIN - 1}.h.d.l`)).toBeNull();
    expect(parseUi(`2.l.r.${PANEL_SIZE_MAX + 1}.h.d.l`)).toBeNull();
  });

  it("garbage input entirely is rejected", () => {
    expect(parseUi("not-a-token-at-all")).toBeNull();
    expect(parseUi("")).toBeNull();
  });
});

describe("formatUi: size is clamped, never emitted out of range", () => {
  it("clamps a too-small or too-large size before formatting", () => {
    expect(parseUi(formatUi({ ...FULL, size: 1 }))?.size).toBe(PANEL_SIZE_MIN);
    expect(parseUi(formatUi({ ...FULL, size: 99999 }))?.size).toBe(PANEL_SIZE_MAX);
  });
});

// R3-W8 item 4: "an old `?tool=flower` ... must still open the Layers pane on the Flower tab" --
// the retired rail tool's own version-1 token shape (6 fields, tool code "f").
describe("parseUi: version-1 backward compatibility (the retired 'flower' rail tool)", () => {
  it("a v1 token naming the old 'flower' tool code opens Layers on the info tab", () => {
    expect(parseUi("1.f.r.380.h.d")).toEqual({
      tool: "layers",
      dock: "right",
      size: 380,
      detent: "half",
      expandedRow: "data-raster",
      tab: "info",
    });
  });

  it("a v1 token naming any OTHER (still-current) tool maps straight across, tab defaults to layers", () => {
    for (const [code, tool] of [
      ["l", "layers"],
      ["p", "places"],
      ["t", "table"],
      ["r", "report"],
    ] as const) {
      expect(parseUi(`1.${code}.r.380.h.n`)).toEqual({
        tool,
        dock: "right",
        size: 380,
        detent: "half",
        expandedRow: null,
        tab: "layers",
      });
    }
  });

  it("a v1 token still needs exactly 6 fields and valid dock/detent/row codes", () => {
    expect(parseUi("1.f.r.380.h")).toBeNull();
    expect(parseUi("1.f.r.380.h.d.x")).toBeNull();
    expect(parseUi("1.f.x.380.h.d")).toBeNull();
    expect(parseUi("1.f.r.380.x.d")).toBeNull();
    expect(parseUi("1.f.r.380.h.x")).toBeNull();
    expect(parseUi("1.f.r.bogus.h.d")).toBeNull();
  });
});
