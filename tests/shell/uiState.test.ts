// R3-W8 item 3: the `ui=` token's parse/format core. See src/shell/uiState.ts's own header for
// what it carries and why it is a SEPARATE token from Sel's own query keys.
import { describe, expect, it } from "vitest";
import { PANEL_SIZE_MAX, PANEL_SIZE_MIN } from "../../src/lib/ui/panelGeometry";
import { formatUi, parseUi, UI_TOKEN_VERSION, type UiState } from "../../src/shell/uiState";

const FULL: UiState = {
  tool: "table",
  dock: "left",
  size: 420,
  detent: "full",
  expandedRow: "data-zones",
};

describe("formatUi / parseUi: round trip", () => {
  it("round-trips every tool", () => {
    for (const tool of ["layers", "places", "flower", "table", "report"] as const) {
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

  it("round-trips the panel size boundaries", () => {
    expect(parseUi(formatUi({ ...FULL, size: PANEL_SIZE_MIN }))?.size).toBe(PANEL_SIZE_MIN);
    expect(parseUi(formatUi({ ...FULL, size: PANEL_SIZE_MAX }))?.size).toBe(PANEL_SIZE_MAX);
  });

  it("formatUi's own token shape starts with the version and has 6 dot-separated fields", () => {
    const token = formatUi(FULL);
    expect(token.startsWith(`${UI_TOKEN_VERSION}.`)).toBe(true);
    expect(token.split(".")).toHaveLength(6);
  });
});

describe("parseUi: unknown/malformed input is ignored entirely (never a partial apply)", () => {
  it("null/undefined is absent", () => {
    expect(parseUi(null)).toBeNull();
    expect(parseUi(undefined)).toBeNull();
  });

  it("a wrong version is rejected whole", () => {
    expect(parseUi("2.l.r.380.h.d")).toBeNull();
  });

  it("a wrong field count is rejected whole", () => {
    expect(parseUi("1.l.r.380.h")).toBeNull();
    expect(parseUi("1.l.r.380.h.d.x")).toBeNull();
  });

  it("an unrecognized tool/dock/detent code is rejected whole", () => {
    expect(parseUi("1.x.r.380.h.d")).toBeNull();
    expect(parseUi("1.l.x.380.h.d")).toBeNull();
    expect(parseUi("1.l.r.380.x.d")).toBeNull();
  });

  it("an unrecognized expandedRow code is rejected whole", () => {
    expect(parseUi("1.l.r.380.h.x")).toBeNull();
  });

  it("a non-numeric or out-of-range size is rejected whole", () => {
    expect(parseUi("1.l.r.bogus.h.d")).toBeNull();
    expect(parseUi("1.l.r.-10.h.d")).toBeNull();
    expect(parseUi(`1.l.r.${PANEL_SIZE_MIN - 1}.h.d`)).toBeNull();
    expect(parseUi(`1.l.r.${PANEL_SIZE_MAX + 1}.h.d`)).toBeNull();
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
