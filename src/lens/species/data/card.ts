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

/** ESA status codes, mapped to a reviewer-legible label -- UI-9 (round-3 review): "ESA Listing:
 * FWS:LC" read as if LC were an ESA status (it is not one; the species is simply not listed), and
 * a non-null `esa.source` named the source TWICE ("NMFS:EN (NMFS)" -- once via the code's own
 * `{SOURCE}:{STATUS}` prefix, again via the appended source). Unrecognized codes fall back to the
 * bare code, never a blank label. */
const ESA_STATUS_LABELS: Readonly<Record<string, string>> = {
  EN: "Endangered",
  TN: "Threatened",
  LC: "Not listed",
};

export interface EsaListing {
  /** "Listed under the ESA" (+ the source, once, in parentheses, when the code carries one). */
  label: string;
  /** "{status label} ({code})" -- the code always kept, in parentheses, beside its label. */
  value: string;
}

/**
 * `card.esa.code` is `"{SOURCE}:{STATUS}"` (e.g. `"NMFS:EN"`, `"FWS:LC"`) -- the source lives in
 * the code ITSELF, so this reads it from there (never from the separate `esa.source` field, which
 * is the same source a second time on every taxon that has one -- the reported "names the source
 * twice" bug). `null` for no code at all (the row is simply omitted, see {@link speciesCard}).
 */
export function esaListing(code: string | null): EsaListing | null {
  if (!code) return null;
  const i = code.indexOf(":");
  const source = i === -1 ? null : code.slice(0, i);
  const status = i === -1 ? code : code.slice(i + 1);
  const statusLabel = ESA_STATUS_LABELS[status] ?? status;
  const value = statusLabel === status ? status : `${statusLabel} (${status})`;
  const label = source ? `Listed under the ESA (${source})` : "Listed under the ESA";
  return { label, value };
}

/** IUCN Red List categories, mapped to a reviewer-legible name -- UI-9: "IUCN RedList: VU" ->
 * "IUCN Red List: Vulnerable (VU)". Unrecognized codes (e.g. the data-level `IUCN:TN` bug tracked
 * separately, UI-L9) fall back to the bare code. */
const IUCN_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  EX: "Extinct",
  EW: "Extinct in the Wild",
  CR: "Critically Endangered",
  EN: "Endangered",
  VU: "Vulnerable",
  NT: "Near Threatened",
  LC: "Least Concern",
  DD: "Data Deficient",
  NE: "Not Evaluated",
};

/** "{category name} ({code})", or the bare code for one this module does not recognize. */
export function iucnRedListLabel(code: string): string {
  const name = IUCN_CATEGORY_LABELS[code];
  return name ? `${name} (${code})` : code;
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
  const esa = esaListing(card.esa?.code ?? null);
  if (esa) facts.push({ label: esa.label, value: esa.value });
  // UI-9: "IUCN Red List" (not "IUCN RedList") with the category NAME, not the bare code.
  if (card.rl) facts.push({ label: "IUCN Red List", value: iucnRedListLabel(card.rl) });
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

/**
 * UI-9 (round-3 review): the species-lens card's load-error copy — it used to print the raw error
 * `kind` code verbatim ("Couldn't load this species (not-found)."), which offers no next step. A
 * `"not-found"` (the release's shard genuinely has no such key) now names the release and points
 * back at search; every other kind (network/http/parse/schema — all transient/infra failures) gets
 * a plain, non-technical retry hint instead of the raw code.
 */
export function speciesCardErrorText(kind: string, ver: string | null): string {
  if (kind === "not-found") {
    return ver
      ? `This species isn't in release ${ver}. Search for another above.`
      : "This species isn't in this release. Search for another above.";
  }
  return "Couldn't load this species. Please try again.";
}
