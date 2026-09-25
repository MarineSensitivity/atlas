// owner review item 7 (Ben, live 0.10.62): the species lens' "Table" rail tool showed
// TOOL_BODY.table's placeholder ("The species and zone tables arrive in a later phase.") for
// every species -- never a real table, even though the SAME per-input data (name, dataset,
// representation, availability/struck-through reason) already renders as PILLS in the species
// panel's own layer bar (`layerBar.ts#layerBar()`, `LayerBarView.svelte`). This module reshapes
// that SAME `LayerBar` (no new data source, no second fetch) into table rows; the view
// (`../SpeciesInputsTable.svelte`) only renders them.
import { datasetLabel, type DatasetIndex, type LayerBar, type LayerPill } from "./layerBar";

export interface InputsTableRow {
  /** `LayerPill.key` -- `"merged"` or the input's `ds_key`, a stable row id. */
  key: string;
  /** the input's own display name (`LayerPill.label` -- `datasetLabel()`'s resolved name). */
  input: string;
  /** UI-9 (round-3 review): the dataset's own NAME (`datasetLabel()`, `datasets.json`'s resolved
   * name -- "AquaMaps", not "am") -- a NOAA reviewer does not recognize a raw `ds_key`
   * ("ms_merge", "am_0.05", "rng_iucn"). Falls back to the bare key only when `datasets` has no
   * entry for it (the SAME fallback `datasetLabel()` itself applies). */
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
 * says so plainly rather than rendering an empty table.
 *
 * `datasets`, when a caller has it, is the SAME `DatasetIndex` the card/layer bar already resolved
 * names from (no second fetch) -- resolved via `datasetLabel()`. When omitted (this component's
 * REAL mount, `Shell.svelte`, does not thread one through today), `dataset` falls back to `p.label`
 * -- the pill's OWN already-resolved name (`layerBar()` itself called `datasetLabel()` to build it)
 * -- rather than the raw `ds_key`, which is UI-9's actual fix: a NOAA reviewer does not recognize
 * "ms_merge"/"am_0.05"/"rng_iucn". */
export function inputsTableRows(bar: LayerBar | null, datasets?: DatasetIndex): InputsTableRow[] {
  if (!bar) return [];
  return bar.pills.map((p) => ({
    key: p.key,
    input: p.label,
    dataset: datasets ? datasetLabel(datasets, p.dsKey) : p.label,
    representation: representationLabel(p),
    available: p.hasSurface,
    reason: p.tooltip,
  }));
}
