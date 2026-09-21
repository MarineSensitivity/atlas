// atlas-2 Step 4 (Opus half): the OPFS `TableStore` -- tier 2 (plan D3), behind the SAME interface
// `memoryStore.ts` implements, so `engine.ts`, `analysis/sources.ts` and every `sql/*.sql` twin
// never learn which backend is live.
//
// The difference from MEMORY, in one line: MEMORY registers a virtual FILE and reads it back with
// `read_parquet('name')`, which dies with the tab; OPFS materializes the same buffer into a real,
// persisted TABLE and hands back its identifier, which survives a reload with the network cut.
//
// Everything this class cannot do without a browser is delegated to something injected:
// `policy.ts` decides what to evict and what is stale, `opfsFs.ts` deletes files, the caller
// supplies the pre-read `_meta` rows and the fallback sink. What is left here -- the ordering of
// DROP/CREATE/INSERT/CHECKPOINT, and which failure degrades the session -- is exercised by the
// Playwright specs in `tests/fixtures/opfs-e2e/` against a real DuckDB and a real OPFS.
//
// **Failure policy (plan atlas-2 `store/`).** ANY OPFS error -- a failed write, a failed
// CHECKPOINT, a quota rejection -- degrades the SESSION to memory: the event sink is called exactly
// once with `opfs_fallback{reason}`, the db file is marked for deletion at close, and every
// subsequent call is served by an internal `MemoryTableStore` on the same DuckDB handle. Nothing
// user-visible changes; the same answers come back, just without the cache. A failure at OPEN time
// is handled one level up (`opfsBackend.ts`), where the handle can genuinely be closed, the file
// deleted, and a fresh in-memory DuckDB created -- that is the corrupted-file self-heal.

import { ident, lit } from "../sql";
import { MemoryTableStore, type DuckDBFileHandle } from "./memoryStore";
import { isTile, tableIdentifier } from "./opfsPaths";
import { planEviction, type MetaRow } from "./policy";
import type { RawSql, TableEntry, TableRef, TableStore } from "./TableStore";

/** the `_meta` table's exact shape (plan atlas-2 `store/`: `_meta(name, digest, bytes,
 * last_used)`). `kind` is NOT a column: it is derived from `name` by `tableKind()`, so there is one
 * source of truth for "is this a tile" and no schema to migrate when that rule changes. */
export const META_TABLE = "_meta";
export const META_DDL =
  `CREATE TABLE IF NOT EXISTS ${META_TABLE} (` +
  `name VARCHAR PRIMARY KEY, digest VARCHAR NOT NULL, bytes BIGINT NOT NULL, last_used BIGINT NOT NULL)`;
export const META_SELECT = `SELECT name, digest, bytes, last_used FROM ${META_TABLE}`;

/** the virtual-file name a buffer is briefly registered under on its way into a real table. Not a
 * store name and never visible to a caller: dropped again before `register()` returns. */
const LOAD_FILE = "__atlas_opfs_load__";

/** what the store needs from whoever opened the file. */
export interface OpfsStoreContext {
  /** every statement goes through here (see `RawSql`'s own note on why it bypasses the chain). */
  raw: RawSql;
  /** for the brief `registerFileBuffer` -> `CREATE TABLE AS SELECT` hop, and for the memory
   * fallback after a degrade. */
  db: DuckDBFileHandle;
  /** rows already read from `_meta` and already reconciled against `boot.tables[*].digest`
   * (`policy.ts`'s `planReconcile`), at session start, before this store existed. */
  rows: readonly MetaRow[];
  /** `min(300 MB, 20% of quota)`, computed once at open. */
  budgetBytes: number;
  /** other releases' files and their sizes/last-use, for the ACROSS-versions budget. */
  otherFiles: () => { file: string; ver: string; bytes: number; lastUsedMs: number }[];
  /** delete one other release's whole db file (+ its WAL). */
  deleteFile: (file: string) => Promise<void>;
  /** called at most once per session, with the reason, when OPFS stops being usable. The analytics
   * module is NOT imported here (plan: "through an injected event sink ... do not import it here,
   * take a callback"). */
  onFallback: (reason: string) => void;
  /** wall clock, not `performance.now()`: `last_used` persists across sessions, so its ordering has
   * to mean something after a reload. Injected for deterministic tests. */
  now?: () => number;
  /** `false` ONLY for the seeded fault "CHECKPOINT removed" -- without it a reload finds no table
   * (`docs/spikes/S1.md` rule 6: explicit CHECKPOINT before close). */
  checkpoint?: boolean;
}

export class OpfsTableStore implements TableStore {
  readonly kind = "opfs";
  #meta = new Map<string, MetaRow>();
  #ctx: OpfsStoreContext;
  #now: () => number;
  #checkpoint: boolean;
  #degraded = false;
  #memory: MemoryTableStore;

  constructor(ctx: OpfsStoreContext) {
    this.#ctx = ctx;
    this.#now = ctx.now ?? (() => Date.now());
    this.#checkpoint = ctx.checkpoint !== false;
    this.#memory = new MemoryTableStore(ctx.db);
    for (const r of ctx.rows) this.#meta.set(r.name, { ...r });
  }

  /** true once an OPFS error has demoted this session to memory. Nothing user-visible changes; the
   * gate asserts identical answers either way. */
  get degraded(): boolean {
    return this.#degraded;
  }

  async register(name: string, digest: string, buffer: Uint8Array): Promise<TableRef> {
    if (this.#degraded) return this.#memory.register(name, digest, buffer);

    const existing = this.#meta.get(name);
    if (existing && existing.digest === digest) {
      // idempotent: already materialized under this exact digest. Still a USE, so `last_used`
      // moves -- that is what keeps a hot tile from being evicted under a cold one.
      await this.touch(name);
      return { from: ident(tableIdentifier(name)) };
    }

    // measure BEFORE anything registers it: `registerFileBuffer` TRANSFERS (and so detaches) the
    // buffer, and `byteLength` afterwards is 0 -- see `memoryStore.ts`'s note on the same line.
    // With a 0 here the whole LRU budget silently becomes a no-op, which is exactly what the
    // eviction gate caught on its first real-browser run.
    const bytes = buffer.byteLength;
    try {
      if (existing) await this.#dropTable(name); // a changed digest replaces the stale table
      await this.#evictFor(bytes);

      const table = ident(tableIdentifier(name));
      // hand the worker a COPY, not the caller's buffer. `registerFileBuffer` transfers, and if the
      // `CREATE TABLE` below then fails, the degrade path has to re-register the very same bytes
      // into the memory tier -- with the original detached there would be nothing left to fall back
      // WITH, and "any OPFS error falls back transparently" would become "any OPFS error loses the
      // table". The cost is one extra allocation of at most the 25 MB materialize guard, for the
      // few milliseconds until `dropFile` releases it.
      await this.#ctx.db.registerFileBuffer(LOAD_FILE, new Uint8Array(buffer));
      try {
        await this.#ctx.raw(
          `CREATE OR REPLACE TABLE ${table} AS SELECT * FROM read_parquet(${lit(LOAD_FILE)});`,
        );
      } finally {
        await this.#ctx.db.dropFile(LOAD_FILE).catch(() => {});
      }

      const row: MetaRow = { name, digest, bytes, lastUsedMs: this.#now() };
      await this.#ctx.raw(`DELETE FROM ${META_TABLE} WHERE name = ${lit(name)};`);
      await this.#ctx.raw(
        `INSERT INTO ${META_TABLE} VALUES (${lit(row.name)}, ${lit(row.digest)}, ${lit(row.bytes)}, ${lit(row.lastUsedMs)});`,
      );
      this.#meta.set(name, row);
      // "CHECKPOINT after each batch": one register IS one batch's worth of writes, and a
      // checkpoint per table is strictly stronger than per batch. It is what puts the bytes in the
      // DATABASE file -- MEASURED in the browser gate: ~3.2 MB in the `.duckdb` with it, a 12,288 B
      // empty header without, the data sitting in the preallocated WAL instead. (duckdb-wasm does
      // persist and replay that WAL, so a plain reload survives without it -- but this app's own
      // stale sweep and self-heal delete a WAL with its database, and no other tab replays it.)
      await this.checkpoint();
      return { from: table };
    } catch (err) {
      this.#degrade(err);
      return this.#memory.register(name, digest, buffer);
    }
  }

  has(name: string, digest?: string): boolean {
    const row = this.#meta.get(name);
    if (row) return digest === undefined || row.digest === digest;
    return this.#memory.has(name, digest);
  }

  ref(name: string): TableRef | undefined {
    if (this.#meta.has(name)) return { from: ident(tableIdentifier(name)) };
    return this.#memory.ref(name);
  }

  get(name: string): TableEntry | undefined {
    const row = this.#meta.get(name);
    if (row)
      return { name: row.name, digest: row.digest, bytes: row.bytes, lastUsedMs: row.lastUsedMs };
    return this.#memory.get(name);
  }

  list(): TableEntry[] {
    const rows = [...this.#meta.values()].map((r) => ({
      name: r.name,
      digest: r.digest,
      bytes: r.bytes,
      lastUsedMs: r.lastUsedMs,
    }));
    return [...rows, ...this.#memory.list()];
  }

  async drop(name: string): Promise<void> {
    if (this.#meta.has(name) && !this.#degraded) {
      try {
        await this.#dropTable(name);
        return;
      } catch (err) {
        this.#degrade(err);
      }
    }
    await this.#memory.drop(name);
  }

  bytesUsed(): number {
    let total = 0;
    for (const r of this.#meta.values()) total += r.bytes;
    return total + this.#memory.bytesUsed();
  }

  /**
   * `CHECKPOINT` -- flush the WAL into the database file. Called after every `register()` and, by
   * the backend, on `visibilitychange -> hidden` and before close (`docs/spikes/S1.md` rule 6).
   * A no-op once degraded (there is nothing left to checkpoint into).
   */
  async checkpoint(): Promise<void> {
    if (this.#degraded || !this.#checkpoint) return;
    await this.#ctx.raw("CHECKPOINT;");
  }

  async touch(name: string): Promise<void> {
    const row = this.#meta.get(name);
    if (!row) return this.#memory.touch(name);
    if (this.#degraded) return;
    row.lastUsedMs = this.#now();
    try {
      await this.#ctx.raw(
        `UPDATE ${META_TABLE} SET last_used = ${lit(row.lastUsedMs)} WHERE name = ${lit(name)};`,
      );
    } catch (err) {
      this.#degrade(err);
    }
  }

  async #dropTable(name: string): Promise<void> {
    await this.#ctx.raw(`DROP TABLE IF EXISTS ${ident(tableIdentifier(name))};`);
    await this.#ctx.raw(`DELETE FROM ${META_TABLE} WHERE name = ${lit(name)};`);
    this.#meta.delete(name);
  }

  /** run `policy.ts`'s plan: LRU tiles of this file first, then whole stale versions. */
  async #evictFor(incomingBytes: number): Promise<void> {
    const plan = planEviction({
      budgetBytes: this.#ctx.budgetBytes,
      incomingBytes,
      tables: [...this.#meta.values()].map((r) => ({
        name: r.name,
        bytes: r.bytes,
        lastUsedMs: r.lastUsedMs,
      })),
      otherFiles: this.#ctx.otherFiles(),
    });
    for (const victim of plan.dropTables) await this.#dropTable(victim);
    for (const file of plan.deleteFiles) await this.#ctx.deleteFile(file);
  }

  /** one-way, once per session. */
  #degrade(err: unknown): void {
    if (this.#degraded) return;
    this.#degraded = true;
    this.#ctx.onFallback(reasonOf(err));
  }
}

/**
 * A short, STABLE reason label for `opfs_fallback{reason}`. Never the raw engine message: S1 rule 5
 * is explicit that OPFS rejection texts differ per engine ("Access Handles cannot be created..." vs
 * "No modification allowed:"), so matching on them is not portable -- and a raw message is also the
 * one place a file path could leak into an analytics payload. The classification is coarse on
 * purpose; the shape of the failure is what is worth counting.
 */
export function reasonOf(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("quota") || msg.includes("no space") || msg.includes("storage full"))
    return "quota";
  if (msg.includes("checkpoint")) return "checkpoint";
  if (msg.includes("corrupt") || msg.includes("not a valid duckdb") || msg.includes("catalog"))
    return "corrupt";
  if (msg.includes("access handle") || msg.includes("no modification allowed")) return "locked";
  return "write";
}

/** exported for the tests that assert which rows the budget may touch. */
export { isTile };
