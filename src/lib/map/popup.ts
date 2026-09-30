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

// --- Ben's ask (round-3 review, 2026-09-25): ONE colour-coded value popup, every lens -----------
//
// "make the map click popup more consistent across layers (scores raster or program area,
// species raster/vector). i like the color coding in the species popup, which could be added to
// scores layers". (R4-A, 2026-09-30: the histogram + marker line the same ask wanted now live in
// the legend, `lib/ui/Legend.svelte`, not here.) This is the ONE
// template every value-bearing popup renders through now: `lens/scores/popup.ts` (cell AND zone
// branches) and `lens/species/popup.ts` (the COG-value branch) all build a `ValuePopupContent`
// and hand it to `valuePopupHtml()` here — same paddings, same min-width (`createPopup()` above),
// same typography, same swatch markup, on every lens. A presence-only or no-value popup
// (a species range click, a click outside the scored area) still goes through this template with
// `swatchColor` set to what applies — never a hand-rolled second markup.
//
// Escaping: kept local rather than shared, matching this repo's existing convention
// (`lens/scores/popup.ts`'s own copy, `src/report/exportHtml.ts`'s independent copy) — a
// release-bundle string reaching this module is still untrusted TEXT, never markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** R4-B: the click popup states the value and LINKS to Details (control-grammar.md, "Data graphics
 * that belong to a layer"). The link is a plain button carrying this attribute; the popup is a
 * MapLibre-owned div outside Svelte, so Shell.svelte listens once on `document` for a click on
 * `[${DETAILS_LINK_ATTR}]` and opens the Details tool -- one delegated handler, never one per popup. */
export const DETAILS_LINK_ATTR = "data-atlas-open-details";

/** the link's markup, shared by the value popup below and the species popup
 * (`lens/species/popup.ts`) so the two can never disagree on the attribute. */
export function detailsLinkHtml(): string {
  return `<div class="atlas-popup-links"><button type="button" class="atlas-popup-link" ${DETAILS_LINK_ATTR}>Details</button></div>`;
}

export interface ValuePopupContent {
  /** UI-4's shared subject line (`lib/format.ts#formatSubject`), plain text. */
  subject: string;
  /** UI-4's shared value line (`lib/format.ts#formatValueLine`), e.g. "Score 44"/"Suitability 71",
   * or a plain status line ("No scored cell here", "presence only") when there is no numeric value. */
  valueLine: string;
  /** the ramp colour at this value (`raster/ramps.ts#colorForValue`/`binColor`) — `null` for "no
   * value"/loading, drawn as a neutral grey swatch instead of an invented colour. */
  swatchColor: string | null;
  textColor: "black" | "white" | null;
  /** small text under the value row: the layer/unit/dataset name (module header: "the layer/unit
   * name in small text"). `null`/omitted renders no third line. */
  unitLabel?: string | null;
  /** R4-B: add the "Details" link (only when there is a subject to show details for). */
  detailsLink?: boolean;
}

/**
 * The whole value popup, as HTML — the ONE template `lens/scores/popup.ts` and
 * `lens/species/popup.ts` both render through. `content.subject`/`valueLine`/`unitLabel` are
 * plain, UNESCAPED text (this function escapes them).
 */
export function valuePopupHtml(content: ValuePopupContent): string {
  const swatchStyle =
    content.swatchColor === null
      ? // no ramp value to colour against (loading/no-value) — a named CSS colour, matching
        // `lens/species/popup.ts`'s own existing "grey" convention, never a hex literal
        // (`tests/raster/ramps.wiring.test.ts`'s scan for exactly that outside `ramps.ts`).
        "background:grey"
      : content.textColor === null
        ? `background:${escapeHtml(content.swatchColor)}`
        : `background:${escapeHtml(content.swatchColor)};color:${content.textColor}`;
  const unitLine = content.unitLabel
    ? `<div class="atlas-popup-unit">${escapeHtml(content.unitLabel)}</div>`
    : "";
  return (
    `<div class="atlas-popup-body">` +
    `<div class="atlas-popup-subject">${escapeHtml(content.subject)}</div>` +
    `<div class="atlas-popup-value-row">` +
    `<span class="atlas-popup-swatch" style="${swatchStyle}"></span>` +
    `<span class="atlas-popup-value">${escapeHtml(content.valueLine)}</span>` +
    `</div>` +
    unitLine +
    (content.detailsLink ? detailsLinkHtml() : "") +
    `</div>`
  );
}

/** the `announce()` counterpart of {@link valuePopupHtml} — plain text, no markup
 * (a live region reads text, not an SVG). Mirrors every other popup module's own
 * `*AnnounceText` sibling in this repo. */
export function valuePopupAnnounceText(content: ValuePopupContent): string {
  const unit = content.unitLabel ? `, ${content.unitLabel}` : "";
  return `${content.subject}: ${content.valueLine}${unit}`;
}
