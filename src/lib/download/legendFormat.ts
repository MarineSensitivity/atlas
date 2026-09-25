// R3-W2: the Download menu's legend-endpoint formatter -- matches what the LIVE legend chip
// already shows (never a second `.toFixed(2)` guess, which prints "0.00"/"93.00" where the chip
// reads "0"/"93"). This DUPLICATES `lens/scores/mapInputs.ts#formatScoresLegendValue` (`String(value)`
// -- endpoints are already rounded upstream, `signif3`/`round(range,1)`) and
// `lens/species/mapInputs.ts#formatSpeciesLegendValue` (`String(Math.round(value))`) rather than
// importing either: `lens/scores/mapInputs.ts` is Shell.svelte's own LAZY chunk (state.svelte.ts's
// header: "it pulls in mapInputs.ts/boot.ts/raster.ts/zoneFill.ts ... that weight must stay out of
// a species-only session's bundle") -- a static import here would re-introduce exactly the bundle
// weight DownloadMenu.svelte's own lazy split (this round) exists to avoid. Both source functions
// are one-liners; this is the cheaper place for that fact to live twice, not a real duplication of
// logic that could drift silently (a rounding-rule change to either is a one-line diff to re-mirror).
import type { DownloadLens } from "./items";

export function legendValueFormatter(lens: DownloadLens): (value: number) => string {
  return lens === "species" ? (v) => String(Math.round(v)) : (v) => String(v);
}
