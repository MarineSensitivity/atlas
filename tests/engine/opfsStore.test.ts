// atlas-2 Step 4: the OPFS store's own behaviour, against a fake DuckDB. The real DuckDB + real
// OPFS story is the Playwright gate (`tests/fixtures/opfs-e2e/`); what is asserted here is the
// part that is pure decision-making -- the statement ORDER, the idempotence rule, the `_meta`
// bookkeeping, and the degrade-to-memory contract on every failure.
import { describe, expect, it, vi } from "vitest";
import { OpfsTableStore, reasonOf } from "../../src/lib/engine/store/opfsStore";
import { tableIdentifier } from "../../src/lib/engine/store/opfsPaths";
import type { MetaRow } from "../../src/lib/engine/store/policy";
import { fakeDb } from "./opfsFakes";

const MB = 1024 * 1024;
const TAXON = "v9/app/taxon.parquet";
const tile = (n: number) => `v9/serve/cell_model/tile=${n}/data_0.parquet`;
const BUF = (n = 8) => new Uint8Array(n);

function makeStore(
  over: {
    rows?: MetaRow[];
    budgetBytes?: number;
    otherFiles?: { file: string; ver: string; bytes: number; lastUsedMs: number }[];
    checkpoint?: boolean;
  } = {},
) {
  const db = fakeDb();
  const onFallback = vi.fn();
  const deleteFile = vi.fn(async () => {});
  let clock = 1000;
  const store = new OpfsTableStore({
    raw: db.raw,
    db,
    rows: over.rows ?? [],
    budgetBytes: over.budgetBytes ?? 300 * MB,
    otherFiles: () => over.otherFiles ?? [],
    deleteFile,
    onFallback,
    now: () => ++clock,
    checkpoint: over.checkpoint,
  });
  return { store, db, onFallback, deleteFile };
}

describe("OpfsTableStore.register", () => {
  it("materializes a real TABLE and returns its identifier as the FROM ref", async () => {
    const { store, db } = makeStore();
    const ref = await store.register(TAXON, "T1", BUF());
    expect(ref.from).toBe(`"${tableIdentifier(TAXON)}"`);
    expect(store.ref(TAXON)).toEqual(ref);
    expect(
      db.sql.some((s) => s.startsWith(`CREATE OR REPLACE TABLE "${tableIdentifier(TAXON)}"`)),
    ).toBe(true);
  });

  it("drops the temporary virtual file again, so no buffer is kept alive in the worker", async () => {
    const { store, db } = makeStore();
    await store.register(TAXON, "T1", BUF());
    expect(db.dropped).toEqual(["__atlas_opfs_load__"]);
    expect(db.registered.size).toBe(0);
  });

  // what CHECKPOINT actually buys is MEASURED in the browser gate (`tests/fixtures/opfs-e2e`):
  // the table ends up in the DATABASE file (~3.2 MB) instead of only in the preallocated WAL
  // (the db file stays a 12,288 B header). NOT "a reload finds no table" -- duckdb-wasm persists
  // the WAL in OPFS and replays it, so a reload survives either way.
  it("CHECKPOINTs after the write, so the bytes reach the database file", async () => {
    const { store, db } = makeStore();
    await store.register(TAXON, "T1", BUF());
    expect(db.sql.at(-1)).toBe("CHECKPOINT;");
  });

  it("(seeded fault) checkpoint:false issues no CHECKPOINT at all", async () => {
    const { store, db } = makeStore({ checkpoint: false });
    await store.register(TAXON, "T1", BUF());
    expect(db.sql.some((s) => s.includes("CHECKPOINT"))).toBe(false);
  });

  it("is idempotent on the same name+digest: no re-create, but last_used moves", async () => {
    const { store, db } = makeStore();
    await store.register(TAXON, "T1", BUF());
    const first = store.get(TAXON)!.lastUsedMs;
    db.sql.length = 0;
    await store.register(TAXON, "T1", BUF());
    expect(db.sql.some((s) => s.includes("CREATE OR REPLACE TABLE"))).toBe(false);
    expect(db.sql.some((s) => s.startsWith("UPDATE _meta SET last_used"))).toBe(true);
    expect(store.get(TAXON)!.lastUsedMs).toBeGreaterThan(first);
  });

  it("a CHANGED digest drops the stale table first, then re-materializes exactly that one", async () => {
    const { store, db } = makeStore();
    await store.register(TAXON, "T1", BUF());
    await store.register("v9/app/zone_taxon.parquet", "Z1", BUF());
    db.sql.length = 0;
    await store.register(TAXON, "T2", BUF(16));
    const dropIdx = db.sql.findIndex((s) =>
      s.startsWith(`DROP TABLE IF EXISTS "${tableIdentifier(TAXON)}"`),
    );
    const createIdx = db.sql.findIndex((s) => s.startsWith("CREATE OR REPLACE TABLE"));
    expect(dropIdx).toBeGreaterThanOrEqual(0);
    expect(dropIdx).toBeLessThan(createIdx);
    expect(store.get(TAXON)).toMatchObject({ digest: "T2", bytes: 16 });
    expect(store.get("v9/app/zone_taxon.parquet"), "the neighbour is untouched").toMatchObject({
      digest: "Z1",
    });
  });

  it("touch() records a cache HIT as a use, in _meta and in memory", async () => {
    const { store, db } = makeStore({
      rows: [{ name: tile(1), digest: "d", bytes: 10, lastUsedMs: 5 }],
    });
    db.sql.length = 0;
    await store.touch(tile(1));
    expect(store.get(tile(1))!.lastUsedMs).toBeGreaterThan(5);
    expect(db.sql.some((s) => s.startsWith("UPDATE _meta SET last_used"))).toBe(true);
  });

  it("touch() on an unknown name is a no-op", async () => {
    const { store, db } = makeStore();
    await store.touch("nope");
    expect(db.sql).toEqual([]);
  });

  it("has() is digest-strict, which is what makes Engine#load skip a re-fetch on reload", async () => {
    const rows: MetaRow[] = [{ name: TAXON, digest: "T1", bytes: 10, lastUsedMs: 5 }];
    const { store } = makeStore({ rows });
    expect(store.has(TAXON)).toBe(true);
    expect(store.has(TAXON, "T1")).toBe(true);
    expect(store.has(TAXON, "T2")).toBe(false);
    expect(store.ref(TAXON)!.from).toBe(`"${tableIdentifier(TAXON)}"`);
  });
});

describe("OpfsTableStore eviction", () => {
  it("evicts the least-recently-used TILE before writing a table that would not fit", async () => {
    const rows: MetaRow[] = [
      { name: tile(1), bytes: 10 * MB, lastUsedMs: 100 },
      { name: tile(2), bytes: 10 * MB, lastUsedMs: 900 },
    ].map((r) => ({ ...r, digest: "d" }));
    const { store, db } = makeStore({ rows, budgetBytes: 25 * MB });
    await store.register(tile(3), "d", BUF(10 * MB));
    expect(
      db.sql.some((s) => s.startsWith(`DROP TABLE IF EXISTS "${tableIdentifier(tile(1))}"`)),
    ).toBe(true);
    expect(
      db.sql.some((s) => s.startsWith(`DROP TABLE IF EXISTS "${tableIdentifier(tile(2))}"`)),
    ).toBe(false);
    expect(store.has(tile(1))).toBe(false);
    expect(store.has(tile(2))).toBe(true);
  });

  it("deletes a whole stale version's file once its own tiles are gone", async () => {
    const rows: MetaRow[] = [{ name: tile(1), digest: "d", bytes: 10 * MB, lastUsedMs: 1 }];
    const { store, deleteFile } = makeStore({
      rows,
      budgetBytes: 15 * MB,
      otherFiles: [{ file: "v7.s1.dv1.4.3.duckdb", ver: "v7", bytes: 20 * MB, lastUsedMs: 1 }],
    });
    await store.register(tile(2), "d", BUF(10 * MB));
    expect(deleteFile).toHaveBeenCalledExactlyOnceWith("v7.s1.dv1.4.3.duckdb");
  });
});

describe("OpfsTableStore degrade-to-memory", () => {
  it("any write failure emits opfs_fallback ONCE and still answers from memory", async () => {
    const { store, db, onFallback } = makeStore();
    db.failOn = "CREATE OR REPLACE TABLE";
    const ref = await store.register(TAXON, "T1", BUF());
    expect(store.degraded).toBe(true);
    expect(onFallback).toHaveBeenCalledExactlyOnceWith("write");
    expect(ref.from, "the answer still comes back -- through the memory tier").toBe(
      "read_parquet('v9/app/taxon.parquet')",
    );
    expect(store.has(TAXON, "T1")).toBe(true);

    db.failOn = null;
    await store.register("v9/app/zone_taxon.parquet", "Z1", BUF());
    expect(onFallback, "exactly once per session").toHaveBeenCalledTimes(1);
  });

  it("records the REAL size although registerFileBuffer detaches the buffer (regression)", async () => {
    const { store } = makeStore();
    const buf = BUF(4096);
    await store.register(TAXON, "T1", buf);
    expect(store.get(TAXON)?.bytes, "measured before the transfer, not after").toBe(4096);
    expect(store.bytesUsed()).toBe(4096);
  });

  it("the memory fallback still has the bytes after a mid-write failure (regression)", async () => {
    // the OPFS path hands the worker a COPY; had it handed over the caller's buffer, the transfer
    // would have detached it and this fallback would throw on a detached ArrayBuffer instead of
    // answering.
    const { store, db } = makeStore();
    db.failOn = "CREATE OR REPLACE TABLE";
    const ref = await store.register(TAXON, "T1", BUF(2048));
    expect(ref.from).toBe("read_parquet('v9/app/taxon.parquet')");
    expect(store.get(TAXON)?.bytes).toBe(2048);
  });

  it("a failed CHECKPOINT degrades too (it is an OPFS error like any other)", async () => {
    const { store, db, onFallback } = makeStore();
    db.failOn = "CHECKPOINT";
    await store.register(TAXON, "T1", BUF());
    expect(store.degraded).toBe(true);
    expect(onFallback).toHaveBeenCalledExactlyOnceWith("checkpoint");
  });

  it("after degrading, checkpoint() is a no-op and nothing else is written to the file", async () => {
    const { store, db } = makeStore();
    db.failOn = "CREATE OR REPLACE TABLE";
    await store.register(TAXON, "T1", BUF());
    db.sql.length = 0;
    await store.checkpoint();
    expect(db.sql).toEqual([]);
  });
});

describe("reasonOf", () => {
  it("classifies coarsely and never leaks the engine's raw message", () => {
    expect(reasonOf(new Error("QuotaExceededError: storage quota"))).toBe("quota");
    expect(reasonOf(new Error("Access Handles cannot be created"))).toBe("locked");
    expect(reasonOf(new Error("No modification allowed:"))).toBe("locked");
    expect(reasonOf(new Error("Catalog Error: Table with name t does not exist!"))).toBe("corrupt");
    expect(reasonOf(new Error("something else entirely"))).toBe("write");
    for (const e of ["quota", "locked", "corrupt", "write"]) expect(e).not.toMatch(/opfs:\/\//);
  });
});
