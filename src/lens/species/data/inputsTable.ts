// owner review item 7 (Ben, live 0.10.62): the species lens' "Table" rail tool showed
// TOOL_BODY.table's placeholder ("The species and zone tables arrive in a later phase.") for
// every species -- never a real table, even though the SAME per-input data (name, dataset,
// representation, availability/struck-through reason) already renders as PILLS in the species
// panel's own layer bar (`layerBar.ts#layerBar()`, `LayerBarView.svelte`). This module reshapes
// that SAME `LayerBar` (no new data source, no second fetch) into table rows; the view
// (`../SpeciesInputsTable.svelte`) only renders them.
import type { LayerBar, LayerPill } from "./layerBar";

export interface InputsTableRow {
  /** `LayerPill.key` -- `"merged"` or the input's `ds_key`, a stable row id. */
  key: string;
  /** the input's own display name (`LayerPill.label` -- `datasetLabel()`'s resolved name). */
  input: string;
  /** the raw `ds_key` (e.g. `am`, `ax`, `ms_merge`) -- distinct from `input` above, the same two
   * columns "input name" vs "dataset" the owner review asked for. */
  dataset: string;
  /** every representation this input actually publishes an asset for (`"native"`, `"model"`),
   * comma-joined in the order they appear; `"—"` when the input has no published surface at all
   * (never an empty string, which would render as a blank cell indistinguishable from a data gap). */
  representation: string;
  /** `LayerPill.hasSurface` -- false = this input fed the merge but this release has no raster
   * registered for it (the SAME struck-through pill state). */
  available: boolean;
  /** `LayerPill.tooltip` -- the reason shown for a struck-through row; `null` when `available`. */
  reason: string | null;
}

function representationLabel(pill: LayerPill): string {
  const reps: string[] = [];
  for (const a of pill.assets) if (!reps.includes(a.rep)) reps.push(a.rep);
  return reps.length ? reps.join(", ") : "—";
}

/** one row per `LayerBar.pills` entry (the merged model first, by construction), in the SAME order
 * the layer bar already shows them. `[]` for `bar: null` (nothing selected/loaded yet) -- the view
 * says so plainly rather than rendering an empty table. */
export function inputsTableRows(bar: LayerBar | null): InputsTableRow[] {
  if (!bar) return [];
  return bar.pills.map((p) => ({
    key: p.key,
    input: p.label,
    dataset: p.dsKey,
    representation: representationLabel(p),
    available: p.hasSurface,
    reason: p.tooltip,
  }));
}
