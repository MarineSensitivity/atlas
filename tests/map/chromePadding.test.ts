import { describe, expect, it } from "vitest";
import {
  DESKTOP_LEGEND_HEIGHT_PX,
  desktopPanelPadding,
  FIT_GUTTER_PX,
  LEGEND_CHIP_HEIGHT_PX,
  phoneLiveChromePadding,
  phonePadding,
  phonePaddingFromMeasured,
  RAIL_FOOTPRINT_PX,
} from "../../src/lib/map/chromePadding";
import { DEFAULT_PANEL_GEOMETRY } from "../../src/lib/ui/panelGeometry";

// P2 (Opus 5.5 eyes-on, 2026-09-24): `top` used to be 0 in EVERY case below -- the top bar sits
// over the map on both platforms regardless of panel/sheet state, and was simply never accounted
// for, so the first-view shift only ever compensated for the panel/sheet. `TOPBAR_HEIGHT_PX` (48,
// `tokens.css`'s `--size-topbar`) is now reserved unconditionally by both functions.
const TOPBAR = 48;

// W5 fix (Opus 5.5 eyes-on review 5, 2026-09-25): the docked panel's own DOM footprint is
// `geometry.size` PLUS its outer CSS inset from the stage edge (shell.css's `.panel-region`,
// `--space-3`: 12px) PLUS the fit's own breathing gutter (`FIT_GUTTER_PX`) -- see
// `chromePadding.ts#desktopPanelPadding`'s own header for the desktop-19 measurement this fixes.
const PANEL_OUTER_INSET = 12;
// R4-B: the rail is attached to the panel's outer edge, so every dock-side reserve starts with it
// (72 px card + 8 px gap = RAIL_FOOTPRINT_PX); collapsed/full-stage still reserve the rail alone.
function panelReserve(size: number): number {
  return size + PANEL_OUTER_INSET + RAIL_FOOTPRINT_PX + FIT_GUTTER_PX;
}
const RAIL_ONLY = RAIL_FOOTPRINT_PX - 8 + PANEL_OUTER_INSET + FIT_GUTTER_PX;
const RIGHT = { ...DEFAULT_PANEL_GEOMETRY, dock: "right" } as const;

describe("desktopPanelPadding (usability M4, R4-B: rail + panel on the dock side)", () => {
  it("default geometry (dock LEFT, 380px, not collapsed) reserves the left edge (rail + panel + inset + gutter) and the top bar", () => {
    expect(DEFAULT_PANEL_GEOMETRY.dock).toBe("left");
    expect(desktopPanelPadding(DEFAULT_PANEL_GEOMETRY)).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: 0,
      left: panelReserve(380),
    });
  });

  it("dock right reserves the right edge (rail + panel + inset + gutter) and the top bar", () => {
    expect(desktopPanelPadding(RIGHT)).toEqual({
      top: TOPBAR,
      right: panelReserve(380),
      bottom: 0,
      left: 0,
    });
  });

  it("a resized panel reserves its OWN size (plus the fixed rail+inset+gutter), not the default", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, size: 600 }).left).toBe(
      panelReserve(600),
    );
  });

  // W5 fix regression (desktop-19/20/21, "GAA's east outline... under the panel's edge"): the old
  // `right: geometry.size` (380) left the panel's own outer inset (12px) AND the fit gutter
  // entirely uncounted. Named so this can never silently regress back to the bare `geometry.size`.
  // R4-B: the rail's footprint joins the same sum, on whichever side the panel is docked.
  it("W5 regression: the dock-side reserve clears the panel's real outer edge (rail + inset included), not just its content width", () => {
    const { left } = desktopPanelPadding(DEFAULT_PANEL_GEOMETRY);
    const panelOuterEdgeFromStageEdge =
      DEFAULT_PANEL_GEOMETRY.size + PANEL_OUTER_INSET + RAIL_FOOTPRINT_PX;
    expect(left).toBeGreaterThan(panelOuterEdgeFromStageEdge);
    const { right } = desktopPanelPadding(RIGHT);
    expect(right).toBeGreaterThan(panelOuterEdgeFromStageEdge);
  });

  it("collapsed still reserves the top bar and the rail (the pill is small; the rail stays)", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, collapsed: true })).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: 0,
      left: RAIL_ONLY,
    });
    expect(desktopPanelPadding({ ...RIGHT, collapsed: true }).right).toBe(RAIL_ONLY);
  });

  it("full stage (Table) reserves the top bar and the rail only -- no other 'visible remainder' to frame", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, maximized: true })).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: 0,
      left: RAIL_ONLY,
    });
  });

  // V4 fix (owner phone report, 2026-09-24, desktop-18): the legend card floats into the corner
  // OPPOSITE the panel; W5: only its own `bottom` height is reserved, never a side column.
  it("a legend showing at the default dock (left) reserves bottom (for the legend card), not a right column", () => {
    expect(desktopPanelPadding(DEFAULT_PANEL_GEOMETRY, true)).toEqual({
      top: TOPBAR,
      right: 0,
      bottom: DESKTOP_LEGEND_HEIGHT_PX,
      left: panelReserve(380),
    });
  });

  it("a legend showing with the panel docked right reserves bottom (for the legend card), not a left column", () => {
    expect(desktopPanelPadding(RIGHT, true)).toEqual({
      top: TOPBAR,
      right: panelReserve(380),
      bottom: DESKTOP_LEGEND_HEIGHT_PX,
      left: 0,
    });
  });

  it("no legend showing never reserves the legend's footprint, at any dock (the default, unchanged)", () => {
    expect(desktopPanelPadding(DEFAULT_PANEL_GEOMETRY, false)).toEqual(
      desktopPanelPadding(DEFAULT_PANEL_GEOMETRY),
    );
  });

  it("collapsed/full-stage never reserves the legend's footprint either (it is hidden by the same CSS rule)", () => {
    expect(desktopPanelPadding({ ...DEFAULT_PANEL_GEOMETRY, maximized: true }, true).bottom).toBe(
      0,
    );
  });
});

describe("phonePadding (usability M4)", () => {
  it("peek reserves a small, fixed bottom strip, and the top bar", () => {
    const p = phonePadding("peek", 844);
    expect(p.bottom).toBeGreaterThan(96); // the sheet's own peek height alone
    expect(p.top).toBe(TOPBAR);
    expect(p.left).toBe(FIT_GUTTER_PX);
    expect(p.right).toBe(FIT_GUTTER_PX);
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

  // W5 fix regression (phone-19/20/21, "GAA spans x 6-779 of 780... no side gutter"): `left`/
  // `right` used to be bare 0 (`NO_PADDING`), so a fitted zone's outline could touch the viewport
  // edge exactly. Named so a future edit cannot silently drop the gutter back to 0.
  it("W5 regression: every detent reserves a non-zero side gutter on both edges", () => {
    for (const detent of ["peek", "half", "full"] as const) {
      const p = phonePadding(detent, 844);
      expect(p.left).toBeGreaterThan(0);
      expect(p.right).toBeGreaterThan(0);
    }
  });
});

// P2 round 2 (orchestrator, real-build eyes-on, 2026-09-24): the re-fit's own padding source --
// Sheet.svelte's REAL measured `offsetHeight`, not the 46svh-derived ESTIMATE `phonePadding` above
// computes before the Sheet has ever mounted.
describe("phonePaddingFromMeasured (P2 round 2)", () => {
  it("reserves the top bar + the measured sheet height + the rail row, and a side gutter (W5 fix)", () => {
    const p = phonePaddingFromMeasured(388);
    expect(p.top).toBe(TOPBAR);
    expect(p.bottom).toBeGreaterThan(388); // the rail row is added on top of the measured height
    expect(p.left).toBe(FIT_GUTTER_PX);
    expect(p.right).toBe(FIT_GUTTER_PX);
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
