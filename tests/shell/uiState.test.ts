// R3-W8 item 3: the `ui=` token's parse/format core. See src/shell/uiState.ts's own header for
// what it carries and why it is a SEPARATE token from Sel's own query keys. Item 4 bumped the
// token to version 2 (a 7th field, `tab`, for the Layers pane's own two tabs). Item 5 bumped it
// again to version 3 (an 8th field, `reportTab`, for the Report pane's own two tabs -- Places
// folded into Report as its first tab) and kept read-only version-1/version-2 decode paths so an
// old `?tool=flower`/`?tool=places` link (the two retired rail tools' own legacy codes) still lands
// on the right pane/tab.
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
  reportTab: "report",
};

describe("formatUi / parseUi: round trip", () => {
  it("round-trips every tool", () => {
    for (const tool of ["layers", "table", "report"] as const) {
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

  it("round-trips every reportTab", () => {
    for (const reportTab of ["places", "report"] as const) {
      expect(parseUi(formatUi({ ...FULL, reportTab }))).toEqual({ ...FULL, reportTab });
    }
  });

  it("round-trips the panel size boundaries", () => {
    expect(parseUi(formatUi({ ...FULL, size: PANEL_SIZE_MIN }))?.size).toBe(PANEL_SIZE_MIN);
    expect(parseUi(formatUi({ ...FULL, size: PANEL_SIZE_MAX }))?.size).toBe(PANEL_SIZE_MAX);
  });

  it("formatUi's own token shape starts with the version and has 8 dot-separated fields", () => {
    const token = formatUi(FULL);
    expect(UI_TOKEN_VERSION).toBe("3");
    expect(token.startsWith(`${UI_TOKEN_VERSION}.`)).toBe(true);
    expect(token.split(".")).toHaveLength(8);
  });
});

describe("parseUi: unknown/malformed input is ignored entirely (never a partial apply)", () => {
  it("null/undefined is absent", () => {
    expect(parseUi(null)).toBeNull();
    expect(parseUi(undefined)).toBeNull();
  });

  it("a wrong version is rejected whole", () => {
    expect(parseUi("4.l.r.380.h.d.l.1")).toBeNull();
  });

  it("a wrong field count is rejected whole (v3 needs exactly 8 fields)", () => {
    expect(parseUi("3.l.r.380.h.d.l")).toBeNull();
    expect(parseUi("3.l.r.380.h.d.l.1.x")).toBeNull();
  });

  it("an unrecognized tool/dock/detent/tab/reportTab code is rejected whole", () => {
    expect(parseUi("3.x.r.380.h.d.l.1")).toBeNull();
    expect(parseUi("3.l.x.380.h.d.l.1")).toBeNull();
    expect(parseUi("3.l.r.380.x.d.l.1")).toBeNull();
    expect(parseUi("3.l.r.380.h.d.x.1")).toBeNull();
    expect(parseUi("3.l.r.380.h.d.l.x")).toBeNull();
  });

  it("an unrecognized expandedRow code is rejected whole", () => {
    expect(parseUi("3.l.r.380.h.x.l.1")).toBeNull();
  });

  it("a non-numeric or out-of-range size is rejected whole", () => {
    expect(parseUi("3.l.r.bogus.h.d.l.1")).toBeNull();
    expect(parseUi("3.l.r.-10.h.d.l.1")).toBeNull();
    expect(parseUi(`3.l.r.${PANEL_SIZE_MIN - 1}.h.d.l.1`)).toBeNull();
    expect(parseUi(`3.l.r.${PANEL_SIZE_MAX + 1}.h.d.l.1`)).toBeNull();
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
      reportTab: "places",
    });
  });

  // R3-W8 item 5: "Places folds into the Report tool as its first tab" -- the retired "places"
  // rail tool's own v1 code ("p") opens Report on its default (Places) tab.
  it("a v1 token naming the old 'places' tool code opens Report on the places tab", () => {
    expect(parseUi("1.p.r.380.h.d")).toEqual({
      tool: "report",
      dock: "right",
      size: 380,
      detent: "half",
      expandedRow: "data-raster",
      tab: "layers",
      reportTab: "places",
    });
  });

  it("a v1 token naming any OTHER (still-current) tool maps straight across, tab/reportTab default", () => {
    for (const [code, tool] of [
      ["l", "layers"],
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
        reportTab: "places",
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

// R3-W8 item 5: "Places folds into the Report tool as its first tab" -- the retired "places" rail
// tool's own version-2 token shape (7 fields, tool code "p", `tab` already present).
describe("parseUi: version-2 backward compatibility (the retired 'places' rail tool)", () => {
  it("a v2 token naming the old 'places' tool code opens Report on the places tab", () => {
    expect(parseUi("2.p.r.380.h.d.i")).toEqual({
      tool: "report",
      dock: "right",
      size: 380,
      detent: "half",
      expandedRow: "data-raster",
      tab: "info",
      reportTab: "places",
    });
  });

  it("a v2 token naming any OTHER (still-current) tool maps straight across, reportTab defaults to places", () => {
    for (const [code, tool] of [
      ["l", "layers"],
      ["t", "table"],
      ["r", "report"],
    ] as const) {
      expect(parseUi(`2.${code}.r.380.h.n.l`)).toEqual({
        tool,
        dock: "right",
        size: 380,
        detent: "half",
        expandedRow: null,
        tab: "layers",
        reportTab: "places",
      });
    }
  });

  it("a v2 token still needs exactly 7 fields and valid dock/detent/row/tab codes", () => {
    expect(parseUi("2.p.r.380.h.d")).toBeNull();
    expect(parseUi("2.p.r.380.h.d.l.x")).toBeNull();
    expect(parseUi("2.p.x.380.h.d.l")).toBeNull();
    expect(parseUi("2.p.r.380.x.d.l")).toBeNull();
    expect(parseUi("2.p.r.380.h.x.l")).toBeNull();
    expect(parseUi("2.p.r.380.h.d.x")).toBeNull();
    expect(parseUi("2.p.r.bogus.h.d.l")).toBeNull();
  });
});
