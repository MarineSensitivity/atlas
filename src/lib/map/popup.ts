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
    maxWidth: "260px",
    ...rest,
    className: [POPUP_CLASS_NAME, className].filter(Boolean).join(" "),
  });
}
