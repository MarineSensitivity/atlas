// atlas-2 Step 4 (Opus half): the ORCHESTRATION -- everything that has to happen around the OPFS
// store but is not the store itself. One entry point, `openTableStoreBackend()`, which returns the
// two callbacks `Engine` needs (`createDb`, `store`) already wired for whichever tier won, plus the
// two purge functions the plan asks for with no UI (`purgeRestricted`, `purgeAllStoredData`).
//
// The sequence, in the order it must happen (plan atlas-2 `store/`, `docs/spikes/S1.md`):
//  1. `selectStore()` -- the setting, then the APIs, then the LOCK (`ifAvailable`), then the OPFS
//     attempt. A failure reason that is a genuine OPFS failure emits `opfs_fallback{reason}`
//     through the injected sink; `lock-held` and `setting-off` do not (they are normal).
//  2. stale-suffix files for THIS release are deleted; the cross-version registry is reconciled
//     against what is actually on disk; the budget is computed from the quota.
//  3. `createDb()` -- create DuckDB, `open({ path: "opfs://atlas/...", accessMode: READ_WRITE })`,
//     then on a SHORT-LIVED connection: create `_meta` if absent, read it, and reconcile every row
//     against `boot.tables[*].digest` (`policy.ts`'s `planReconcile`) -- the SESSION-START digest
//     comparison. ANY throw in this step is the self-heal: emit, terminate, DELETE the file and its
//     WAL, release the lock, and return a FRESH in-memory DuckDB instead. That is the corrupted-file
//     case, and it is also every "storage went away between the probe and the open" case.
//  4. `makeStore()` -- the real `OpfsTableStore` (or `MemoryTableStore` if anything above fell
//     back), plus a `visibilitychange -> hidden` CHECKPOINT listener.
//  5. `close()` -- CHECKPOINT, update the registry, drop the listener, delete the file if the
//     session degraded, and RELEASE THE LOCK. An abrupt tab close skips all of this; the lock is
//     released by the browser and the WAL is what the last CHECKPOINT left behind, which is why
//     step 4's listener and the per-register checkpoint both exist.
//
// The analytics module is deliberately NOT imported anywhere in this directory: the sink is a
// callback (`emit`), so the store tier has no dependency on analytics and analytics has no
// dependency on the engine chunk.

import type { DuckDBHandleLike } from "../engine";
import { MemoryTableStore } from "./memoryStore";
import {
  atlasDir,
  dbFileBytes,
  deleteDbFile,
  listDbFiles,
  type DirHandleLike,
  type OpfsRootProvider,
  defaultOpfsRoot,
} from "./opfsFs";
import { opfsDbFileName, opfsDbPath, parseOpfsDbFileName, staleSiblings } from "./opfsPaths";
import { META_DDL, META_SELECT, OpfsTableStore } from "./opfsStore";
import {
  expectedDigestFromBoot,
  planReconcile,
  storeBudgetBytes,
  type ExpectedDigest,
  type MetaRow,
} from "./policy";
import {
  otherVersionFiles,
  readRegistry,
  reconcileRegistry,
  touchRegistry,
  writeRegistry,
  type RegistryEntry,
} from "./registry";
import { defaultStorage, type StorageLike } from "./keepData";
import { isFallbackReason, selectStore, type LockManagerLike, type StoreDecision } from "./select";
import { ident } from "../sql";
import { tableIdentifier } from "./opfsPaths";
import type { RawSql, TableStore } from "./TableStore";

/** a DuckDB handle that can be pointed at a file. `engine.ts`'s `DuckDBHandleLike` deliberately
 * does not know about `open()` (the memory tier never calls it). */
export interface OpenableDuckDB extends DuckDBHandleLike {
  open(config: { path?: string; accessMode?: number }): Promise<void>;
}

export interface CreatedDb {
  db: OpenableDuckDB;
  worker?: { terminate(): void };
}

/** creates a DuckDB handle already pointed at `path` (or in-memory when `path` is `null`). The one
 * seam that keeps this module free of a static `@duckdb/duckdb-wasm` import. */
export type OpenDatabase = (path: string | null) => Promise<CreatedDb>;

/** the real one: the self-hosted bundles of `bundles.ts`, reached through a DYNAMIC import so this
 * module never drags duckdb into anyone's static graph. */
export const defaultOpenDatabase: OpenDatabase = async (path) => {
  const { createRealDuckDB, duckdb } = await import("../bundles");
  const { db, worker } = await createRealDuckDB();
  if (path) {
    try {
      await db.open({ path, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
    } catch (err) {
      // MUST tear down its own worker before rethrowing. duckdb-wasm's OPFS `open` creates the
      // file's sync access handle FIRST and only then reads it, so a corrupted file throws with the
      // handle already held -- and a handle held by a live worker makes `removeEntry()` fail
      // forever. Leaving that to the caller does not work: the caller never received a handle to
      // terminate, so the "self-heal" deleted nothing and the corrupt file survived every reload.
      // Measured exactly this way on the first real chromium run of the self-heal gate.
      await db.terminate().catch(() => {});
      worker.terminate();
      throw err;
    }
  }
  return { db: db as unknown as OpenableDuckDB, worker };
};

/** the injected event sink. `opfs_fallback` is already a declared event name in
 * `analytics/events.ts`; this tier emits it without importing that module. */
export type FallbackSink = (event: "opfs_fallback", params: { reason: string }) => void;

export interface OpenStoreOptions {
  ver: string;
  /** the published bundle's schema version -- part of the file name, so a schema change is a
   * different file rather than an in-place migration. */
  schema: string;
  /** the DuckDB ENGINE version (`bundles.ts`'s `DUCKDB_ENGINE_VERSION`, e.g. `v1.4.3`). Resolved
   * through the same dynamic import as `defaultOpenDatabase` when omitted. */
  duckdbVersion?: string;
  /** `boot.json`; used only to build the session-start digest expectation. */
  boot?: Record<string, unknown>;
  /** overrides the expectation derived from `boot` (tests, and any caller with its own naming). */
  expectedDigest?: ExpectedDigest;
  emit?: FallbackSink;
  openDatabase?: OpenDatabase;

  // --- seams (all default to the real browser APIs) ---
  keepData?: boolean;
  storage?: StorageLike | null;
  locks?: LockManagerLike | null;
  hasOpfs?: () => boolean;
  opfsRoot?: OpfsRootProvider;
  estimateQuota?: () => Promise<number | undefined>;
  now?: () => number;
  /** attach the `visibilitychange -> hidden` CHECKPOINT listener (default: when a `document`
   * exists). */
  documentRef?: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  > | null;

  // --- seeded-fault switches; both default ON and exist only so a spec can prove the gate fails
  //     without them (the same pattern as `engine.ts`'s `extensionRepository: null`) ---
  /** `false` removes every `CHECKPOINT`: the reload then finds no table. */
  checkpoint?: boolean;
  /** `false` skips the session-start digest reconcile: a stale table is then served. */
  verifyDigests?: boolean;
  /** `false` keeps existing files when the "keep data on this device" setting is off. */
  purgeWhenOff?: boolean;
}

export interface StoreBackend {
  /** which tier actually won. */
  readonly kind: "memory" | "opfs";
  /** why -- `"ok"` only when OPFS is live. */
  readonly reason: string;
  /** the db file, when one is open. */
  readonly file: string | null;
  /** `min(300 MB, 20% of quota)` for this session, or `null` on the memory tier. Exposed so the
   * gate can report the number it is asserting an eviction against instead of re-deriving it. */
  readonly budgetBytes: number | null;
  createDb(): Promise<{ db: DuckDBHandleLike; worker?: { terminate(): void } }>;
  makeStore(db: DuckDBHandleLike, raw: RawSql): TableStore;
  /** CHECKPOINT + registry update + lock release. Safe to call more than once. */
  close(): Promise<void>;
}

/**
 * Decide the tier and return a backend ready to hand to `Engine`:
 *
 * ```ts
 * const backend = await openTableStoreBackend({ ver, schema, boot, emit });
 * const engine  = new Engine({
 *   createDb: () => backend.createDb(),
 *   store:    (db, raw) => backend.makeStore(db, raw),
 * });
 * ```
 *
 * Never throws for an OPFS reason: every failure path ends in a working in-memory backend. The
 * only way this rejects is a `createDb` that cannot produce a DuckDB at all, which is the engine
 * being unavailable, not the cache.
 */
export async function openTableStoreBackend(opts: OpenStoreOptions): Promise<StoreBackend> {
  const emit: FallbackSink = opts.emit ?? (() => {});
  const openDatabase = opts.openDatabase ?? defaultOpenDatabase;
  const now = opts.now ?? (() => Date.now());
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const rootProvider = opts.opfsRoot ?? defaultOpfsRoot;

  const decision: StoreDecision = await selectStore({
    ver: opts.ver,
    keepData: opts.keepData,
    storage,
    locks: opts.locks,
    hasOpfs: opts.hasOpfs,
    probeOpfs: rootProvider,
  });
  if (isFallbackReason(decision.reason)) emit("opfs_fallback", { reason: decision.reason });

  if (decision.kind === "memory") {
    // "off = memory only AND existing files deleted": honoured on the next boot even if the
    // settings UI never got around to calling `purgeAllStoredData()` itself.
    if (decision.reason === "setting-off" && opts.purgeWhenOff !== false) {
      await purgeAllStoredData({ opfsRoot: rootProvider, storage }).catch(() => {});
    }
    return memoryBackend(decision.reason, openDatabase);
  }

  const duckdbVersion = opts.duckdbVersion ?? (await import("../bundles")).DUCKDB_ENGINE_VERSION;
  const file = opfsDbFileName({ ver: opts.ver, schema: opts.schema, duckdb: duckdbVersion });
  const lock = decision.lock;

  let dir: DirHandleLike;
  let registry: Map<string, RegistryEntry>;
  let budgetBytes: number;
  try {
    dir = (await atlasDir(rootProvider, true))!;
    // stale suffixes for THIS release only -- another release's file is the budget's business.
    const onDisk = await listDbFiles(dir);
    for (const stale of staleSiblings(
      onDisk.map((f) => f.file),
      file,
    )) {
      await deleteDbFile(dir, stale);
    }
    const remaining = onDisk.filter(
      (f) => f.file === file || parseOpfsDbFileName(f.file)?.ver !== opts.ver,
    );
    registry = reconcileRegistry(readRegistry(storage), remaining);
    budgetBytes = storeBudgetBytes(await (opts.estimateQuota ?? defaultEstimateQuota)());
  } catch {
    lock?.release();
    emit("opfs_fallback", { reason: "opfs-unavailable" });
    return memoryBackend("opfs-unavailable", openDatabase);
  }

  const expected: ExpectedDigest =
    opts.expectedDigest ?? expectedDigestFromBoot(opts.ver, opts.boot);

  // mutable session state: these flip when anything degrades.
  const state = {
    kind: "opfs" as "memory" | "opfs",
    reason: "ok",
    rows: [] as MetaRow[],
    store: null as OpfsTableStore | null,
    listener: null as (() => void) | null,
    doc: resolveDocument(opts.documentRef),
    closed: false,
    emitted: false,
  };

  const emitOnce = (reason: string) => {
    if (state.emitted) return;
    state.emitted = true;
    emit("opfs_fallback", { reason });
  };

  const degradeToMemory = async (reason: string, created?: CreatedDb) => {
    state.kind = "memory";
    state.reason = reason;
    emitOnce(reason);
    // close BEFORE delete: an open sync access handle keeps the file alive on some engines.
    await created?.db.terminate().catch(() => {});
    created?.worker?.terminate?.();
    await deleteDbFile(dir, file).catch(() => {});
    registry.delete(file);
    writeRegistry(storage, registry);
    lock?.release();
  };

  const backend: StoreBackend = {
    get kind() {
      return state.kind;
    },
    get reason() {
      return state.reason;
    },
    get file() {
      return state.kind === "opfs" ? file : null;
    },
    get budgetBytes() {
      return state.kind === "opfs" ? budgetBytes : null;
    },

    async createDb() {
      let created: CreatedDb | undefined;
      try {
        created = await openDatabase(opfsDbPath(file));
        const conn = await created.db.connect();
        try {
          await conn.query(META_DDL);
          const rows = normalizeMetaRows((await conn.query(META_SELECT)).toArray());
          const stale = opts.verifyDigests === false ? [] : planReconcile(rows, expected);
          for (const name of stale) {
            await conn.query(`DROP TABLE IF EXISTS ${ident(tableIdentifier(name))};`);
            await conn.query(`DELETE FROM _meta WHERE name = '${name.replace(/'/g, "''")}';`);
          }
          if (opts.checkpoint !== false && stale.length) await conn.query("CHECKPOINT;");
          state.rows = rows.filter((r) => !stale.includes(r.name));
        } finally {
          await conn.close().catch(() => {});
        }
        touchRegistry(registry, file, await dbFileBytes(dir, file), now());
        writeRegistry(storage, registry);
        return created;
      } catch (err) {
        // the self-heal: a corrupted file, a revoked handle, a quota failure at open -- all the
        // same response, and none of them user-visible.
        await degradeToMemory(reasonOfOpen(err), created);
        return openDatabase(null);
      }
    },

    makeStore(db, raw) {
      if (state.kind === "memory") return new MemoryTableStore(db);
      const store = new OpfsTableStore({
        raw,
        db,
        rows: state.rows,
        budgetBytes,
        otherFiles: () => otherVersionFiles(registry, file),
        deleteFile: async (victim) => {
          await deleteDbFile(dir, victim).catch(() => {});
          registry.delete(victim);
          writeRegistry(storage, registry);
        },
        onFallback: (reason) => {
          state.kind = "memory";
          state.reason = reason;
          emitOnce(reason);
          // the handle stays open (the Engine's single connection is on it) -- it is simply never
          // written to again, and `close()` deletes the file.
        },
        now,
        checkpoint: opts.checkpoint !== false,
      });
      state.store = store;
      if (state.doc) {
        const onHidden = () => {
          if (state.doc?.visibilityState === "hidden") void store.checkpoint().catch(() => {});
        };
        state.doc.addEventListener("visibilitychange", onHidden);
        state.listener = () => state.doc?.removeEventListener("visibilitychange", onHidden);
      }
      return store;
    },

    async close() {
      if (state.closed) return;
      state.closed = true;
      state.listener?.();
      state.listener = null;
      const degraded = state.store?.degraded ?? state.kind === "memory";
      try {
        if (!degraded) await state.store?.checkpoint();
      } catch {
        // a checkpoint that fails at close has nothing left to protect
      }
      try {
        if (degraded) {
          await deleteDbFile(dir, file).catch(() => {});
          registry.delete(file);
        } else {
          touchRegistry(registry, file, await dbFileBytes(dir, file), now());
        }
        writeRegistry(storage, registry);
      } catch {
        // the registry is a cache of a fact; failing to update it costs LRU accuracy, nothing more
      }
      lock?.release();
    },
  };

  return backend;
}

function memoryBackend(reason: string, openDatabase: OpenDatabase): StoreBackend {
  return {
    kind: "memory",
    reason,
    file: null,
    budgetBytes: null,
    createDb: () => openDatabase(null),
    makeStore: (db) => new MemoryTableStore(db),
    close: async () => {},
  };
}

function resolveDocument(
  ref: OpenStoreOptions["documentRef"],
): OpenStoreOptions["documentRef"] | null {
  if (ref !== undefined) return ref;
  return typeof document === "undefined" ? null : document;
}

async function defaultEstimateQuota(): Promise<number | undefined> {
  try {
    const est = await navigator.storage.estimate();
    return typeof est.quota === "number" ? est.quota : undefined;
  } catch {
    return undefined;
  }
}

/** DuckDB returns BIGINT columns as `bigint`; `_meta`'s numbers are small and must be plain
 * numbers by the time policy code compares them. */
function normalizeMetaRows(rows: readonly Record<string, unknown>[]): MetaRow[] {
  const out: MetaRow[] = [];
  for (const r of rows) {
    if (typeof r.name !== "string" || typeof r.digest !== "string") continue;
    out.push({
      name: r.name,
      digest: r.digest,
      bytes: Number(r.bytes ?? 0),
      lastUsedMs: Number(r.last_used ?? 0),
    });
  }
  return out;
}

/** open-time failures get their own coarse labels -- a file that will not open is usually corrupt
 * or gone, not a write failure. */
function reasonOfOpen(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("quota") || msg.includes("no space")) return "quota";
  if (msg.includes("access handle") || msg.includes("no modification allowed")) return "locked";
  return "corrupt";
}

// ---- the two purges (no UI in this phase, per the plan) ---------------------------------------

export interface PurgeOptions {
  opfsRoot?: OpfsRootProvider;
  storage?: StorageLike | null;
}

/**
 * The preview host's **Sign out**: delete the OPFS files of the named (restricted) releases, and
 * nothing else. A file is deleted if and only if its parsed `{ver}` is in `versions` -- a public
 * release's file is never touched, which is the seeded fault for this gate ("`purgeRestricted`
 * deleting a public release's file"). Returns the file names actually removed.
 *
 * Only files this app wrote are considered at all (`parseOpfsDbFileName` returns `null` for
 * anything else), so an unrelated origin-owned file under `atlas/` could not be deleted even if a
 * caller asked for it.
 *
 * Note it does NOT delete a file a live tab currently holds open -- it cannot, and it must not try:
 * the signing-out tab is holding its own release's lock and closes it through `backend.close()`.
 */
export async function purgeRestricted(
  versions: readonly string[],
  opts: PurgeOptions = {},
): Promise<string[]> {
  const wanted = new Set(versions);
  if (!wanted.size) return [];
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const dir = await atlasDir(opts.opfsRoot ?? defaultOpfsRoot, false);
  if (!dir) return [];
  const registry = readRegistry(storage);
  const removed: string[] = [];
  for (const entry of await listDbFiles(dir)) {
    if (!wanted.has(entry.ver)) continue;
    if (await deleteDbFile(dir, entry.file)) removed.push(entry.file);
    registry.delete(entry.file);
  }
  writeRegistry(storage, registry);
  return removed;
}

/**
 * Everything this app has stored on the device -- the other half of "keep data on this device =
 * off". Deletes every `atlas/*.duckdb` (and its WAL) and clears the registry.
 */
export async function purgeAllStoredData(opts: PurgeOptions = {}): Promise<string[]> {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const dir = await atlasDir(opts.opfsRoot ?? defaultOpfsRoot, false);
  if (!dir) {
    writeRegistry(storage, new Map());
    return [];
  }
  const removed: string[] = [];
  for (const entry of await listDbFiles(dir)) {
    if (await deleteDbFile(dir, entry.file)) removed.push(entry.file);
  }
  writeRegistry(storage, new Map());
  return removed;
}
