// The species lens' data layer, part 6: the species card (§7.3) and the document title (§5.5), as
// data. No HTML is built here — the UI half renders this view model, and the test asserts it.
//
// THE THREE RULES §7.3 HIDES:
//  1. `hasIucn` (the taxon has an `rng_iucn` input) drives BOTH the "(IUCN masked)" suffix on the
//     merged node AND whether the Mask section exists at all.
//  2. The Values tree lists EVERY input present for the taxon (masks included — they constrain the
//     value, so they are part of how it was computed); the Mask section then repeats the mask subset
//     with `(required)` on `rng_iucn`. That duplication is deliberate in the source app.
//  3. A single value model and no IUCN range collapses the tree to ONE flat entry — no merged node,
//     no "(maximum of):" line.
//
// Outbound links: WoRMS only, and only when `taxon_authority == "worms"` (a BirdLife `botw` id is
// not an AphiaID and the link would 404).
import { categoryLabel } from "../../../lib/ui/categories";
import { datasetLabel, type DatasetIndex } from "./layerBar";
import { MERGED_IN } from "./resolve";
import { MERGED_DS_KEY, type TaxonCard } from "./shards";

/** the `ds_key` whose presence means "this taxon's extent is masked by the IUCN range". */
export const IUCN_DS_KEY = "rng_iucn";

export interface CardFact {
  label: string;
  value: string;
  /** set only for the WoRMS row. */
  href?: string;
}

export interface ValueNode {
  /** the `in` value clicking this node selects. */
  key: string;
  label: string;
  /** the italic `({value_info})` line, when the dataset publishes one. */
  info: string | null;
  /** the layer on screen renders bold (§7.3's `make_link`). */
  active: boolean;
  /** an input with no published surface is plain text + "(no published surface)", never a link. */
  hasSurface: boolean;
  /** `(required)`, on `rng_iucn` in the Mask section. */
  required?: boolean;
  children?: ValueNode[];
}

export interface SpeciesCard {
  sci: string;
  facts: CardFact[];
  /** `"Values"` tree: one flat node, or the merged node with its inputs beneath. */
  values: ValueNode[];
  /** the merged node's suffix when an IUCN range masks the extent. */
  iucnMasked: boolean;
  /** `null` when the taxon has no IUCN range (§7.3: the section then does not exist). */
  mask: ValueNode[] | null;
  /** §6.2 step 2: shown instead of a surface when the release publishes none for this taxon. */
  noSurfaceNotice: string | null;
}

/** the text a taxon with `merged: null` gets (§6.2 step 8, app.R:2014) — production's own wording. */
export function noSurfaceNotice(ver: string): string {
  return `No surface published for this taxon in ${ver}`;
}

/**
 * `ESA Listing`: `{code} ({SOURCE})` with the `ch_` prefix dropped and the source upper-cased
 * (app.R:1683-1687). Two deliberate differences from R, both because the R form leaks an R literal
 * into the UI:
 *   - no code at all -> `"NA"` in R; here the row is simply omitted (see {@link speciesCard}).
 *   - a code with NO source -> `"FWS:EN (NA)"` in R (every v8/v9 taxon has a null `esa_source`);
 *     here the parenthetical is dropped. Pinned by a named test.
 */
export function esaListing(code: string | null, source: string | null): string | null {
  if (!code) return null;
  if (!source) return code;
  return `${code} (${source.replace(/^ch_/, "").toUpperCase()})`;
}

/** the WoRMS taxon page, or null when the authority is not WoRMS (§7.3). */
export function wormsUrl(authority: string | null, taxonId: string | null): string | null {
  if (authority !== "worms" || !taxonId) return null;
  return `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${taxonId}`;
}

export interface CardOptions {
  ver: string;
  /** the layer on screen: `"merged"` or a `ds_key`. */
  selectedInput: string;
  datasets: DatasetIndex;
}

function valueNode(
  card: TaxonCard,
  dsKey: string,
  opts: CardOptions,
  kind: "value" | "mask",
): ValueNode {
  const input = card.inputs.find((i) => i.dsKey === dsKey);
  const label = datasetLabel(opts.datasets, dsKey);
  return {
    key: dsKey,
    label,
    // the italic line is emitted for VALUE entries only (`make_link(type = "value")`)
    info: kind === "value" ? (opts.datasets.get(dsKey)?.valueInfo ?? null) : null,
    active: opts.selectedInput === dsKey,
    hasSurface: (input?.assets.length ?? 0) > 0,
    ...(kind === "mask" && dsKey === IUCN_DS_KEY ? { required: true } : {}),
  };
}

/** §7.3's view model. */
export function speciesCard(card: TaxonCard, opts: CardOptions): SpeciesCard {
  const hasIucn = card.inputs.some((i) => i.dsKey === IUCN_DS_KEY);
  const facts: CardFact[] = [];
  if (card.common) facts.push({ label: "Common name", value: card.common });
  // P round V5 fix (Opus eyes-on: desktop-17/18 "Category: turtle"/"mammal" lowercase in the
  // species lens sidebar) -- the DISPLAY value goes through categoryLabel(); card.spCat itself
  // (used elsewhere for filtering/matching) stays the raw taxonomy string.
  facts.push({ label: "Category", value: categoryLabel(card.spCat) });
  const esa = esaListing(card.esa?.code ?? null, card.esa?.source ?? null);
  if (esa) facts.push({ label: "ESA Listing", value: esa });
  if (card.rl) facts.push({ label: "IUCN RedList", value: card.rl });
  const worms = wormsUrl(card.taxonAuthority, card.taxonId);
  if (worms && card.taxonId) facts.push({ label: "WoRMS", value: card.taxonId, href: worms });
  if (card.mmpa === true) facts.push({ label: "MMPA", value: "Protected (20)" });
  if (card.mbta === true) facts.push({ label: "MBTA", value: "Protected (10)" });

  const valueKeys = card.inputs.map((i) => i.dsKey);
  const children = valueKeys.map((k) => valueNode(card, k, opts, "value"));

  let values: ValueNode[];
  if (valueKeys.length === 1 && !hasIucn) {
    // single model, no merge to explain (§7.3's first branch)
    values = children;
  } else {
    values = [
      {
        key: MERGED_IN,
        label: datasetLabel(opts.datasets, MERGED_DS_KEY) + (hasIucn ? " (IUCN masked)" : ""),
        info: null,
        active: opts.selectedInput === MERGED_IN,
        hasSurface: card.merged !== null,
        children,
      },
    ];
  }

  const mask = hasIucn
    ? card.inputs
        .filter((i) => i.isMask || opts.datasets.get(i.dsKey)?.isMask === true)
        .map((i) => valueNode(card, i.dsKey, opts, "mask"))
    : null;

  return {
    sci: card.sci,
    facts,
    values,
    iucnMasked: hasIucn,
    mask,
    noSurfaceNotice: card.merged === null ? noSurfaceNotice(opts.ver) : null,
  };
}

/**
 * The browser/document title (atlas-5 plan line; §5.5 / §6.2 step 4):
 *   `"{sci} distribution ({cat}[: {common}]; {key}) from {layer} | Marine Sensitivity"`
 * The old app wrote `mdl_key: {key}` and `| BOEM Marine Sensitivity`; the atlas plan's line is the
 * one implemented here, and `{key}` is the id of the LAYER ON SCREEN, not just the taxon.
 */
export function documentTitle(
  card: TaxonCard,
  opts: { selectedInput: string; datasets: DatasetIndex },
): string {
  const merged = opts.selectedInput === MERGED_IN;
  const input = merged ? null : card.inputs.find((i) => i.dsKey === opts.selectedInput);
  const key = merged ? card.key : (input?.mdlKey ?? card.key);
  const layer = datasetLabel(opts.datasets, merged ? MERGED_DS_KEY : opts.selectedInput);
  const cat = card.common ? `${card.spCat}: ${card.common}` : card.spCat;
  return `${card.sci} distribution (${cat}; ${key}) from ${layer} | Marine Sensitivity`;
}
