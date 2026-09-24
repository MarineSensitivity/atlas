// usability M4: how much of the viewport the shell's own chrome (the docked panel, the phone
// sheet, the bottom tab bar) reserves at FIRST PAINT, before the user has touched anything -- pure
// so `paddedStudyAreaCenter` (camera.ts) can be fed a plain number without a browser. Shell.svelte
// calls this once, synchronously, before constructing the map (reading the SAME localStorage keys
// Panel.svelte/Sheet.svelte themselves read, via panelGeometry.ts/sheetGeometry.ts) -- it never
// reads the DOM, so it works before either component has mounted.
import type { ChromePadding } from "./camera";
import { NO_PADDING } from "./camera";
import type { PanelGeometry } from "../ui/panelGeometry";
import type { SheetDetent } from "../ui/sheetGeometry";

/** the rail's own reserved row on the phone (shell.css's `--size-rail-row`), approximated in px --
 * this is a chrome ESTIMATE for the very first camera, not a pixel-exact layout value (the real
 * rail height comes from tokens this module does not import, to stay a plain, browser-free
 * function); a few px of slack here costs nothing but a slightly-off initial pan, never a wrong
 * one, and the user's own subsequent pan/zoom (URL state) takes over immediately. */
const PHONE_RAIL_ROW_PX = 64;

/** desktop: the docked panel's own reservation, or none if collapsed/maximized (a maximized panel
 * covers the whole stage -- there is no "visible remainder" left to frame a study area within, so
 * this returns no padding rather than a nonsensical one covering everything). */
export function desktopPanelPadding(geometry: PanelGeometry): ChromePadding {
  if (geometry.collapsed || geometry.maximized) return NO_PADDING;
  switch (geometry.dock) {
    case "left":
      return { ...NO_PADDING, left: geometry.size };
    case "bottom":
      return { ...NO_PADDING, bottom: geometry.size };
    default:
      return { ...NO_PADDING, right: geometry.size };
  }
}

/** phone: the sheet's own height at its current detent, plus the bottom tab bar it sits above.
 * `peek`/`half` are approximated from `tokens.css`'s own constants (`--size-sheet-peek`: 96px,
 * `--size-sheet-half`: 46svh); `full` reserves the same fraction "half" does, capped, rather than
 * the true near-100% height -- a study area padded almost to the top edge is a worse first view
 * than one that keeps a sensible margin, and a user who chose "full" is about to look at the sheet,
 * not the map, anyway. */
export function phonePadding(detent: SheetDetent, viewportHeightPx: number): ChromePadding {
  const railRow = PHONE_RAIL_ROW_PX;
  if (detent === "peek") return { ...NO_PADDING, bottom: 96 + railRow };
  const halfPx = viewportHeightPx * 0.46;
  return { ...NO_PADDING, bottom: Math.round(halfPx) + railRow };
}
