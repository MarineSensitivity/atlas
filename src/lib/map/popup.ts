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
import { densityCurve, densityPathD, markerX, type Histogram } from "./density";
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
// scores layers... it would be really awesome to have a sparkline style histogram showing the
// range of values and a vertical line where that given clicked element exists". This is the ONE
// template every value-bearing popup renders through now: `lens/scores/popup.ts` (cell AND zone
// branches) and `lens/species/popup.ts` (the COG-value branch) all build a `ValuePopupContent`
// and hand it to `valuePopupHtml()` here — same paddings, same min-width (`createPopup()` above),
// same typography, same swatch/sparkline markup, on every lens. A presence-only or no-value popup
// (a species range click, a click outside the scored area) still goes through this template with
// `swatchColor`/`sparkline` set to what applies — never a hand-rolled second markup.
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

/** one gradient stop, `offset` in `[0, 1]` — built from the SAME `boot.palettes` stops the legend
 * draws (`raster/ramps.ts`), never a second ramp (`popupSparkline()` below is the one place this
 * repo turns a `PaletteStops` array into a sparkline gradient). */
export interface SparklineGradientStop {
  offset: number;
  color: string;
}

/** the sparkline's own content — a closed density-area `d` (`lib/map/density.ts#densityPathD`), the
 * gradient it is filled with, the marker's x position, and the two end labels (already formatted
 * by the caller — this module does no rounding of its own). */
export interface SparklineContent {
  pathD: string;
  gradientStops: readonly SparklineGradientStop[];
  markerX: number;
  width: number;
  height: number;
  minLabel: string;
  maxLabel: string;
}

/** `null` — no sparkline for this popup (a vector/presence click, or a source with nothing to
 * plot); `"loading"` — the popup is open and a distribution fetch is in flight (module header:
 * "render the popup immediately, then fill the sparkline when its promise resolves"); a
 * {@link SparklineContent} — ready to draw. */
export type SparklineSlot = SparklineContent | "loading" | null;

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
  sparkline?: SparklineSlot;
}

const SPARKLINE_GRADIENT_ID = "atlas-popup-sparkline-gradient";

function sparklineSvg(s: SparklineContent): string {
  const stops = s.gradientStops
    .map((g) => `<stop offset="${g.offset}" stop-color="${escapeHtml(g.color)}"/>`)
    .join("");
  return (
    `<svg class="atlas-popup-sparkline-svg" width="${s.width}" height="${s.height}" ` +
    `viewBox="0 0 ${s.width} ${s.height}" role="img" ` +
    `aria-label="distribution, ${escapeHtml(s.minLabel)} to ${escapeHtml(s.maxLabel)}, clicked value marked">` +
    `<defs><linearGradient id="${SPARKLINE_GRADIENT_ID}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>` +
    `<path d="${s.pathD}" fill="url(#${SPARKLINE_GRADIENT_ID})" stroke="var(--text-secondary)" stroke-width="1"/>` +
    `<line x1="${s.markerX}" y1="0" x2="${s.markerX}" y2="${s.height}" stroke="var(--text-primary)" stroke-width="1.5"/>` +
    `</svg>` +
    `<div class="atlas-popup-sparkline-labels" aria-hidden="true">` +
    `<span>${escapeHtml(s.minLabel)}</span><span>${escapeHtml(s.maxLabel)}</span>` +
    `</div>`
  );
}

/** the sparkline block ALONE (module/skeleton/SVG), exported so a popup template that has not
 * (yet) adopted the whole {@link valuePopupHtml} shape can still append the SAME sparkline markup
 * — `lens/species/popup.ts`'s own template does exactly this, rather than re-deriving the
 * skeleton/SVG wrapper a second time. */
export function sparklineBlock(slot: SparklineSlot | undefined): string {
  if (!slot) return "";
  if (slot === "loading") {
    return `<div class="atlas-popup-sparkline atlas-popup-sparkline--loading" aria-hidden="true"></div>`;
  }
  return `<div class="atlas-popup-sparkline">${sparklineSvg(slot)}</div>`;
}

/**
 * The whole value popup, as HTML — the ONE template `lens/scores/popup.ts` and
 * `lens/species/popup.ts` both render through. `content.subject`/`valueLine`/`unitLabel` are
 * plain, UNESCAPED text (this function escapes them); `sparkline`'s labels are escaped by
 * {@link sparklineSvg} above.
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
    sparklineBlock(content.sparkline) +
    unitLine +
    `</div>`
  );
}

/** the `announce()` counterpart of {@link valuePopupHtml} — plain text, no markup, no sparkline
 * (a live region reads text, not an SVG). Mirrors every other popup module's own
 * `*AnnounceText` sibling in this repo. */
export function valuePopupAnnounceText(content: ValuePopupContent): string {
  const unit = content.unitLabel ? `, ${content.unitLabel}` : "";
  return `${content.subject}: ${content.valueLine}${unit}`;
}

/** builds a {@link SparklineContent} from a raw {@link Histogram} — `lib/map/density.ts`'s own
 * curve/path/marker math, plus the gradient stops from the SAME palette a caller's swatch color
 * came from (never a second ramp). `formatLabel` defaults to a bare rounded integer; a caller with
 * its own rounding convention (e.g. `formatValueLine`'s half-even) may pass one. */
export function popupSparkline(
  histogram: Histogram,
  value: number,
  paletteStops: readonly string[],
  opts: { width?: number; height?: number; formatLabel?: (v: number) => string } = {},
): SparklineContent {
  const width = opts.width ?? 120;
  const height = opts.height ?? 28;
  const formatLabel = opts.formatLabel ?? ((v: number) => String(Math.round(v)));
  const curve = densityCurve(histogram);
  const pathD = densityPathD(curve, width, height);
  const x = markerX(value, histogram.min, histogram.max, width);
  const n = paletteStops.length;
  const gradientStops: SparklineGradientStop[] = paletteStops.map((color, i) => ({
    offset: n <= 1 ? 0 : i / (n - 1),
    color,
  }));
  return {
    pathD,
    gradientStops,
    markerX: x,
    width,
    height,
    minLabel: formatLabel(histogram.min),
    maxLabel: formatLabel(histogram.max),
  };
}
