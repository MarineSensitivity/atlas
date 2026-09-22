// atlas-4 step 2 — the composition treemap's input tree, over `sql/composition.sql`'s rows.
//
// `src/lib/ui/Treemap.svelte` is deliberately ONE LEVEL (`d3.hierarchy(node).sum()` rolls up
// values recursively, but the component only RENDERS `root.children`, one box per direct child —
// see its own header). The ported app's plotly treemap nests six WoRMS ranks
// (Kingdom>Phylum>Class>Order>Family>Genus); reproducing that would need a deeper-than-one-level
// renderer this repo does not have. This module instead builds the box the component DOES support
// — one per species CATEGORY (`categories.ts`'s eight names, the same grouping the flower already
// uses), sized by `suit_er_area` (the same weight the species table and flower already use, not a
// bare species count) — and is a documented simplification, not a silent one; see the atlas-4
// report's "could not satisfy" list for the per-rank drill-down.
import { CATEGORIES, categoryKeyFor } from "../../lib/ui/categories";

/**
 * Structurally identical to `Treemap.svelte`'s own exported `TreemapInputNode` — NOT imported from
 * it: a plain `tsc` (not svelte-aware) cannot see a `.svelte` file's `<script module>` named
 * exports the way svelte-check can (`src/shell/tools.ts`'s `ToolRailItem` hit the identical error
 * first; see its own comment). `tests/lens/scores/composition.test.ts` exercises this against the
 * real component's props, so the two cannot drift silently.
 */
export interface TreemapInputNode {
  name: string;
  categoryKey?: string;
  value?: number;
  children?: TreemapInputNode[];
}

/** one `sql/composition.sql` row, as much of it as this module reads. */
export interface CompositionRow {
  sp_cat: string;
  suit_er_area: unknown;
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * `rows` grouped by `sp_cat` (normalized through `categories.ts`'s `categoryKeyFor` — the same
 * "primary_producer"/"primary producer"/"primprod" fold the flower already applies, so a category
 * never splits into two boxes over a spelling difference), summed by `suit_er_area`, one leaf per
 * category with a real (positive) sum. A category with none gets no leaf, matching
 * `Treemap.svelte`'s own "value <= 0 is dropped" rule downstream.
 */
export function compositionTree(rows: readonly CompositionRow[]): TreemapInputNode {
  const sums = new Map<string, number>(); // keyed by the RAW label used for both display and categoryKey
  for (const r of rows) {
    const key = categoryKeyFor(r.sp_cat) ?? r.sp_cat;
    sums.set(key, (sums.get(key) ?? 0) + n(r.suit_er_area));
  }
  const byKey = new Map(CATEGORIES.map((c) => [c.key, c]));
  const children: TreemapInputNode[] = [];
  for (const [key, value] of sums) {
    if (value <= 0) continue;
    const cat = byKey.get(key as (typeof CATEGORIES)[number]["key"]);
    children.push(cat ? { name: cat.label, categoryKey: cat.key, value } : { name: key, value });
  }
  return { name: "Composition", children };
}
