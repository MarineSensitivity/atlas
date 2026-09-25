// ONE themed maplibregl.Popup, shared by both lenses (the species click popup, `src/lens/species/
// state.svelte.ts`, and the scores lens' cell/zone click popup, `src/lens/scores/ScoresLens.svelte`).
//
// THE BUG (owner screenshot, fix round 3): MapLibre's own Popup is unthemed — a plain white box,
// regardless of `data-theme` — so the navy theme's light-on-dark text tokens painted white text on
// that white box; only the species value row stayed legible, because it sets its own inline
// background/color (src/lens/species/popup.ts's swatch, untouched by this file). Routing every
// popup construction through `createPopup()` means the fix (popup.css, scoped under the
// `atlas-popup` class below) cannot be forgotten at a second call site — there is only one.
import { Popup, type PopupOptions } from "maplibre-gl";
import "./popup.css";

/** every atlas popup carries this class; popup.css scopes its rules under it, and
 * `tests/map/popup.test.ts` asserts a caller can never construct one without it. */
export const POPUP_CLASS_NAME = "atlas-popup";

/**
 * A themed `maplibregl.Popup`. `options.className` (if given) is APPENDED to
 * {@link POPUP_CLASS_NAME}, never a replacement — so no caller can accidentally opt out of the
 * theming by passing its own `className`.
 */
export function createPopup(options: PopupOptions = {}): Popup {
  const { className, ...rest } = options;
  return new Popup({
    closeButton: true,
    closeOnClick: true,
    // R3-B3 (Opus eyes-on review, 2026-09-25, phone-06-flower-half): 260px was too narrow for a
    // cell popup's own text once it carries id + lon + lat + label + value ("Cell 3350704 · lon
    // -90.575, lat 28.625 · score: 44") -- measured: the string needs ~300px on one line at this
    // font-size, so 260px wrapped it with "44" stranded alone on its own line regardless of any
    // `min-width` on the content box (popup.css's own `min-width: 220px` floor helps a SHORTER
    // string that would otherwise auto-size narrower than that, but cannot widen a box already at
    // its ceiling). 320px is enough margin for this string with a shorter metric label; a release
    // whose label is longer still wraps, just not down to one bare trailing number.
    maxWidth: "320px",
    ...rest,
    className: [POPUP_CLASS_NAME, className].filter(Boolean).join(" "),
  });
}
