// atlas-2 Step 4 (Opus half): the two POLICIES the OPFS tier runs on, both pure so both are
// provable under Node with no browser, no DuckDB and no clock:
//
// 1. **the budget** -- `min(300 MB, 20% of navigator.storage.estimate().quota)` ACROSS versions,
//    evicting least-recently-used TILES first, then whole stale versions (plan atlas-2 `store/`);
// 2. **the digest reconcile** -- `_meta(name, digest, bytes, last_used)` compared with
//    `boot.tables[*].digest` at session start; a table whose digest changed is dropped so the next
//    `register()` re-materializes exactly that table and nothing else.
//
// Keeping both here rather than inside `opfsStore.ts` is the point: the store is the part that
// cannot run under Vitest (it needs a real OPFS + a real DuckDB), so everything that CAN be decided
// without them is decided here instead.

import { isTile } from "./opfsPaths";

// ---- budget ----------------------------------------------------------------------------------

/** the hard cap, whatever the origin's quota is (plan atlas-2 `store/`). 300 MB is roughly a dozen
 * releases' small tables plus a working set of tiles; past that this stops being a cache and starts
 * being a liability on a phone. */
export const MAX_STORE_BYTES = 300 * 1024 * 1024;

/** the share of the origin's reported quota this app is willing to take. */
export const QUOTA_SHARE = 0.2;

/**
 * `min(300 MB, 20% of quota)`. An absent/unusable quota (`navigator.storage.estimate()` missing, or
 * answering `undefined` -- Firefox reports a quota, but a browser is not obliged to) falls back to
 * the 300 MB cap alone: the budget is a self-imposed courtesy, and being unable to read the quota is
 * not a reason to refuse to cache. A quota of 0 is honoured literally (a real "no room" signal).
 */
export function storeBudgetBytes(quota?: number): number {
  if (typeof quota !== "number" || !Number.isFinite(quota) || quota < 0) return MAX_STORE_BYTES;
  return Math.min(MAX_STORE_BYTES, Math.floor(quota * QUOTA_SHARE));
}

/** one evictable table inside the CURRENTLY OPEN db file. */
export interface EvictableTable {
  name: string;
  bytes: number;
  lastUsedMs: number;
}

/** one OTHER release's db file. Its tables are not individually addressable (they live inside a
 * file this tab has not opened and must not open -- one handle per file, `docs/spikes/S1.md` rule
 * 6), so the whole file is the unit of eviction. */
export interface OtherVersionFile {
  file: string;
  ver: string;
  bytes: number;
  lastUsedMs: number;
}

export interface EvictionInput {
  budgetBytes: number;
  /** bytes about to be written (0 when re-planning without an incoming table). */
  incomingBytes: number;
  /** every table in the open file, tiles and non-tiles alike; `isTile()` decides which are
   * evictable. */
  tables: readonly EvictableTable[];
  otherFiles: readonly OtherVersionFile[];
}

export interface EvictionPlan {
  /** tile tables to `DROP TABLE`, in the order they should be dropped (LRU first). */
  dropTables: string[];
  /** whole other-version db files to delete, LRU first. */
  deleteFiles: string[];
  freedBytes: number;
  /** true when everything evictable has been listed and the total STILL does not fit. The caller
   * proceeds anyway: the budget is best-effort and must never turn into a user-visible failure
   * (plan: "the app never REQUIRES OPFS"); the real backstop is the browser's own quota error,
   * which is an ordinary OPFS error and therefore a fall-back-to-memory path. */
  overBudget: boolean;
}

/**
 * Plan what to evict so `incomingBytes` fits inside `budgetBytes`.
 *
 * Order, verbatim from the plan: **least-recently-used tiles first, then whole stale versions.**
 * Non-tile tables (the small `taxon`/`zone_taxon`/`taxonomy`/`model` objects) are NEVER evicted --
 * they are the reason the tier exists, and together they are ~10-25 MB per release against a 300 MB
 * budget. Ties on `lastUsedMs` break on `name`/`file` so the plan is deterministic (a test asserting
 * an exact eviction order must not depend on Map insertion order).
 */
export function planEviction(input: EvictionInput): EvictionPlan {
  const { budgetBytes, incomingBytes } = input;

  const pinnedBytes = input.tables
    .filter((t) => !isTile(t.name))
    .reduce((sum, t) => sum + t.bytes, 0);
  const tiles = input.tables
    .filter((t) => isTile(t.name))
    .slice()
    .sort(
      (a, b) => a.lastUsedMs - b.lastUsedMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  const others = input.otherFiles
    .slice()
    .sort(
      (a, b) => a.lastUsedMs - b.lastUsedMs || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
    );

  let used =
    pinnedBytes +
    tiles.reduce((s, t) => s + t.bytes, 0) +
    others.reduce((s, f) => s + f.bytes, 0) +
    incomingBytes;

  const dropTables: string[] = [];
  const deleteFiles: string[] = [];
  let freedBytes = 0;

  for (const t of tiles) {
    if (used <= budgetBytes) break;
    dropTables.push(t.name);
    used -= t.bytes;
    freedBytes += t.bytes;
  }
  for (const f of others) {
    if (used <= budgetBytes) break;
    deleteFiles.push(f.file);
    used -= f.bytes;
    freedBytes += f.bytes;
  }

  return { dropTables, deleteFiles, freedBytes, overBudget: used > budgetBytes };
}

// ---- digest reconcile ------------------------------------------------------------------------

/** one `_meta` row, exactly the four columns the plan names. */
export interface MetaRow {
  name: string;
  digest: string;
  bytes: number;
  lastUsedMs: number;
}

/** what a name's digest SHOULD be this session, or `undefined` when the caller has no opinion about
 * that name (a tile, or an object with no `boot.tables` entry): an opinion-less name is left alone
 * here and re-checked by `register()`'s own name+digest guard. */
export type ExpectedDigest = (name: string) => string | undefined;

/**
 * Session-start reconcile: every persisted `_meta` row whose digest DISAGREES with what `boot`
 * publishes today is dropped, so the very next `register()` re-materializes exactly that table
 * (`TableStore.has(name, digest)` then answers false for it and true for its unchanged neighbours).
 *
 * This runs eagerly at open rather than relying only on `register()`'s per-call comparison, because
 * the reload path is the whole point of the tier: with the network blocked or slow, a caller that
 * checked `has(name)` WITHOUT a digest, or a caller that reads a table it did not itself load this
 * session (a view built from `ref()`), would otherwise be served a stale table. Removing this sweep
 * is the seeded fault "the digest comparison skipped".
 */
export function planReconcile(rows: readonly MetaRow[], expected: ExpectedDigest): string[] {
  const drop: string[] = [];
  for (const row of rows) {
    const want = expected(row.name);
    if (want !== undefined && want !== row.digest) drop.push(row.name);
  }
  return drop;
}

/** the `boot.tables` shape atlas-1 publishes (`analysis/sources.ts` reads the same one). */
interface BootTable {
  digest?: unknown;
}

/**
 * Build an {@link ExpectedDigest} from a release's `boot.json`, using exactly the names
 * `analysis/sources.ts` registers:
 * - `{ver}/app/taxon.parquet` <- `boot.tables.taxon.digest`, and the same for `zone_taxon` /
 *   `taxonomy`;
 * - `{ver}/app/cell/tile=<n>/data_0.parquet` <- `${boot.tables.cell.digest}:<n>`, the composite
 *   `sources.ts` itself forms, so bumping the ONE published `cell` digest invalidates every cached
 *   cell tile of that release and nothing else.
 *
 * Everything else (`tables/model.parquet`, every `serve/cell_model` tile) has no published digest --
 * `sources.ts` keys those on the release label instead -- so this returns `undefined` for them and
 * the reconcile leaves them alone. That gap is atlas-1's to close (`sources.ts`'s own note: `model`
 * belongs under `app/` with a digest "or OPFS can never invalidate either one"); it is recorded
 * here, at the place that would use the digest, rather than silently assumed away.
 */
export function expectedDigestFromBoot(
  ver: string,
  boot: Record<string, unknown> | undefined,
): ExpectedDigest {
  const tables = (boot?.tables ?? {}) as Record<string, BootTable | undefined>;
  const digestOf = (key: string): string | undefined => {
    const d = tables[key]?.digest;
    return typeof d === "string" && d.length ? d : undefined;
  };

  const plain = new Map<string, string | undefined>([
    [`${ver}/app/taxon.parquet`, digestOf("taxon")],
    [`${ver}/app/zone_taxon.parquet`, digestOf("zone_taxon")],
    [`${ver}/app/taxonomy.parquet`, digestOf("taxonomy")],
  ]);
  const cellTile = new RegExp(`^${escapeRe(ver)}/app/cell/tile=(\\d+)/data_0\\.parquet$`);

  return (name: string): string | undefined => {
    if (plain.has(name)) return plain.get(name);
    const m = cellTile.exec(name);
    if (!m) return undefined;
    const cell = digestOf("cell");
    return cell === undefined ? undefined : `${cell}:${m[1]}`;
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
