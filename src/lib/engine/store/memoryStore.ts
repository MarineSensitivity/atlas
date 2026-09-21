// atlas-2 Step 3 (Sonnet half): the MEMORY `TableStore` -- the default, always-works backend (plan
// `store/`: "**memory** (default, always works) and **opfs**"). Every registered table is a
// duckdb-wasm virtual file (`AsyncDuckDB.registerFileBuffer`), read back with `read_parquet('name')`
// -- the app's tables are Parquet only (plan `engine/`), so that's the one wrapper this store needs.
import { lit } from "../sql";
import type { TableEntry, TableRef, TableStore } from "./TableStore";

/** the slice of `AsyncDuckDB` this store needs -- kept minimal and structural (not imported from
 * `@duckdb/duckdb-wasm` directly) so a plain stub satisfies it in a Vitest unit test with no real
 * DuckDB instance, worker or WASM module involved. */
export interface DuckDBFileHandle {
  registerFileBuffer(name: string, buffer: Uint8Array): Promise<void>;
  // `Promise<unknown>`, not `Promise<void>`: the real `AsyncDuckDB.dropFile()` resolves
  // `Promise<null>`, which structurally satisfies this but not the stricter `void`.
  dropFile(name: string): Promise<unknown>;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export class MemoryTableStore implements TableStore {
  readonly kind = "memory";
  #entries = new Map<string, TableEntry>();
  #db: DuckDBFileHandle;

  constructor(db: DuckDBFileHandle) {
    this.#db = db;
  }

  async register(name: string, digest: string, buffer: Uint8Array): Promise<TableRef> {
    const existing = this.#entries.get(name);
    if (existing && existing.digest === digest) {
      existing.lastUsedMs = nowMs(); // idempotent: same name+digest already registered, touch only
      return { from: `read_parquet(${lit(name)})` };
    }
    if (existing) await this.drop(name); // a different digest replaces the stale registration

    // MEASURE BEFORE REGISTERING (atlas-2 Step 4 regression): duckdb-wasm's `registerFileBuffer`
    // TRANSFERS the buffer into the worker, which DETACHES it -- `buffer.byteLength` afterwards is
    // 0, not the size. Read against a stub that merely stores the array this is invisible, which is
    // why it survived Step 3; against a real DuckDB every `bytes` was 0 and the OPFS tier's LRU
    // budget therefore thought nothing ever cost anything.
    const bytes = buffer.byteLength;
    await this.#db.registerFileBuffer(name, buffer);
    this.#entries.set(name, { name, digest, bytes, lastUsedMs: nowMs() });
    return { from: `read_parquet(${lit(name)})` };
  }

  has(name: string, digest?: string): boolean {
    const e = this.#entries.get(name);
    if (!e) return false;
    return digest === undefined || e.digest === digest;
  }

  async touch(name: string): Promise<void> {
    const e = this.#entries.get(name);
    if (e) e.lastUsedMs = nowMs();
  }

  get(name: string): TableEntry | undefined {
    return this.#entries.get(name);
  }

  ref(name: string): TableRef | undefined {
    return this.#entries.has(name) ? { from: `read_parquet(${lit(name)})` } : undefined;
  }

  list(): TableEntry[] {
    return [...this.#entries.values()];
  }

  async drop(name: string): Promise<void> {
    if (!this.#entries.has(name)) return;
    await this.#db.dropFile(name);
    this.#entries.delete(name);
  }

  bytesUsed(): number {
    let total = 0;
    for (const e of this.#entries.values()) total += e.bytes;
    return total;
  }
}
