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

/** the top bar's own height (`tokens.css`'s `--size-topbar: 48px`, same estimate-not-import
 * convention as `PHONE_RAIL_ROW_PX` above) -- P2 (Opus 5.5 eyes-on, 2026-09-24): this was
 * previously NEVER reserved on either platform (`top` was always 0 out of both functions below),
 * so the first-view shift only ever compensated for the panel/sheet, never the bar sitting over
 * the map's own top edge. Present on BOTH desktop and phone (the topbar is the one piece of chrome
 * neither `desktopPanelPadding` nor `phonePadding` gate on any state -- it is always there). */
const TOPBAR_HEIGHT_PX = 48;

/** desktop: the top bar, plus the docked panel's own reservation (none if collapsed/maximized -- a
 * maximized panel covers the whole stage below the bar, so there is no "visible remainder" left to
 * frame a study area within beyond the bar itself). */
export function desktopPanelPadding(geometry: PanelGeometry): ChromePadding {
  const topbar = { ...NO_PADDING, top: TOPBAR_HEIGHT_PX };
  if (geometry.collapsed || geometry.maximized) return topbar;
  switch (geometry.dock) {
    case "left":
      return { ...topbar, left: geometry.size };
    case "bottom":
      return { ...topbar, bottom: geometry.size };
    default:
      return { ...topbar, right: geometry.size };
  }
}

/** phone: the top bar, plus the sheet's own height at its current detent and the bottom tab bar it
 * sits above. `peek`/`half` are approximated from `tokens.css`'s own constants (`--size-sheet-peek`:
 * 96px, `--size-sheet-half`: 46svh); `full` reserves the same fraction "half" does, capped, rather
 * than the true near-100% height -- a study area padded almost to the top edge is a worse first
 * view than one that keeps a sensible margin, and a user who chose "full" is about to look at the
 * sheet, not the map, anyway. */
export function phonePadding(detent: SheetDetent, viewportHeightPx: number): ChromePadding {
  const railRow = PHONE_RAIL_ROW_PX;
  const top = TOPBAR_HEIGHT_PX;
  if (detent === "peek") return { ...NO_PADDING, top, bottom: 96 + railRow };
  const halfPx = viewportHeightPx * 0.46;
  return { ...NO_PADDING, top, bottom: Math.round(halfPx) + railRow };
}

/** P2 round 2 (orchestrator, real-build eyes-on, 2026-09-24): {@link phonePadding} above is an
 * ESTIMATE (a fixed 46svh-derived fraction) because the ONE thing genuinely unavailable at map
 * construction time is Sheet.svelte's own real, MEASURED `offsetHeight`
 * (`sheetGeometry.ts`'s `SheetGeometry.height`, P1's own addition) -- the Sheet has not mounted
 * yet. `Shell.svelte` calls THIS function a second time, once, the first time `ongeometry` reports
 * a real height, and re-applies the initial fit with the accurate number ("the fit must use the
 * free area... at load time, not a constant" -- the orchestrator's own words). A minor accuracy
 * correction on its own (the estimate is usually within ~15px of the real height) -- it is
 * `PHONE_STUDY_AREA_ZOOM_BOOST` (camera.ts), applied at both the estimated and the re-fit call,
 * that actually fixes the framing. */
export function phonePaddingFromMeasured(sheetHeightPx: number): ChromePadding {
  return { ...NO_PADDING, top: TOPBAR_HEIGHT_PX, bottom: sheetHeightPx + PHONE_RAIL_ROW_PX };
}
