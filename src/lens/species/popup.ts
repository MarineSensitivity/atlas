// The species lens' UI half, part 2: the click popup, as data (§6.5). Pure — the click's own
// {lngLat, cellId} comes from `map/interaction.ts`'s `mapClick` (grid-aware arithmetic on the
// release's own `boot.grid`, never a hard-coded global05 constant); the sampled numeric value comes
// from a `ValueSource`
// (`src/lib/raster/point.ts`, `/cog/point`, plan D4). This module only turns those two things into
// what a popup renders — swatch color, text color, and the line of text.
//
// THE SWATCH RULE (§6.5 step 5): `val_scaled = clamp((val-1)/99, 0, 1)`, `col_idx =
// round(val_scaled*10)+1`, `bg_color = cols_r[col_idx]` — this is byte-for-byte
// `raster/ramps.ts`'s `binColor(stops, val, 1, 100)` (same half-even round, same 11-bin snap), so
// this module calls that rather than re-deriving the bin math a second time. It is generalized to
// the asset's OWN rescale range (not a hard-coded `1, 100`) so an AquaX "Delivered" click — whose
// raw band is `[0, 1000]`, not `[1, 100]` — still picks the correct bin instead of clamping every
// real value into the bottom two stops.
import { roundHalfEven } from "../../lib/geo/round";
import { RANGE_FILL_COLOR } from "../../lib/map/colors";
import { binColor, luminance, textColorFor, type PaletteStops } from "../../lib/raster/ramps";
import { sparklineBlock, type SparklineSlot } from "../../lib/map/popup";

// R3-W7 (round-3 review, Ben's "colour coding" ask): `luminance`/`textColorFor` moved to
// `raster/ramps.ts` (a ramp-adjacent color utility, shared with `lens/scores/popup.ts`'s own
// swatch) — re-exported here, unchanged, so this module's existing callers/tests need no update.
export { luminance, textColorFor };

/** R's `round(val, 3)` (half-to-even, same convention as `geo/round.ts` elsewhere in this repo). */
export function roundValue(value: number, decimals = 3): number {
  const f = 10 ** decimals;
  return roundHalfEven(value * f) / f;
}

export type PopupKind = "value" | "presence" | "no-value";

export interface PopupInput {
  sci: string;
  lon: number;
  lat: number;
  /** `null` when the click fell outside the release's grid (`mapClick`'s own `cellId: null`). */
  cellId: number | null;
  /** the layer sampled: a COG asset's own numeric value, a PMTiles range (presence only), or a COG
   * click that resolved to no value (a `/cog/point` `null`, e.g. a nodata pixel). */
  kind: PopupKind;
  /** required when `kind === "value"`: the sampled value and the bin range to color it against
   * (the asset's OWN rescale — see the module header on why this is not a hard-coded `[1,100]`). */
  value?: number;
  rescale?: readonly [number, number];
  /** `boot.palettes[colormap]` (`raster/ramps.ts`'s `paletteStopsFromBoot`). `null`/absent —
   * `boot.json` has not published palettes for this release yet — degrades to a neutral grey pin
   * with the value still shown as text: there is no second, hard-coded ramp anywhere in this repo
   * to fall back to (`tests/raster/ramps.wiring.test.ts`'s gate; `ramps.ts` itself asserts it holds
   * no hard-coded stops either — palette colors come from `boot.json` alone). */
  stops?: PaletteStops | null;
}

export interface PopupContent {
  kind: PopupKind;
  sci: string;
  lon: number;
  lat: number;
  cellId: number | null;
  /** the value line's rounded display value, or `null` for a presence/no-value popup. */
  displayValue: number | null;
  /** the marker/pin color: a data swatch for "value"/"presence", the CSS named color `"grey"` for
   * "no-value" — a named color, never a hex literal, is what keeps this file clear of
   * `tests/raster/ramps.wiring.test.ts`'s scan for a color this module does not actually own. */
  pinColor: string;
  /** `null` for the grey "no value" pin — there is no ramp value to contrast text against. */
  textColor: "black" | "white" | null;
  /** the popup's one line of state text (§6.5's `<i>no value here</i>`, and this app's own
   * "presence only" for a range click — ranges have no numeric value to show at all). */
  text: string;
}

/**
 * The whole popup, as data (§6.5 steps 4-6). A component renders this; nothing here touches the
 * DOM or MapLibre.
 */
export function popupContent(input: PopupInput): PopupContent {
  const base = { sci: input.sci, lon: input.lon, lat: input.lat, cellId: input.cellId };

  if (input.kind === "no-value") {
    return {
      ...base,
      kind: "no-value",
      displayValue: null,
      pinColor: "grey",
      textColor: null,
      // D3 fold-in (orchestrator round 2): same one-line rule the scores lens already got
      // (`lens/scores/popup.ts#noScoredCellText`) — "no value" reads as a lookup failure, not as
      // "you clicked outside where this model has data." `popupHtml`/`popupAnnounceText` below
      // also drop the Cell ID line for this kind, even when `cellId` resolved to a real grid cell.
      text: "No scored cell here",
    };
  }
  if (input.kind === "presence") {
    return {
      ...base,
      kind: "presence",
      displayValue: null,
      pinColor: RANGE_FILL_COLOR,
      textColor: textColorFor(RANGE_FILL_COLOR),
      text: "presence only",
    };
  }

  // "value": both `value` and `rescale` are required by the type, but a caller building this from
  // untyped data (e.g. relaying a worker message) could still omit them — fail to "No scored cell
  // here" rather than color a swatch with `undefined`.
  if (input.value === undefined || !input.rescale) {
    return {
      ...base,
      kind: "no-value",
      displayValue: null,
      pinColor: "grey",
      textColor: null,
      text: "No scored cell here",
    };
  }
  const displayValue = roundValue(input.value);
  // no boot.palettes yet (see the module header): show the value, but with no ramp to color a
  // swatch against — a grey pin rather than a guessed color.
  if (!input.stops) {
    return {
      ...base,
      kind: "value",
      displayValue,
      pinColor: "grey",
      textColor: null,
      text: `Value: ${displayValue}`,
    };
  }
  const [min, max] = input.rescale;
  const swatch = binColor(input.stops, input.value, min, max);
  return {
    ...base,
    kind: "value",
    displayValue,
    pinColor: swatch,
    textColor: textColorFor(swatch),
    text: `Value: ${displayValue}`,
  };
}

/** the four characters an interpolated species/place name could carry into an `innerHTML` string
 * (`popupHtml` below feeds a real MapLibre `Popup.setHTML`) — a name from a release bundle is
 * still untrusted TEXT, never markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The popup's HTML (§6.5 step 5's `<b>{sci}</b><br>Cell ID: {id}<br>Lon: {x}<br>Lat:
 * {y}<br>Value: {round(val,3)}`, adapted for the two atlas-only states "presence only" and "No
 * scored cell here"): a swatch square colored `pinColor`, text colored `textColor` when there is a
 * ramp value to contrast against. The caller hands this to a real `maplibregl.Popup#setHTML` —
 * this module still touches no DOM itself, only builds the string.
 *
 * D3 fold-in (orchestrator round 2, 2026-09-24): a `kind: "no-value"` popup omits the Cell ID line
 * entirely, even when `content.cellId` resolved to a real grid cell — showing an internal id next
 * to "no value" reads as a data/lookup bug, not as "this model has no data here" (the scores lens'
 * `noScoredCellText` fix, same rule).
 *
 * Ben's ask (round-3 review, 2026-09-25): `sparkline`, when given, appends the SAME distribution
 * sparkline markup the scores lens' popup renders (`lib/map/popup.ts#sparklineBlock` — one shared
 * skeleton/SVG builder, never a second one here). Only meaningful for `kind === "value"`: a
 * presence/no-value popup has no numeric value to plot a marker against, so a caller should not
 * pass one for those kinds (this function does not itself gate on `kind` — the caller already
 * knows whether it fetched a distribution for this click at all).
 */
export function popupHtml(content: PopupContent, sparkline?: SparklineSlot): string {
  const lon = content.lon.toFixed(3);
  const lat = content.lat.toFixed(3);
  const swatchStyle =
    content.textColor === null
      ? `background:${escapeHtml(content.pinColor)}`
      : `background:${escapeHtml(content.pinColor)};color:${content.textColor}`;
  const cellLine =
    content.kind === "no-value"
      ? ""
      : `Cell ID: ${content.cellId === null ? "—" : String(content.cellId)}<br>`;
  return (
    `<div class="species-popup">` +
    `<b><i>${escapeHtml(content.sci)}</i></b><br>` +
    cellLine +
    `Lon: ${lon}<br>` +
    `Lat: ${lat}<br>` +
    `<span class="species-popup-swatch" style="${swatchStyle}">${escapeHtml(content.text)}</span>` +
    sparklineBlock(sparkline) +
    `</div>`
  );
}

/**
 * fix list #12 (SC 4.1.3): the `announce()` counterpart of {@link popupHtml} -- a plain sentence,
 * not markup. `announce()` sets a live region's TEXT content (Svelte's `{message}` interpolation,
 * never `innerHTML`), so nothing here needs `escapeHtml` at all.
 *
 * D3 fold-in (orchestrator round 2): same cell-id omission as {@link popupHtml} for `kind:
 * "no-value"` — `content.text` is already "No scored cell here", so the cell/id clause is dropped
 * rather than prefixed onto it.
 */
export function popupAnnounceText(content: PopupContent): string {
  const lon = content.lon.toFixed(3);
  const lat = content.lat.toFixed(3);
  if (content.kind === "no-value") {
    return `${content.sci}: ${content.text}, lon ${lon}, lat ${lat}`;
  }
  const cell = content.cellId === null ? "no cell" : `cell ${content.cellId}`;
  return `${content.sci}: ${cell}, lon ${lon}, lat ${lat}, ${content.text}`;
}
