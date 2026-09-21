// atlas-3 step 2b: ONE table for the eight species categories (docs/design/spec.md "Data color" /
// the plan's "Species categories get ONE table: key, label, icon, color"). `color` is a CSS custom
// PROPERTY NAME (e.g. "--cat-bird"), never a resolved hex value -- callers write `var(color)`, so a
// re-hue or a theme change is a src/lib/brand/tokens.css-only edit. The nine `--cat-*` tokens (the
// eight categories plus `--cat-nodata`) and their `@contrast` pairs already exist in tokens.css
// (added with the rest of the design tokens); this module is what turns that CSS-only table into
// something Flower.svelte, Treemap.svelte and DataTable.svelte can look up from real data.
//
// The real data's category/component strings do NOT match this table's keys one-to-one:
//   - msens' flower palette is `scales::hue_pal()(8)` fixed to the names "invertebrate", "mammal",
//     "other", "primprod", "turtle", "bird", "coral", "fish" (viz.R:757-759) -- those are this
//     table's eight keys.
//   - but v8/v9's ACTUAL flower components (metric_key stripped of its prefix/suffix and
//     underscores turned to spaces, app.R:2432-2576) include "primary producer", which is not one
//     of the eight fixed names above -- parity scores app.md:826-830 and report pipeline
//     spec.md:186-187 both flag this: that petal renders grey/NA in the old app.
//   - and `msens::sp_cat_from_taxonomy()` (taxa.R:175) emits the taxonomic category itself as
//     "primary_producer" (underscore), a third spelling of the same thing.
// All three spellings -- "primprod", "primary producer", "primary_producer" -- are the SAME
// category and must resolve to the SAME token. That grey petal/slice is the exact bug this module
// exists to make permanently unrepeatable: `categoryFor()` below normalizes any of them to the
// `primprod` row.
import type { IconName } from "./icon-paths";

/** the eight species categories, exactly the names `scales::hue_pal()(8)` fixes in msens (viz.R:757-759). */
export type CategoryKey =
  "bird" | "coral" | "fish" | "invertebrate" | "mammal" | "other" | "primprod" | "turtle";

/** every category key, in the table's own (alphabetical) order -- what a test walks to assert
 * "every category key the parity doc lists has a row". */
export const CATEGORY_KEYS: readonly CategoryKey[] = [
  "bird",
  "coral",
  "fish",
  "invertebrate",
  "mammal",
  "other",
  "primprod",
  "turtle",
];

export interface Category {
  key: CategoryKey | "nodata";
  label: string;
  /** an IconName from icon-paths.ts, or `null` when no glyph in the spec's icon map fits. None of
   * the eight categories has a bespoke glyph in docs/design/spec.md §6 (only the flower PLOT itself
   * does) -- a category is told apart by its (always-present) label and swatch position, never the
   * swatch color alone (docs/design/spec.md: "no information by color alone"). */
  icon: IconName | null;
  /** a CSS custom property NAME, e.g. "--cat-bird" -- resolve with `var(color)`, never copy the hex
   * value out of tokens.css (that is exactly what scripts/check-hex-literals.mjs forbids). */
  color: string;
}

/** the eight species categories: key, label, icon, color TOKEN (docs/design/spec.md "Data color"). */
export const CATEGORIES: readonly (Category & { key: CategoryKey })[] = [
  { key: "bird", label: "Bird", icon: null, color: "--cat-bird" },
  { key: "coral", label: "Coral", icon: null, color: "--cat-coral" },
  { key: "fish", label: "Fish", icon: null, color: "--cat-fish" },
  { key: "invertebrate", label: "Invertebrate", icon: null, color: "--cat-invertebrate" },
  { key: "mammal", label: "Mammal", icon: null, color: "--cat-mammal" },
  { key: "other", label: "Other", icon: null, color: "--cat-other" },
  { key: "primprod", label: "Primary producer", icon: null, color: "--cat-primprod" },
  { key: "turtle", label: "Turtle", icon: null, color: "--cat-turtle" },
];

/** the "no data" row -- distinct from the eight real categories above: an unrecognized or absent
 * category, paired with the `--cat-nodata` "not reportable" hatch token (tokens.css: "paired with a
 * label, never color alone"). Never used as a silent fallback for a spelling this module should
 * recognize -- see `categoryFor()`. */
export const NO_DATA_CATEGORY: Category = {
  key: "nodata",
  label: "No data",
  icon: null,
  color: "--cat-nodata",
};

const BY_KEY: ReadonlyMap<CategoryKey, Category> = new Map(CATEGORIES.map((c) => [c.key, c]));

// raw sp_cat / component strings seen across the real data (see the module header) -> canonical key.
// Normalized before lookup: lower-cased, underscores folded to spaces, runs of whitespace collapsed
// -- so "primary_producer", "Primary Producer" and "primary  producer" all hit the same entry.
const SYNONYMS: Readonly<Record<string, CategoryKey>> = {
  bird: "bird",
  coral: "coral",
  fish: "fish",
  invertebrate: "invertebrate",
  mammal: "mammal",
  other: "other",
  turtle: "turtle",
  primprod: "primprod",
  "primary producer": "primprod", // v8/v9 flower component label (str_replace("_", " "))
};

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

/** the canonical `CategoryKey` for a raw sp_cat/component string, or `null` if unrecognized. */
export function categoryKeyFor(raw: string): CategoryKey | null {
  return SYNONYMS[normalize(raw)] ?? null;
}

/** the full `Category` row for a raw sp_cat/component string -- `NO_DATA_CATEGORY` (never a silent
 * grey-by-omission) when the string does not match any known category or synonym. */
export function categoryFor(raw: string): Category {
  const key = categoryKeyFor(raw);
  return key ? BY_KEY.get(key)! : NO_DATA_CATEGORY;
}
