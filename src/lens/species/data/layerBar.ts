// The species lens' data layer, part 5: the layer bar, as data.
//
// One pill per input plus the merged model, in `dataset.sort_order` (`atlas-refs/"parity species
// app.md"` §7.2). Three things here are load-bearing and each has its own test:
//
//  1. `nInputs` is counted from the shard's INPUT EDGES, never from a `n_datasets` column (§11.5).
//     `[[` on an R `table` ERRORS for an absent key, so the old guard never ran and the layer bar
//     died on every v1 taxon whose only model is its merged model. A single-input taxon yields 1.
//  2. An input the merge used but this release publishes no surface for is still SHOWN — struck
//     through, disabled, with the title that says why. It contributed to the value on screen; hiding
//     it would misrepresent the merge. Every v1-v7 input is in this state.
//  3. Every asset's `rescale` is passed through VERBATIM (AquaX delivered is 0-1000, everything else
//     1-100). A default here silently recolors a raster.
import { MERGED_DS_KEY, type TaxonAsset, type TaxonCard } from "./shards";
import { MERGED_IN } from "./resolve";

// ---- boot.datasets ------------------------------------------------------------------------------

export interface DatasetMeta {
  dsKey: string;
  /** `null` on v1-v2, where the registry has no display names: the `ds_key` is then the label. */
  nameDisplay: string | null;
  /** the italic line under an input in the card's Values tree (§7.3). */
  valueInfo: string | null;
  isMask: boolean;
  /** AquaX (v9) is already on the 0.05 deg grid, which is what relabels the representation toggle. */
  onGrid: boolean;
  /** `null` sorts last (v9's `dps_nmfs`, every v1 dataset). */
  sortOrder: number | null;
}

export type DatasetIndex = Map<string, DatasetMeta>;

/** `boot.datasets` (an array) -> a lookup. Unknown/malformed rows are skipped rather than throwing:
 * a missing dataset row degrades to "label = ds_key", which is legible, not broken. */
export function datasetIndex(raw: unknown): DatasetIndex {
  const out: DatasetIndex = new Map();
  if (!Array.isArray(raw)) return out;
  for (const row of raw) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.ds_key !== "string") continue;
    out.set(r.ds_key, {
      dsKey: r.ds_key,
      nameDisplay: typeof r.name_display === "string" ? r.name_display : null,
      valueInfo: typeof r.value_info === "string" ? r.value_info : null,
      isMask: r.is_mask === true,
      onGrid: r.on_grid === true,
      sortOrder: typeof r.sort_order === "number" ? r.sort_order : null,
    });
  }
  return out;
}

/** what the merged model is called when the registry does not name it (v1-v2 publish
 * `name_display: null` for every dataset, including `ms_merge`). */
export const MERGED_LABEL = "Merged Model";

/** the label for a `ds_key`: `dataset.name_display`, else the key itself — except the merged model,
 * which always has a name because the whole bar is built around it. */
export function datasetLabel(datasets: DatasetIndex, dsKey: string): string {
  const name = datasets.get(dsKey)?.nameDisplay;
  if (name) return name;
  return dsKey === MERGED_DS_KEY ? MERGED_LABEL : dsKey;
}

// ---- the representation toggle (§7.2) -----------------------------------------------------------

export interface RepresentationOption {
  /** the `rep` value in the URL and in the asset list. */
  value: "native" | "model";
  label: string;
  tooltip: string;
}

/** all FOUR tooltips, both label sets, in one table — `dataset.on_grid` picks the row. */
export const REPRESENTATION_LABELS: Record<
  "offGrid" | "onGrid",
  [RepresentationOption, RepresentationOption]
> = {
  offGrid: [
    { value: "native", label: "Original", tooltip: "the source SDM at its native resolution" },
    { value: "model", label: "Interpolated", tooltip: "resampled to the 0.05° scoring grid" },
  ],
  onGrid: [
    {
      value: "native",
      label: "Delivered",
      tooltip: "the band exactly as delivered (already on the 0.05° grid)",
    },
    {
      value: "model",
      label: "As ingested",
      tooltip:
        "as ingested: rescaled to 1–100 with the ingest threshold applied — what the merge uses",
    },
  ],
};

export interface RepresentationToggle {
  /** only when the selected input publishes BOTH representations (§7.2). */
  available: boolean;
  options: [RepresentationOption, RepresentationOption];
}

// ---- pills --------------------------------------------------------------------------------------

export interface LayerPill {
  /** the `in` value this pill selects: `"merged"` or the input's `ds_key`. */
  key: string;
  dsKey: string;
  /** the model id behind it (the merged key, or the input's `mdl_key`). */
  mdlKey: string;
  label: string;
  /** false = this input fed the merge but has no published surface in this release. */
  hasSurface: boolean;
  /** the struck-through pill's `title`; `null` when the pill is drawable. */
  tooltip: string | null;
  active: boolean;
  isMask: boolean;
  /** VERBATIM, for the map module's raster builder (url, type, rescale, colormap, source layer). */
  assets: TaxonAsset[];
}

export interface LayerBar {
  /** `is-merged` (green) or `is-input` (orange) — §7.2. */
  variant: "merged" | "input";
  /** count of the shard's input edges. ALWAYS a number, 1 for a single-input taxon (§11.5). */
  nInputs: number;
  /** `"Merged Model (maximum of {n} inputs)"`, or `"Merged Model"` when n <= 1 (§7.2: the note only
   * appears above one input). */
  mergedLabel: string;
  /** the bar's left-hand text: the merged label, or `"Viewing input: {name}"`. */
  title: string;
  /** shown beside an input's title (§7.2). */
  showMergedLink: boolean;
  pills: LayerPill[];
  representation: RepresentationToggle;
  /** the phone fold: `"{N} layers"` (§5.6). */
  mobileToggleLabel: string;
}

/** §7.2's title for an input with nothing to draw.
 * V4 fix (owner phone report, 2026-09-24, docs fact-check item 1): "publishes no surface for it"
 * was the wrong explanation (Ben's own correction) -- an input's raster is found through the
 * release's model-asset registry BY MODEL KEY, the same way the Species Shiny app looks it up, so
 * a struck-through pill means no REGISTRY ROW for that model, not that the release chose not to
 * publish one. */
export function noSurfaceTooltip(label: string, ver: string): string {
  return `${label} feeds the merged model, but ${ver} has no raster registered for this model (the Species app shows it the same way)`;
}

/** sort_order asc, nulls last, then ds_key — one comparator so pills and the card's Values tree
 * agree on the order. The merged model sorts first by construction (its own `sort_order` is 0 or 1
 * in every published release, and it is prepended when the registry has no row for it at all). */
export function compareDs(datasets: DatasetIndex, a: string, b: string): number {
  if (a === b) return 0;
  if (a === MERGED_DS_KEY) return -1;
  if (b === MERGED_DS_KEY) return 1;
  const sa = datasets.get(a)?.sortOrder ?? null;
  const sb = datasets.get(b)?.sortOrder ?? null;
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa - sb;
  }
  return a < b ? -1 : 1;
}

export interface LayerBarOptions {
  /** the release label, for the no-surface title. */
  ver: string;
  /** the layer on screen: `"merged"` or a `ds_key`. */
  selectedInput: string;
  datasets: DatasetIndex;
}

/**
 * The whole bar for one taxon, as data. The UI half renders it; this function owns every rule.
 */
export function layerBar(card: TaxonCard, opts: LayerBarOptions): LayerBar {
  const { ver, selectedInput, datasets } = opts;
  const nInputs = card.inputs.length;
  const mergedActive = selectedInput === MERGED_IN;

  const mergedPill: LayerPill = {
    key: MERGED_IN,
    dsKey: MERGED_DS_KEY,
    mdlKey: card.key,
    label: datasetLabel(datasets, MERGED_DS_KEY),
    hasSurface: card.merged !== null,
    tooltip: null,
    active: mergedActive,
    isMask: false,
    assets: card.merged
      ? [
          {
            rep: "native",
            type: card.merged.type,
            url: card.merged.url,
            rescale: card.merged.rescale,
            colormap: card.merged.colormap,
            sourceLayer: null,
            bbox: card.merged.bbox,
          },
        ]
      : [],
  };

  const inputPills: LayerPill[] = card.inputs.map((input) => {
    const label = datasetLabel(datasets, input.dsKey);
    const hasSurface = input.assets.length > 0;
    return {
      key: input.dsKey,
      dsKey: input.dsKey,
      mdlKey: input.mdlKey,
      label,
      hasSurface,
      tooltip: hasSurface ? null : noSurfaceTooltip(label, ver),
      active: selectedInput === input.dsKey,
      isMask: input.isMask || (datasets.get(input.dsKey)?.isMask ?? false),
      assets: input.assets,
    };
  });

  const pills = [mergedPill, ...inputPills].sort((a, b) => compareDs(datasets, a.dsKey, b.dsKey));

  const selected = inputPills.find((p) => p.active) ?? null;
  const reps = new Set(selected?.assets.map((a) => a.rep) ?? []);
  const onGrid = selected ? (datasets.get(selected.dsKey)?.onGrid ?? false) : false;
  const representation: RepresentationToggle = {
    available: reps.size > 1,
    options: REPRESENTATION_LABELS[onGrid ? "onGrid" : "offGrid"],
  };

  const mergedLabel =
    nInputs > 1 ? `${mergedPill.label} (maximum of ${nInputs} inputs)` : mergedPill.label;

  return {
    variant: mergedActive ? "merged" : "input",
    nInputs,
    mergedLabel,
    title: mergedActive ? mergedLabel : `Viewing input: ${selected?.label ?? selectedInput}`,
    showMergedLink: !mergedActive,
    pills,
    representation,
    mobileToggleLabel: `${pills.length} layers`,
  };
}
