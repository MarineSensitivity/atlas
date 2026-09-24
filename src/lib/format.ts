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
