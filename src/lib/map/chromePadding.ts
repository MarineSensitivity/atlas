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

/** the desktop floating legend card's own approximate footprint (SpeciesLegend.svelte /
 * ScoresLegend.svelte: a 280px ramp plus its own padding, title and tick labels) -- the same
 * cheap, estimate-not-measured convention {@link LEGEND_CHIP_HEIGHT_PX} below already uses for the
 * phone's chip; a second real `ongeometry` wire for this card was not worth it either. */
export const DESKTOP_LEGEND_WIDTH_PX = 320;
export const DESKTOP_LEGEND_HEIGHT_PX = 140;

/** desktop: the top bar, plus the docked panel's own reservation (none if collapsed/maximized -- a
 * maximized panel covers the whole stage below the bar, so there is no "visible remainder" left to
 * frame a study area within beyond the bar itself), plus the floating legend card's own footprint
 * when the current lens is showing one.
 *
 * V4 fix (owner phone report, 2026-09-24, desktop-18): the walrus model view's south-west corner
 * sat under the legend card -- `desktopPanelPadding` reserved the DOCKED PANEL's side only, blind
 * to the legend card SpeciesLegend.svelte/ScoresLegend.svelte float into the opposite corner (or,
 * for a bottom-docked panel, just above it). The legend is hidden by the exact same
 * `data-panel-maximized="true"` CSS rule the `collapsed || maximized` guard above already
 * short-circuits on, so this never reserves space for a card that is not actually drawn.
 */
export function desktopPanelPadding(geometry: PanelGeometry, legendShowing = false): ChromePadding {
  const topbar = { ...NO_PADDING, top: TOPBAR_HEIGHT_PX };
  if (geometry.collapsed || geometry.maximized) return topbar;
  const legendW = legendShowing ? DESKTOP_LEGEND_WIDTH_PX : 0;
  const legendH = legendShowing ? DESKTOP_LEGEND_HEIGHT_PX : 0;
  switch (geometry.dock) {
    case "left":
      // the panel takes the left strip; the legend stays at its own BASE bottom-right corner (no
      // `data-panel-dock="left"` override moves it -- SpeciesLegend.svelte's own CSS).
      return { ...topbar, left: geometry.size, right: legendW, bottom: legendH };
    case "bottom":
      // the legend floats ABOVE the bottom-docked panel (its own `data-panel-dock="bottom"` rule),
      // so the reserved bottom strip is the panel's height plus the legend's.
      return { ...topbar, bottom: geometry.size + legendH };
    default:
      // dock="right" (the default, and the case desktop-18 actually measured): the legend moves to
      // bottom-LEFT to clear the panel (SpeciesLegend.svelte's `data-panel-dock="right"` rule).
      return { ...topbar, right: geometry.size, left: legendW, bottom: legendH };
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

/** the floating legend chip's own approximate height (`.legend-chip-region`, shell.css) -- the
 * same kind of cheap, estimate-not-measured slack {@link PHONE_RAIL_ROW_PX}/{@link
 * TOPBAR_HEIGHT_PX} already are; a second real `ongeometry` wire for a small pill was not worth
 * it (see {@link phoneLiveChromePadding}'s own header). */
export const LEGEND_CHIP_HEIGHT_PX = 56;

/**
 * V1 fix (Opus eyes-on review, 2026-09-24): "the walrus model view sits under the legend chip and
 * the sheet" -- the species camera's model-bounds fit (`state.svelte.ts#applyCamera`) used to pass
 * a flat `DEFAULT_CAMERA_PADDING` (40px, every edge) to `flyToBounds`, blind to the sheet (and,
 * when it floats, the legend chip above it) actually covering the bottom of the map RIGHT NOW.
 * This is the LIVE counterpart of {@link phonePadding}/{@link phonePaddingFromMeasured} above
 * (both of which only ever run ONCE, before Sheet.svelte has mounted, for the very first camera):
 * `sheetHeightPx > 0` once Sheet.svelte has reported its own real `ongeometry` measurement (the
 * same upgrade {@link phonePaddingFromMeasured} makes for the first-view camera), the estimate
 * (`phonePadding`) applies before that, and `chipShowing` adds the chip's own height on top when
 * `legendChipMode(detent) === "floating"` AND the lens actually has a legend to show (Shell.svelte
 * computes both -- this module never imports `sheetGeometry.ts` to stay dependency-light, so the
 * caller passes the already-resolved boolean).
 */
export function phoneLiveChromePadding(
  sheetHeightPx: number,
  detent: SheetDetent,
  viewportHeightPx: number,
  chipShowing: boolean,
): ChromePadding {
  const base =
    sheetHeightPx > 0
      ? phonePaddingFromMeasured(sheetHeightPx)
      : phonePadding(detent, viewportHeightPx);
  return chipShowing ? { ...base, bottom: base.bottom + LEGEND_CHIP_HEIGHT_PX } : base;
}
