// atlas-4 fix round 2 -- the flower's own "one decimal everywhere a score is reported" rule. The
// reported defect (owner, 2026-09-24): the panel's summary sentence printed a raw IEEE double
// straight from the release's Parquet ("Bird 45.6671707107685, Coral 10.4494142116047, ..."). This
// is display-only formatting for the LIVE app (Flower.svelte's table/aria-label/summary, and the
// standalone report SVG's tooltip, `src/report/flowerSvg.ts`) -- distinct from
// `src/lib/report/format.ts`, which formats the EXPORTED docx/HTML report to ITS OWN spelled-out
// rule (0 dp, comma-grouped scores; see that file's own header). Nothing here ever feeds a number
// back into the model -- this only ever formats a value already computed elsewhere
// (`computeFlowerGeometry`'s clamped `score`).
const ONE_DP = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * A 0-100 score, rounded to exactly ONE decimal place: `45.6671707107685` -> `"45.7"`,
 * `10` -> `"10.0"` (never a bare `"10"` that could be mistaken for a different rounding rule
 * elsewhere on the same panel). Always uses `Intl.NumberFormat`'s round-half-to-even, applied
 * consistently everywhere a component score is reported (the summary sentence, the accessible
 * per-petal name, the "Show table" table, the report SVG's tooltip).
 */
export function formatScore(v: number): string {
  return ONE_DP.format(v);
}

// --- UI-4 (round-3 review): ONE subject line, ONE value line, everywhere a cell/zone is named ----
//
// The reported defect: the same cell read "Cell 3350704 · lon -90.550, lat 28.601 · score: 44" in
// the map popup, "Cell ID: 3350704 (x: -90.575, y: 28.625)" in the flower, "Species for Cell ID:
// 3350704" in the table, and "Cell ID: … / Lon: … / Lat: …" in the species popup — five spellings,
// five roundings (a raw click point vs. the cell CENTRE), for one thing. `formatSubject()` is the
// ONE place a `Subject` becomes display text now; the map popup (`lens/scores/popup.ts`,
// `lens/species/popup.ts`), the flower title (`lens/scores/flower.ts#flowerTitle`) and the species
// table header (`lens/scores/species.ts#speciesHeader`) all route through it.

/** what `formatSubject` names — a clicked cell (already resolved to its CENTRE, never the raw click
 * point — `cellRing()`'s own job), a selected zone, or nothing selected. */
export type Subject =
  | { kind: "cell"; cellId: number; lon: number; lat: number }
  | { kind: "zone"; name: string }
  | null;

/** `28.625° N, 90.575° W` — 3 dp, the sign folded into a compass letter (never a bare signed
 * number) so the popup/flower/table read the same way a mariner's own coordinate would. `0` reads
 * as `N`/`E` (no negative zero, no `S`/`W` for a value that is not actually south/west). */
export function formatLatLon(lat: number, lon: number): string {
  const ns = lat < 0 ? "S" : "N";
  const ew = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

/**
 * UI-4's one subject line: `"Cell 3350704 · 28.625° N, 90.575° W"` for a cell, the zone's own
 * (already-resolved, `paLabel`-formatted) name for a zone, and `"All US waters"` — UI-5's fix: the
 * no-selection subject now matches the Zoom-to-region select's OWN no-selection label, replacing
 * the flower's "Full study area" and the species table's "Full study area" wording, which named the
 * same thing two more ways.
 */
export function formatSubject(selection: Subject): string {
  if (!selection) return "All US waters";
  if (selection.kind === "cell") {
    return `Cell ${selection.cellId} · ${formatLatLon(selection.lat, selection.lon)}`;
  }
  return selection.name;
}

/**
 * UI-4's one value line: `"Score 44"` / `"Suitability 71"` — a label and a value, half-even rounded
 * to the nearest integer (matching the map popup's existing convention, `lens/scores/popup.ts`'s
 * old `formatCellPopup`), with an em dash for "no value" rather than a blank or a thrown error.
 */
export function formatValueLine(label: string, value: number | null): string {
  if (value === null) return `${label} —`;
  return `${label} ${Math.round(value)}`;
}
