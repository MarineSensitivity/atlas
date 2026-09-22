// The species lens' data layer, part 2: the picker index (`app/taxa.json`) and its search.
//
// WHAT IT REPLACES. Shiny did this with `updateSelectizeInput(server = TRUE)`: ~22 k options lived
// on the server and the browser held only the visible page (`atlas-refs/"parity species app.md"`
// §5.4, §13.1). A static app has no server, so atlas-1 publishes the whole index column-oriented
// (parallel arrays gzip to a fraction of an array of objects) and it is searched here, in memory.
// The index loads when the search is focused or at idle — never on first paint.
//
// THE TRAP §13.1 NAMES is the TWO lists (US-only vs all) that swap on a checkbox while PRESERVING
// the selection. `visibleRows` + `keepSelection` are that rule, in one place, with their own tests.
import { VER_RE, builtinFetchJson, errorFor, type LoadOptions, type ShardResult } from "./shards";
import { dataUrl } from "../../../lib/release/dataBase";

// ---- shapes (msens/inst/schema/app_taxa.schema.json) --------------------------------------------

export interface PickerRow {
  /** merged key — the value a picker option carries, and today's `?sp=`. */
  key: string;
  sci: string;
  common: string | null;
  /** `sp_cat`, resolved from `cat_idx` into `cat`. */
  cat: string;
  /** `flags` bit 1. `coalesce(is_valid_usa, FALSE)` in R — an absent flag is false, never true. */
  validUsa: boolean;
  /** `flags` bit 2. */
  validGlobal: boolean;
  /** the option label, `"{sp_cat}: {scientific}{ (common)}"` (§5.4). */
  label: string;
  /** index in the published arrays — the tie-breaker that keeps "the first US-valid taxon"
   * (§5.4's default rule) meaning the same thing here as in `d_spp`'s own row order. */
  ord: number;
  /** normalized once at load: search runs over ~22 k rows on every keystroke. */
  nSci: string;
  nCommon: string;
  nLabel: string;
}

export interface TaxaIndex {
  ver: string;
  /** every `sp_cat`, in the published order — the optgroup order. */
  cats: string[];
  /** every row, in the published order. */
  rows: PickerRow[];
  byKey: Map<string, PickerRow>;
}

// ---- normalization ------------------------------------------------------------------------------

/** the curly apostrophe really is in the data ("deadman’s fingers", "Hubbs’ eelpout"): nobody types
 * it, so it folds to the straight one before anything else. */
const APOSTROPHES = /[‘’ʼ]/g;
const COMBINING = /[̀-ͯ]/g;
const WHITESPACE = /\s+/g;

/**
 * lowercase, diacritics folded, apostrophes straightened, whitespace collapsed — so "senorita"
 * finds "señorita" and "deadman's fingers" finds "deadman’s fingers".
 *
 * NFD then strip the combining marks: that is the fold that works for the Latin-1 letters in this
 * data without a locale-dependent collator (determinism matters more than linguistic nuance here —
 * the same query must rank the same way in every browser and in Node).
 */
export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(APOSTROPHES, "'")
    .toLowerCase()
    .replace(WHITESPACE, " ")
    .trim();
}

/** `"{sp_cat}: {scientific}{ (common)}"` — §5.4's option label, verbatim. */
export function pickerLabel(cat: string, sci: string, common: string | null): string {
  return common && common.length > 0 ? `${cat}: ${sci} (${common})` : `${cat}: ${sci}`;
}

// ---- building the index -------------------------------------------------------------------------

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * `app/taxa.json` -> a `TaxaIndex`, or an error string naming the first violation. Every parallel
 * array must have the same length as `n`: a short `flags` array would silently mark the tail of the
 * list non-US, which is exactly the kind of quiet wrongness this repo fails closed on.
 */
export function parseTaxaIndex(raw: unknown): TaxaIndex | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "not an object";
  const o = raw as Record<string, unknown>;
  if (typeof o.schema !== "number" || !Number.isInteger(o.schema) || o.schema < 1)
    return "'schema' must be an integer >= 1";
  const ver = typeof o.ver === "string" ? o.ver : "";
  if (!VER_RE.test(ver)) return "'ver' must be a version label";
  if (typeof o.n !== "number" || !Number.isInteger(o.n) || o.n < 0)
    return "'n' must be a non-negative integer";
  if (!isStrArray(o.cat)) return "'cat' must be an array of strings";
  if (!isStrArray(o.key)) return "'key' must be an array of strings";
  if (!isStrArray(o.sci)) return "'sci' must be an array of strings";
  if (!Array.isArray(o.common)) return "'common' must be an array";
  if (!Array.isArray(o.cat_idx)) return "'cat_idx' must be an array";
  if (!Array.isArray(o.flags)) return "'flags' must be an array";
  const n = o.n;
  for (const [name, arr] of [
    ["key", o.key],
    ["sci", o.sci],
    ["common", o.common],
    ["cat_idx", o.cat_idx],
    ["flags", o.flags],
  ] as const) {
    if ((arr as unknown[]).length !== n)
      return `'${name}' has ${(arr as unknown[]).length} of ${n}`;
  }

  const cats = o.cat;
  const rows: PickerRow[] = [];
  const byKey = new Map<string, PickerRow>();
  for (let i = 0; i < n; i++) {
    const catIdx = o.cat_idx[i];
    if (
      typeof catIdx !== "number" ||
      !Number.isInteger(catIdx) ||
      catIdx < 0 ||
      catIdx >= cats.length
    )
      return `'cat_idx[${i}]' out of range`;
    const flags = o.flags[i];
    if (typeof flags !== "number" || !Number.isInteger(flags) || flags < 0 || flags > 3)
      return `'flags[${i}]' must be 0..3`;
    const commonRaw = o.common[i];
    if (commonRaw !== null && typeof commonRaw !== "string")
      return `'common[${i}]' must be a string or null`;
    const common = (commonRaw as string | null) ?? null;
    const cat = cats[catIdx];
    const sci = o.sci[i];
    const label = pickerLabel(cat, sci, common);
    const row: PickerRow = {
      key: o.key[i],
      sci,
      common,
      cat,
      validUsa: (flags & 1) === 1,
      validGlobal: (flags & 2) === 2,
      label,
      ord: i,
      nSci: foldText(sci),
      nCommon: common ? foldText(common) : "",
      nLabel: foldText(label),
    };
    rows.push(row);
    byKey.set(row.key, row);
  }
  return { ver, cats, rows, byKey };
}

/**
 * Fetch + validate `app/taxa.json` for a release. Same typed-result contract as the shard loaders
 * (shards.ts): a 404, a bad body or a schema violation is `{ok: false, error}`, never a throw.
 */
export async function loadTaxa(
  ver: string,
  opts: LoadOptions = {},
): Promise<ShardResult<TaxaIndex>> {
  const url = dataUrl(ver, "app/taxa.json", opts.session);
  let raw: unknown;
  try {
    raw = await (opts.fetchJson ?? builtinFetchJson)(url);
  } catch (cause) {
    return { ok: false, error: errorFor(url, cause) };
  }
  const parsed = parseTaxaIndex(raw);
  if (typeof parsed === "string")
    return { ok: false, error: { kind: "schema", url, detail: `app/taxa.json: ${parsed}` } };
  return { ok: true, value: parsed };
}

// ---- the two lists ------------------------------------------------------------------------------

/** sort for display: `arrange(sp_cat, label)` (§5.4's `.make_choices`), then the published order as
 * a stable tie-break. */
function byCatThenLabel(a: PickerRow, b: PickerRow): number {
  if (a.cat !== b.cat) return a.cat < b.cat ? -1 : 1;
  if (a.nLabel !== b.nLabel) return a.nLabel < b.nLabel ? -1 : 1;
  return a.ord - b.ord;
}

/** the rows the picker offers: all of them, or only the US-valid ones (the checkbox, default on). */
export function visibleRows(index: TaxaIndex, usOnly: boolean): PickerRow[] {
  const rows = usOnly ? index.rows.filter((r) => r.validUsa) : index.rows;
  return [...rows].sort(byCatThenLabel);
}

/** the same rows grouped into optgroups, in `sp_cat` order. */
export function groupByCat(rows: PickerRow[]): { cat: string; rows: PickerRow[] }[] {
  const groups: { cat: string; rows: PickerRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.cat === row.cat) last.rows.push(row);
    else groups.push({ cat: row.cat, rows: [row] });
  }
  return groups;
}

/**
 * §5.4's default species: *Dermochelys coriacea* among the US-valid taxa, else the FIRST US-valid
 * taxon in the published row order (`(d_spp |> filter(coalesce(is_valid_usa, FALSE)) |>
 * pull(mdl_key))[1]`, app.R:477-480 — `d_spp`'s own order, not the label-sorted one).
 *
 * Beyond R: when no taxon is US-valid at all (R yields NA there and the app starts with nothing
 * selected) the first row of the whole index is used, so the lens always has something to draw.
 */
export const DEFAULT_SPECIES_SCI = "Dermochelys coriacea";

export function defaultSpecies(index: TaxaIndex): string | null {
  const usValid = index.rows.filter((r) => r.validUsa);
  const pool = usValid.length > 0 ? usValid : index.rows;
  const leatherback = pool.find((r) => r.sci === DEFAULT_SPECIES_SCI);
  return (leatherback ?? pool[0])?.key ?? null;
}

/**
 * Swapping the "Only species in US waters" checkbox: KEEP the current selection when it is in the
 * new list (a taxon valid in both lists must not be lost by ticking a box — §5.4's trap), otherwise
 * fall back to the default species for that list.
 */
export function keepSelection(
  index: TaxaIndex,
  selected: string | null | undefined,
  usOnly: boolean,
): string | null {
  const row = selected ? index.byKey.get(selected) : undefined;
  if (row && (!usOnly || row.validUsa)) return row.key;
  return defaultSpecies(index);
}

// ---- search -------------------------------------------------------------------------------------

export interface SearchOptions {
  usOnly?: boolean;
  /** how many matches to return (the list is virtualized; nobody scrolls 22 k rows). */
  limit?: number;
}

/** rank tiers, best first. Exported so a test asserts the ORDER of the rules, not just the output.
 * A plain frozen object, not a TS `enum` — this repo builds with isolatedModules, where a `const
 * enum` is erased differently per tool and a plain `enum` emits runtime code for nothing. */
export const MatchRank = {
  ExactSci: 0,
  ExactCommon: 1,
  PrefixSci: 2,
  PrefixCommon: 3,
  WordSci: 4,
  WordCommon: 5,
  SubstringSci: 6,
  SubstringCommon: 7,
  None: 99,
} as const;

export type MatchRank = (typeof MatchRank)[keyof typeof MatchRank];

function wordStart(haystack: string, needle: string): boolean {
  let from = haystack.indexOf(needle);
  while (from > 0) {
    if (haystack[from - 1] === " " || haystack[from - 1] === "-" || haystack[from - 1] === "(")
      return true;
    from = haystack.indexOf(needle, from + 1);
  }
  return false;
}

/** the rank of one row against an already-folded query. */
export function rankRow(row: PickerRow, q: string): MatchRank {
  if (row.nSci === q) return MatchRank.ExactSci;
  if (row.nCommon === q) return MatchRank.ExactCommon;
  if (row.nSci.startsWith(q)) return MatchRank.PrefixSci;
  if (row.nCommon.startsWith(q)) return MatchRank.PrefixCommon;
  if (wordStart(row.nSci, q)) return MatchRank.WordSci;
  if (wordStart(row.nCommon, q)) return MatchRank.WordCommon;
  if (row.nSci.includes(q)) return MatchRank.SubstringSci;
  if (row.nCommon.includes(q)) return MatchRank.SubstringCommon;
  return MatchRank.None;
}

export interface SearchMatch {
  row: PickerRow;
  rank: MatchRank;
}

/**
 * Client-side search over the index (§5.4): normalized, diacritics folded, over scientific AND
 * common names, ranked. An empty query is the plain list (what the picker shows when it opens).
 *
 * `usOnly` is applied BEFORE ranking, so the two lists really are two lists — a non-US taxon is
 * never offered while the box is ticked, however well it matches.
 */
export function searchTaxa(
  index: TaxaIndex,
  query: string,
  opts: SearchOptions = {},
): SearchMatch[] {
  const usOnly = opts.usOnly ?? true;
  const limit = opts.limit ?? 50;
  const q = foldText(query);
  const pool = usOnly ? index.rows.filter((r) => r.validUsa) : index.rows;
  if (q.length === 0)
    return [...pool]
      .sort(byCatThenLabel)
      .slice(0, limit)
      .map((row) => ({ row, rank: MatchRank.None }));

  const hits: SearchMatch[] = [];
  for (const row of pool) {
    const rank = rankRow(row, q);
    if (rank !== MatchRank.None) hits.push({ row, rank });
  }
  hits.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.row.nSci !== b.row.nSci) return a.row.nSci < b.row.nSci ? -1 : 1;
    return a.row.ord - b.row.ord;
  });
  return hits.slice(0, limit);
}

/** §5.4's logging rule, as data: `search_species` fires on >= 3 characters only (the 900 ms debounce
 * and the no-repeats rule belong to the UI half — this is the part that is a pure predicate). */
export const SEARCH_MIN_CHARS = 3;

export function shouldLogSearch(query: string): boolean {
  return foldText(query).length >= SEARCH_MIN_CHARS;
}

/** §5.4/§10's full `search_species` rule, as a pure, testable unit: 900 ms debounce, >= 3 chars
 * (`shouldLogSearch`), no repeats. Pulled out of `SpeciesPicker.svelte` (fix round 3 #2) — a
 * reviewer's fault there (900 -> 90 ms; allowing a repeat) stayed GREEN because nothing except the
 * component itself exercised the timing/dedup rule; this factory is what a fake-clock unit test
 * (`tests/lens/species/picker.test.ts`) can now pin. */
export const SEARCH_DEBOUNCE_MS = 900;

export interface SearchLoggerOptions {
  /** called with the query once it has debounced, is long enough, and is not a repeat. */
  onLog: (query: string) => void;
  debounceMs?: number;
  /** injected so a test drives real behaviour with fake timers rather than sleeping — the same
   * seam `map/camera.ts`'s `createCameraWriter` already uses for its own debounce. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface SearchLogger {
  /** call on every keystroke with the CURRENT (raw, un-folded) query. */
  onInput(query: string): void;
  /** cancel any pending timer — call on unmount. */
  destroy(): void;
}

export function createSearchLogger(opts: SearchLoggerOptions): SearchLogger {
  const debounceMs = opts.debounceMs ?? SEARCH_DEBOUNCE_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  let lastLogged = "";
  let handle: ReturnType<typeof setTimeout> | undefined;

  return {
    onInput(query: string) {
      if (handle !== undefined) clearTimer(handle);
      handle = setTimer(() => {
        handle = undefined;
        if (shouldLogSearch(query) && query !== lastLogged) {
          lastLogged = query;
          opts.onLog(query);
        }
      }, debounceMs);
    },
    destroy() {
      if (handle !== undefined) clearTimer(handle);
      handle = undefined;
    },
  };
}
