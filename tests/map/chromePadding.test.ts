import { describe, expect, it } from "vitest";
import {
  desktopPanelPadding,
  LEGEND_CHIP_HEIGHT_PX,
  phoneLiveChromePadding,
  phonePadding,
  phonePaddingFromMeasured,
} from "../../src/lib/map/chromePadding";
import { DEFAULT_PANEL_GEOMETRY } from "../../src/lib/ui/panelGeometry";

// P2 (Opus 5.5 eyes-on, 2026-09-24): `top` used to be 0 in EVERY case below -- the top bar sits
// over the map on both platforms regardless of panel/sheet state, and was simply never accounted
// for, so the first-view shift only ever compensated for the panel/sheet. `TOPBAR_HEIGHT_PX` (48,
// `tokens.css`'s `--size-topbar`) is now reserved unconditionally by both functions.
const TOPBAR = 48;

describe("desktopPanelPadding (usability M4)", () => {
  it("default geometry (dock right, 380px, not collapsed) reserves the right edge and the top bar", () => {
    expect(desktopPanelPadding(DEFAULT_PANEL_GEOMETRY)).toEqual({
      top: TOPBAR,
      right: 380,
      bottom: 0,
      left: 0,
    });
  });

  it("dock left reserves the left edge and the top bar", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, dock: "left" })).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: 0,
      left: 380,
    });
  });

  it("dock bottom reserves the bottom edge and the top bar", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, dock: "bottom" })).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: 380,
      left: 0,
    });
  });

  it("a resized panel reserves its OWN size, not the default", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, size: 600 }).right).toBe(600);
  });

  it("collapsed still reserves the top bar (the pill is small; the map is otherwise fully visible)", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, collapsed: true })).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it("maximized still reserves the top bar (the panel covers the rest of the stage -- no other 'visible remainder' to frame)", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, maximized: true })).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});

describe("phonePadding (usability M4)", () => {
  it("peek reserves a small, fixed bottom strip, and the top bar", () => {
    const p = phonePadding("peek", 844);
    expect(p.bottom).toBeGreaterThan(96); // the sheet's own peek height alone
    expect(p.top).toBe(TOPBAR);
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

// P2 round 2 (orchestrator, real-build eyes-on, 2026-09-24): the re-fit's own padding source --
// Sheet.svelte's REAL measured `offsetHeight`, not the 46svh-derived ESTIMATE `phonePadding` above
// computes before the Sheet has ever mounted.
describe("phonePaddingFromMeasured (P2 round 2)", () => {
  it("reserves the top bar + the measured sheet height + the rail row", () => {
    const p = phonePaddingFromMeasured(388);
    expect(p.top).toBe(TOPBAR);
    expect(p.bottom).toBeGreaterThan(388); // the rail row is added on top of the measured height
    expect(p.left).toBe(0);
    expect(p.right).toBe(0);
  });

  it("a taller measured sheet reserves proportionally more, never less", () => {
    const shorter = phonePaddingFromMeasured(200);
    const taller = phonePaddingFromMeasured(400);
    expect(taller.bottom).toBeGreaterThan(shorter.bottom);
    expect(taller.bottom - shorter.bottom).toBe(200); // a 1:1 passthrough, not a re-derived fraction
  });

  it("is close to (but not required to equal) the ESTIMATE for a plausible real height", () => {
    // the estimate for "half" at a typical phone viewport (844) is ~452px total bottom reservation
    // (phonePadding's own 46svh + rail-row formula); a real measured sheet height in that
    // neighbourhood should land the corrected padding within a modest margin of it.
    const estimate = phonePadding("half", 844);
    const measured = phonePaddingFromMeasured(388); // a real sheet height close to 844*0.46
    expect(Math.abs(measured.bottom - estimate.bottom)).toBeLessThan(50);
  });
});

// V1 fix (Opus eyes-on review, 2026-09-24): "the walrus model view sits under the legend chip and
// the sheet" -- the species camera's LIVE re-fit padding (Shell.svelte's `currentChromePadding`,
// which the species lens' `applyCamera` now reads instead of a flat 40px). Unlike phonePadding/
// phonePaddingFromMeasured above (called ONCE, before Sheet.svelte mounts), this runs on every
// species-change/zoomToLayer re-fit, so it must react to whatever the sheet/chip are doing RIGHT
// NOW.
describe("phoneLiveChromePadding (V1 fix: the species camera pads for the sheet + chip)", () => {
  it("uses the MEASURED sheet height once one is reported (> 0), not the estimate", () => {
    const measured = phoneLiveChromePadding(388, "half", 844, false);
    expect(measured).toEqual(phonePaddingFromMeasured(388));
  });

  it("falls back to the ESTIMATE while no measurement has landed yet (height 0)", () => {
    const estimate = phoneLiveChromePadding(0, "half", 844, false);
    expect(estimate).toEqual(phonePadding("half", 844));
  });

  it("adds the legend chip's own height on top of the sheet's when the chip is floating", () => {
    const withoutChip = phoneLiveChromePadding(388, "half", 844, false);
    const withChip = phoneLiveChromePadding(388, "half", 844, true);
    expect(withChip.bottom).toBe(withoutChip.bottom + LEGEND_CHIP_HEIGHT_PX);
    // only `bottom` changes -- the chip floats over the map, not to either side or the top.
    expect(withChip.top).toBe(withoutChip.top);
    expect(withChip.left).toBe(withoutChip.left);
    expect(withChip.right).toBe(withoutChip.right);
  });

  it("never adds the chip's height when it is not showing, regardless of the flag's own name implying otherwise is wrong", () => {
    expect(phoneLiveChromePadding(388, "half", 844, false).bottom).toBe(
      phonePaddingFromMeasured(388).bottom,
    );
  });

  it("a taller reserved bottom (sheet + chip together) is never smaller than either alone", () => {
    const sheetOnly = phoneLiveChromePadding(500, "full", 844, false);
    const withChip = phoneLiveChromePadding(500, "full", 844, true);
    expect(withChip.bottom).toBeGreaterThan(sheetOnly.bottom);
  });
});
