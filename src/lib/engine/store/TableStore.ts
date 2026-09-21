// atlas-2 Step 3 (Sonnet half): the `TableStore` contract shared by two implementations -- MEMORY
// (this file's sibling `memoryStore.ts`, ships here, always works) and OPFS (atlas-2 Step 4, an
// Opus change: `opfs://atlas/{ver}.s{schema}.d{duckdb}.duckdb`, an LRU across releases, Web Locks
// `ifAvailable`). Both sit behind this one interface so `engine.ts` and every SQL template never
// know which backend is live.

/** bookkeeping for one registered table: what it's keyed by, how big it is, and when it was last
 * touched (the field an LRU eviction policy -- tier 2, OPFS -- reads; MEMORY tracks it too so the
 * two stay symmetric, even though it never evicts on its own). */
export interface TableEntry {
  name: string;
  /** content identity (e.g. a manifest-published digest/etag). Registering the SAME name with the
   * SAME digest again is a no-op; a DIFFERENT digest replaces the existing registration. */
  digest: string;
  bytes: number;
  lastUsedMs: number;
}

/** what a template's `{{from}}` RAW slot should be filled with (`sql.ts`'s `RAW_ALLOWLIST`) --
 * already a complete FROM-clause source, so a template never has to know whether it's reading a
 * MEMORY-registered virtual file (`read_parquet('name')`) or an OPFS-backed real table (a bare
 * identifier). */
export interface TableRef {
  from: string;
}

/**
 * Run one statement on the engine's single connection, WITHOUT going through `Engine`'s public
 * promise chain (atlas-2 Step 4).
 *
 * A store implementation that owns real, persisted tables (OPFS) has to issue DDL of its own --
 * `CREATE TABLE ... AS SELECT`, `DROP TABLE`, `INSERT INTO _meta`, `CHECKPOINT` -- and it is called
 * from INSIDE a chain task (`Engine#load` -> `store.register()`). Re-entering `Engine#exec` from
 * there would enqueue a task behind the one currently running and deadlock. Serialization is
 * already guaranteed at that point precisely BECAUSE the caller holds the chain, so this bypass is
 * safe exactly here and nowhere else: nothing outside a `TableStore` may be handed one.
 */
export type RawSql = <T = Record<string, unknown>>(sql: string) => Promise<T[]>;

export interface TableStore {
  readonly kind: string;

  /**
   * Register `name` (content-keyed by `digest`) from an already-fetched, whole-object `buffer`
   * (plan `engine/`: materialize-then-query, no httpfs range reads). Idempotent: if `name` is
   * already registered under this exact `digest`, this is a no-op -- no re-fetch happened upstream
   * (the caller is expected to have already decided that via {@link TableStore.has}), and no
   * backend work repeats here either. A different `digest` for an existing `name` drops the stale
   * registration first, then registers the new one.
   */
  register(name: string, digest: string, buffer: Uint8Array): Promise<TableRef>;

  /** Is `name` currently registered? With `digest` given, true only if it matches exactly. */
  has(name: string, digest?: string): boolean;

  /**
   * Record that `name` was just USED, without re-registering it (atlas-2 Step 4). A no-op for an
   * unregistered name.
   *
   * This exists because a CACHE HIT is a use: `Engine#load` short-circuits on
   * `has(name, digest)` and never reaches {@link TableStore.register}, so without this call the
   * `lastUsedMs` of the tables a session actually reads would never move and the OPFS tier's LRU
   * would evict by REGISTRATION order instead -- i.e. it would throw away the hottest tile in the
   * working set. Caught by the eviction gate on its first real-browser run.
   */
  touch(name: string): Promise<void>;

  /**
   * The FROM-clause source for an already-registered `name` (the same {@link TableRef}
   * {@link TableStore.register} returned), or `undefined` when `name` is not registered.
   *
   * atlas-2 Step 3b (the SQL twins) needs this: a place's `cell` / `cell_model` view spans MANY
   * registered tiles, so the caller composes one view out of several refs and cannot go back to the
   * single ref a `register()` call returned. It stays on the interface rather than in a caller
   * because the two backends spell a source differently -- MEMORY a `read_parquet('name')` over a
   * registered virtual file, OPFS (Step 4) a bare table identifier -- and no SQL template may know
   * which is live.
   */
  ref(name: string): TableRef | undefined;

  get(name: string): TableEntry | undefined;

  /** Every currently registered table. Order is not significant; callers needing an LRU order sort
   * by `lastUsedMs` themselves. */
  list(): TableEntry[];

  /** Remove `name`'s registration, freeing its bytes. A no-op if `name` isn't registered. */
  drop(name: string): Promise<void>;

  /** Sum of `bytes` across every registered table -- the number an LRU budget (tier 2: `min(300 MB,
   * 20% of navigator.storage.estimate().quota)`) is compared against. MEMORY tracks it for
   * parity/testing even though nothing in this step enforces a budget against it yet. */
  bytesUsed(): number;
}
