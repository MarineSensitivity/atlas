// atlas-4 fix round 3 -- the scores lens' click popup. The owner's report: "the old Shiny app
// showed cell id, lon/lat and the scores on click" and this app showed nothing. The atlas-4
// subplan's Selection checklist: "Click a cell … show cell id, lon/lat (3 dp), the displayed
// layer's value"; the reference doc's §6.4 gives the zone-click text verbatim, "{name}:
// {round(value)}" -- `zoneFill.ts`'s `zoneTooltip()` already spells that exactly, written for a
// HOVER tooltip that was never wired to anything; this module wires the same text to a CLICK.
//
// Pure text builders only -- `ScoresLens.svelte` is the one caller that touches MapLibre, through
// the shared themed popup (`src/lib/map/popup.ts`). The cell branch's VALUE comes from
// `analysis/queries.ts#cellValue()` (the wide `cell` Parquet tile, plan D4): nothing here, or in
// its caller, ever reads a rendered raster pixel -- `tests/lens/scores/no-readpixels.test.ts` scans
// this whole directory for `readPixels` and fails if it ever appears.
import { roundHalfEven } from "../../lib/geo/round";
import type { ZoneRow } from "./boot";
import { zoneTooltip, zoneValuesFor } from "./zoneFill";

/** the four characters a boot-published label/name could carry into an `innerHTML` string -- a
 * release-bundle string is still untrusted TEXT, never markup (same rule as
 * `src/lens/species/popup.ts`'s own copy; kept local rather than shared, matching this repo's
 * existing convention of `src/report/exportHtml.ts`'s independent copy). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface CellPopupInput {
  cellId: number;
  lon: number;
  lat: number;
  /** the SHORT metric label (`boot.ts#metricLabelsFromManifest`, the manifest's own per-metric
   * name — U4/R3). D4 (Opus 5.5 eyes-on, 2026-09-24): this used to be `boot.layers[].label`, which
   * (per that reader's own doc) carries the LONG description text ("Primary productivity: Oregon
   * State Vertically Generalized Production Model (VGPM) from ... 2014 to 2023"), not a name fit
   * for a one-line popup. The caller (`state.svelte.ts#showCellPopup`) resolves the short label
   * with the manifest -> boot -> metric_key fallback chain `metricLabelsFromManifest`'s own header
   * describes; this module just renders whatever string it is handed. */
  layerLabel: string;
  /** `null` when the cell carries no row for this layer (off-grid, or unscored) -- `cellValue()`'s
   * own "no value" answer, never a guess. */
  value: number | null;
}

/**
 * "Cell {id} · lon {x.xxx}, lat {y.yyy} · {layer label}: {value}" (atlas-4 subplan's Selection
 * checklist, verbatim) for a SCORED cell. The value is `round(value, 2)`, matching the flower
 * panel's own per-component tooltip convention (atlas-4 subplan: `"{component}: {round(score,
 * 2)}"`) rather than inventing a THIRD rounding rule beside that one and the zone click's
 * `round(value)` (0 dp).
 *
 * D3 (Opus 5.5 eyes-on, 2026-09-24): a click OUTSIDE the scored area (`value === null` — off-grid,
 * unscored, e.g. land) instead reads a ONE-line "No scored cell here" + the coordinates ONLY —
 * never a cell id (a bare integer read as "the app found something here" — it did not) and never
 * the layer title (which used to blame the DATA: "{30-word description}: no value"). The owner's
 * report: Utah gave "Cell 2711027 · lon -113.526, lat 38.932 · {long title}: no value", six lines
 * once wrapped, for a click that landed nowhere the release scores at all.
 */
export function cellPopupText(input: CellPopupInput): string {
  if (input.value === null) return noScoredCellText(input);
  return formatCellPopup(input, escapeHtml(input.layerLabel));
}

/** D3: the no-value popup line, shared (HTML-safe as-is: only numbers are interpolated). */
function noScoredCellText(input: { lon: number; lat: number }): string {
  return `No scored cell here · lon ${input.lon.toFixed(3)}, lat ${input.lat.toFixed(3)}`;
}

/** shared by {@link cellPopupText} (HTML, `label` pre-escaped by the caller) and
 * {@link cellPopupAnnounceText} (plain text, `label` passed through verbatim). Only ever called
 * for a SCORED cell (`value !== null`) -- the no-value case is `noScoredCellText` above. */
function formatCellPopup(input: CellPopupInput, label: string): string {
  const lon = input.lon.toFixed(3);
  const lat = input.lat.toFixed(3);
  const value = String(roundHalfEven((input.value as number) * 100) / 100);
  return `Cell ${input.cellId} · lon ${lon}, lat ${lat} · ${label}: ${value}`;
}

/**
 * fix list #12 (SC 4.1.3): the `announce()` counterpart of {@link cellPopupText} -- the SAME
 * text, unescaped. `announce()` sets a live region's TEXT content (Svelte's `{message}`
 * interpolation, never `innerHTML`), so feeding it the HTML-escaped string would read "&amp;"
 * aloud as four literal characters instead of "&".
 */
export function cellPopupAnnounceText(input: CellPopupInput): string {
  if (input.value === null) return noScoredCellText(input);
  return formatCellPopup(input, input.layerLabel);
}

export interface CellPopupLoadingInput {
  cellId: number;
  lon: number;
  lat: number;
}

/**
 * usability M9: "a cold cell click gives no feedback... no popup appeared within 3.5s". The popup
 * now opens AT ONCE with this line (never waiting on the engine); {@link cellPopupText}/
 * {@link cellPopupAnnounceText} replace it once the value resolves. No markup to escape here (cell
 * id and lon/lat are both plain numbers), so one function covers the HTML and the announce text.
 */
export function cellPopupLoadingText(input: CellPopupLoadingInput): string {
  const lon = input.lon.toFixed(3);
  const lat = input.lat.toFixed(3);
  return `Cell ${input.cellId} · lon ${lon}, lat ${lat} · Loading value…`;
}

/**
 * "{name or key}: {round(value)}" -- parity doc §6.4's tooltip text, unchanged; this only resolves
 * WHICH `ZoneValue` (if any) the clicked zone/layer pair has. `zone.name` already carries the
 * "or key" fallback (`boot.ts#zoneRows`' `name ?? key`), so this module does not repeat that rule.
 */
export function zonePopupText(
  zones: readonly ZoneRow[],
  lyr: string | null,
  zone: { key: string; name: string },
): string {
  const value = lyr ? zoneValuesFor(zones, lyr).find((v) => v.key === zone.key) : undefined;
  return value ? escapeHtml(zoneTooltip(value)) : `${escapeHtml(zone.name)}: no value`;
}

/** fix list #12: the `announce()` counterpart of {@link zonePopupText} -- see
 * {@link cellPopupAnnounceText}'s header for why this is a separate, unescaped function rather
 * than reusing the HTML string. */
export function zonePopupAnnounceText(
  zones: readonly ZoneRow[],
  lyr: string | null,
  zone: { key: string; name: string },
): string {
  const value = lyr ? zoneValuesFor(zones, lyr).find((v) => v.key === zone.key) : undefined;
  return value ? zoneTooltip(value) : `${zone.name}: no value`;
}
