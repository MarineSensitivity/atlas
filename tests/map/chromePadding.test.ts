import { describe, expect, it } from "vitest";
import { desktopPanelPadding, phonePadding } from "../../src/lib/map/chromePadding";
import { DEFAULT_PANEL_GEOMETRY } from "../../src/lib/ui/panelGeometry";

describe("desktopPanelPadding (usability M4)", () => {
  it("default geometry (dock right, 380px, not collapsed) reserves the right edge", () => {
    expect(desktopPanelPadding(DEFAULT_PANEL_GEOMETRY)).toEqual({
      top: 0,
      right: 380,
      bottom: 0,
      left: 0,
    });
  });

  it("dock left reserves the left edge", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, dock: "left" })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 380,
    });
  });

  it("dock bottom reserves the bottom edge", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, dock: "bottom" })).toEqual({
      top: 0,
      right: 0,
      bottom: 380,
      left: 0,
    });
  });

  it("a resized panel reserves its OWN size, not the default", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, size: 600 }).right).toBe(600);
  });

  it("collapsed reserves nothing (the pill is small; the map is effectively fully visible)", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, collapsed: true })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it("maximized reserves nothing (it covers the whole stage -- no 'visible remainder' to frame)", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, maximized: true })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});

describe("phonePadding (usability M4)", () => {
  it("peek reserves a small, fixed bottom strip", () => {
    const p = phonePadding("peek", 844);
    expect(p.bottom).toBeGreaterThan(96); // the sheet's own peek height alone
    expect(p.top).toBe(0);
    expect(p.left).toBe(0);
    expect(p.right).toBe(0);
  });

  it("half reserves roughly 46% of the viewport height, plus the rail row", () => {
    const p = phonePadding("half", 800);
    expect(p.bottom).toBeGreaterThan(800 * 0.4);
    expect(p.bottom).toBeLessThan(800 * 0.6);
  });

  it("full reserves MORE than half (never less) for the same viewport", () => {
    const half = phonePadding("half", 800);
    const full = phonePadding("full", 800);
    expect(full.bottom).toBeGreaterThanOrEqual(half.bottom);
  });

  it("a taller viewport reserves a taller (not identical) strip at half", () => {
    const short = phonePadding("half", 700);
    const tall = phonePadding("half", 1000);
    expect(tall.bottom).toBeGreaterThan(short.bottom);
  });
});
