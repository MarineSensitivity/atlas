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
  /** is this a RESTRICTED release (plan D6)? Those go first regardless of recency -- a reviewer's
   * device should not keep an unreleased release's data on disk one byte longer than it has to,
   * and `purgeRestricted()` (Sign out) is the only other thing that removes them. Supplied by the
   * caller from `versions.json`; absent means "not known to be restricted". */
  restricted?: boolean;
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
 * **Order (atlas-2 phase review, ruling 5 — a correction to the plan's literal wording).** The
 * plan said "least-recently-used tiles first, then whole stale versions", which throws away a HOT
 * tile of the release the user is looking at right now before it touches a COLD release nobody has
 * opened in weeks. The ruled order is:
 *
 *   1. **restricted OTHER-version files**, regardless of recency (plan D6: a reviewer's device keeps
 *      unreleased data no longer than it must);
 *   2. **the remaining OTHER-version files**, least recently used first;
 *   3. **cold tiles of the CURRENT release**, least recently used first.
 *
 * The ruling names four steps, opening with "cold tiles of OTHER releases". Steps 1-2 here are that
 * step and the "whole stale versions" step COLLAPSED, and necessarily so: another release's tiles
 * live inside a db file this tab has not opened and must not open (one handle per file,
 * `docs/spikes/S1.md` rule 6), so they are not individually addressable — the whole file is the
 * smallest unit available. The observable order is the ruled one.
 *
 * Non-tile tables (the small `taxon`/`zone_taxon`/`taxonomy`/`model` objects) are NEVER evicted —
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
  const byLru = (a: OtherVersionFile, b: OtherVersionFile) =>
    a.lastUsedMs - b.lastUsedMs || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  // restricted first, THEN by recency — so a restricted file used a second ago still goes before a
  // public one untouched for a month.
  const others = input.otherFiles
    .slice()
    .sort((a, b) => Number(!!b.restricted) - Number(!!a.restricted) || byLru(a, b));

  let used =
    pinnedBytes +
    tiles.reduce((s, t) => s + t.bytes, 0) +
    others.reduce((s, f) => s + f.bytes, 0) +
    incomingBytes;

  const dropTables: string[] = [];
  const deleteFiles: string[] = [];
  let freedBytes = 0;

  // other releases first (ruling 5) …
  for (const f of others) {
    if (used <= budgetBytes) break;
    deleteFiles.push(f.file);
    used -= f.bytes;
    freedBytes += f.bytes;
  }
  // … and only then this release's own cold tiles.
  for (const t of tiles) {
    if (used <= budgetBytes) break;
    dropTables.push(t.name);
    used -= t.bytes;
    freedBytes += t.bytes;
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
 * `boot.built_at` — the publish stamp every `app/` bundle carries. It is a REQUIRED top-level key
 * of `boot.json` in atlas-1's data contract (`atlas-1 data contract + app bundles.md`, the
 * boot.json row: "`schema, ver, built_at, msens`"), alongside the `app{schema, base, boot,
 * built_at, …}` block in `manifest.json`. `null` when absent or not a non-empty string.
 */
export function bootBuiltAt(boot: Record<string, unknown> | undefined): string | null {
  const v = boot?.built_at;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * One token per JS realm (i.e. per page load), created lazily. Exported so a test can read the
 * exact value the code uses; there is deliberately no setter — the point is that it is NOT stable
 * across reloads.
 */
let SESSION_TOKEN: string | null = null;
export function sessionToken(): string {
  return (SESSION_TOKEN ??= `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`);
}

/**
 * The cache key for an object `boot.tables` publishes NO digest for — `tables/model.parquet` on
 * v1-v7, every `serve/cell_model` tile, and `taxonomy` on a release whose `boot.tables` omits it.
 *
 * **Ruled in the atlas-2 phase review (4): `boot.built_at` + the object's path.** Before this, those
 * objects were keyed on the release LABEL alone, so a corrected re-publish of v9 was served stale
 * from OPFS indefinitely — the cache had no way to ever expire. Keying on `built_at` costs no extra
 * request and does not depend on S3 exposing `ETag` through CORS; any rebuild of `app/` invalidates
 * them. (The matching obligation on the publisher, logged in atlas-1: re-publishing ANY object the
 * app reads outside `app/` requires rebuilding `app/`.)
 *
 * **No `built_at` ⇒ fail closed: do not cache.** The key then carries {@link sessionToken}, which
 * is different on every page load, so a row persisted by an earlier session can never match and the
 * object is re-materialized. It is still stable WITHIN a session, so one page load registers the
 * object exactly once rather than thrashing.
 */
export function noDigestKey(boot: Record<string, unknown> | undefined, path: string): string {
  const builtAt = bootBuiltAt(boot);
  return builtAt === null ? `nocache:${sessionToken()}:${path}` : `built_at:${builtAt}:${path}`;
}

/**
 * Build an {@link ExpectedDigest} from a release's `boot.json`, using exactly the names
 * `analysis/sources.ts` registers:
 * - `{ver}/app/taxon.parquet` <- `boot.tables.taxon.digest`, and the same for `zone_taxon` /
 *   `taxonomy`;
 * - `{ver}/app/cell/tile=<n>/data_0.parquet` <- `${boot.tables.cell.digest}:<n>`, the composite
 *   `sources.ts` itself forms, so bumping the ONE published `cell` digest invalidates every cached
 *   cell tile of that release and nothing else;
 * - **every other object of THIS release** (`tables/model.parquet`, every `serve/cell_model` tile,
 *   and any of the three above whose `boot.tables` entry is missing) <- {@link noDigestKey}, i.e.
 *   `boot.built_at` + the path. This is the atlas-2 review's ruling 4; it used to return
 *   `undefined` for them, which meant the reconcile left them alone forever.
 *
 * `undefined` is now reserved for one case only: a name belonging to ANOTHER release, which this
 * boot has no opinion about and must not drop.
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
  const mine = new RegExp(`^${escapeRe(ver)}/`);

  return (name: string): string | undefined => {
    if (plain.has(name)) return plain.get(name) ?? noDigestKey(boot, name);
    const m = cellTile.exec(name);
    if (m) {
      const cell = digestOf("cell");
      return cell === undefined ? noDigestKey(boot, name) : `${cell}:${m[1]}`;
    }
    // any other object of THIS release: built_at + path (ruling 4). Another release's: no opinion.
    return mine.test(name) ? noDigestKey(boot, name) : undefined;
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
