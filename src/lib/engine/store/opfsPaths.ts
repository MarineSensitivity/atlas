// atlas-2 Step 4 (Opus half): the pure naming rules the OPFS tier is built on -- the db file's name,
// how a stale sibling is recognized, and how a store NAME (a release-relative object path such as
// `v9/app/taxon.parquet`) becomes a real SQL table identifier. Nothing here touches OPFS, DuckDB,
// `navigator` or any clock: every rule below is a pure function with its own unit test, so the
// interesting decisions ("is this file stale?", "do two objects collide on one table name?") are
// provable under plain Node.
//
// File layout (plan atlas-2 `store/`): `opfs://atlas/{ver}.s{schema}.d{duckdb}.duckdb`.
// - `{ver}` is the release label (`v9`, `v7b`) -- the LOCK is keyed on this too, so one release is
//   one file is one lock.
// - `s{schema}` is the published bundle's schema version: a schema change is a different file, never
//   an in-place migration of a cache.
// - `d{duckdb}` is the DuckDB **engine** version (`bundles.ts`'s `DUCKDB_ENGINE_VERSION`, e.g.
//   `v1.4.3`, NOT the npm version) -- a DuckDB storage-format change must not be read back by a
//   different engine. `docs/spikes/S1.md` measured exactly this class of bug from the other side
//   (npm `latest` writing a file it then could not read).
// Any file whose `{ver}` matches but whose suffix does not is a STALE file for that release and is
// deleted at boot; another release's file is NOT stale (the LRU budget spans versions and decides
// those separately -- see `policy.ts`).

/** the one OPFS directory this app ever writes into. Everything else under the origin's OPFS root
 * belongs to someone else and is never listed, read or deleted. */
export const OPFS_DIR = "atlas";

/** `{ver}.s{schema}.d{duckdb}.duckdb`. `ver` follows `msens::atlas_resolve_ver()`'s label shape
 * (`^v[0-9]+[a-z]?$`, the same literal used in `release/version.ts`); `schema` and `duckdb` are
 * restricted to characters that cannot introduce a path segment or an extra `.duckdb` suffix. */
const VER_RE = /^v[0-9]+[a-z]?$/;
const SCHEMA_RE = /^[A-Za-z0-9_-]+$/;
const DUCKDB_RE = /^[A-Za-z0-9_.-]+$/;
const FILE_RE = /^(v[0-9]+[a-z]?)\.s([A-Za-z0-9_-]+)\.d([A-Za-z0-9_.-]+)\.duckdb$/;

export interface OpfsDbFileParts {
  ver: string;
  schema: string;
  duckdb: string;
}

/**
 * Build the db file name for one release. Throws on a part that does not match its pattern rather
 * than producing a name that could escape {@link OPFS_DIR} (a `/` or a `..` in `ver`) or be
 * misparsed later -- this string is concatenated into an `opfs://` path, so it is validated here,
 * once, at the only place it is formed.
 */
export function opfsDbFileName(parts: OpfsDbFileParts): string {
  const { ver, schema, duckdb } = parts;
  if (!VER_RE.test(ver)) throw new Error(`opfsDbFileName(): invalid ver "${ver}"`);
  if (!SCHEMA_RE.test(schema)) throw new Error(`opfsDbFileName(): invalid schema "${schema}"`);
  if (!DUCKDB_RE.test(duckdb)) throw new Error(`opfsDbFileName(): invalid duckdb "${duckdb}"`);
  return `${ver}.s${schema}.d${duckdb}.duckdb`;
}

/** The inverse of {@link opfsDbFileName}: `null` for anything this app did not write (including its
 * own `.wal` side files, which are deliberately NOT parseable as db files -- they are deleted
 * alongside their db, never on their own account). */
export function parseOpfsDbFileName(name: string): OpfsDbFileParts | null {
  const m = FILE_RE.exec(name);
  return m ? { ver: m[1], schema: m[2], duckdb: m[3] } : null;
}

/** `opfs://atlas/<file>` -- the path handed to `AsyncDuckDB.open({ path })`. duckdb-wasm splits this
 * on `/` and creates the intermediate directory itself (verified in the pinned 1.32.0 worker's
 * `prepareFileHandles`), so the `atlas/` segment needs no separate mkdir. */
export function opfsDbPath(file: string): string {
  return `opfs://${OPFS_DIR}/${file}`;
}

/** duckdb-wasm's `prepareDBFileHandle` prepares BOTH `<path>` and `<path>.wal` (same source), so a
 * file this app deletes must take its write-ahead log with it -- otherwise a later open finds a WAL
 * with no database and the "self-heal" leaves half a corpse behind. */
export function walFileName(file: string): string {
  return `${file}.wal`;
}

/**
 * The files to delete at boot: same release, different suffix. A release's own CURRENT file is
 * never stale, and another release's file is never stale here (it is the cross-version LRU budget's
 * business -- `policy.ts` -- not the boot sweep's).
 */
export function staleSiblings(names: readonly string[], currentFile: string): string[] {
  const current = parseOpfsDbFileName(currentFile);
  if (!current) throw new Error(`staleSiblings(): "${currentFile}" is not a db file name`);
  const out: string[] = [];
  for (const name of names) {
    if (name === currentFile) continue;
    const parts = parseOpfsDbFileName(name);
    if (parts && parts.ver === current.ver) out.push(name);
  }
  return out;
}

/** the Web Lock name for one release (plan atlas-2 `store/`, `docs/spikes/S1.md` rule 3). One
 * release = one file = one lock, so two tabs on DIFFERENT releases never contend. */
export function opfsLockName(ver: string): string {
  return `atlas-opfs-${ver}`;
}

// ---- store name -> SQL table identifier ------------------------------------------------------

/** FNV-1a (32-bit), the smallest deterministic non-cryptographic hash that is exact in JS doubles.
 * It only has to make a truncated, character-squashed name unique -- not resist an adversary. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619, in 32-bit arithmetic that stays exact in a double
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * A store `name` is an object path (`v9/app/cell/tile=1012/data_0.parquet`): legal as a duckdb-wasm
 * virtual FILE name (what MEMORY registers it as) but not as a SQL identifier, which is what OPFS
 * needs -- there the object becomes a real, persisted TABLE. This maps one to the other:
 * a readable, squashed prefix for a human reading `SHOW TABLES`, plus the FNV-1a hash of the FULL
 * original name so that two long names sharing a 48-character prefix can never collide.
 *
 * Returned UNQUOTED and guaranteed to match `sql.ts`'s `IDENTIFIER_RE`; callers quote it with
 * `ident()`.
 */
export function tableIdentifier(name: string): string {
  const squashed = name.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 48);
  return `t_${squashed}_${fnv1a32(name).toString(36)}`;
}

/** the three table classes the LRU budget distinguishes (plan atlas-2 `store/`: "tile tables
 * `cell_tile` and `cell_model_tile` with an LRU registry"). A `table` is one of the small whole-
 * object tables (`taxon`, `zone_taxon`, `taxonomy`, `model`) -- the reason the tier exists at all,
 * so it is never evicted by the budget; only tiles are. */
export type TableKind = "cell_tile" | "cell_model_tile" | "table";

/** Classified from the published object path, which is the only thing the store is told. The two
 * shapes come from `analysis/sources.ts`: `app/cell/tile=<n>/data_0.parquet` (the wide score tiles)
 * and `serve/cell_model/tile=<n>/data_0.parquet` (the per-species tiles). */
export function tableKind(name: string): TableKind {
  if (/(^|\/)serve\/cell_model\/tile=\d+\//.test(name)) return "cell_model_tile";
  if (/(^|\/)app\/cell\/tile=\d+\//.test(name)) return "cell_tile";
  return "table";
}

/** true for the two tile kinds -- the only rows the budget may evict. */
export function isTile(name: string): boolean {
  return tableKind(name) !== "table";
}
