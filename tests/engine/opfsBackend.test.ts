// atlas-2 Step 4: the orchestration around the store -- the stale-suffix sweep, the session-start
// `_meta` reconcile, the corrupted-file self-heal, the cross-version registry, the lock's lifetime,
// and the two purges. All against fakes, so each rule has its own named failure.
import { describe, expect, it, vi } from "vitest";
import {
  openTableStoreBackend,
  purgeAllStoredData,
  purgeRestricted,
  type CreatedDb,
} from "../../src/lib/engine/store/opfsBackend";
import { REGISTRY_KEY } from "../../src/lib/engine/store/registry";
import { tableIdentifier } from "../../src/lib/engine/store/opfsPaths";
import { fakeDb, fakeLocks, fakeOpfsRoot, fakeStorage, rejectingOpfsRoot, tick } from "./opfsFakes";

const V9 = "v9.s1.dv1.4.3.duckdb";
const BOOT = { tables: { taxon: { digest: "T2" }, cell: { digest: "C2" } } };

function harness(
  over: {
    files?: Record<string, number>;
    locks?: ReturnType<typeof fakeLocks>;
    storage?: ReturnType<typeof fakeStorage>;
    metaRows?: Record<string, unknown>[];
    failOpen?: string | null;
    keepData?: boolean;
    quota?: number;
    verifyDigests?: boolean;
    opfsRoot?: () => Promise<never> | ReturnType<typeof fakeOpfsRoot>["root"] extends never
      ? never
      : ReturnType<ReturnType<typeof fakeOpfsRoot>["root"]>;
  } = {},
) {
  const fs = fakeOpfsRoot(over.files ?? {});
  const locks = over.locks ?? fakeLocks();
  const storage = over.storage ?? fakeStorage();
  const emit = vi.fn();
  const dbs: ReturnType<typeof fakeDb>[] = [];
  const openDatabase = vi.fn(async (path: string | null): Promise<CreatedDb> => {
    const db = fakeDb();
    db.metaRows = over.metaRows ?? [];
    if (path && over.failOpen) db.failOpen = over.failOpen;
    dbs.push(db);
    await db.open(path ? { path } : {});
    return { db: db as unknown as CreatedDb["db"], worker: { terminate: () => {} } };
  });
  const open = () =>
    openTableStoreBackend({
      ver: "v9",
      schema: "1",
      duckdbVersion: "v1.4.3",
      boot: BOOT,
      emit,
      openDatabase,
      locks,
      storage,
      hasOpfs: () => true,
      opfsRoot: (over.opfsRoot ?? fs.root) as never,
      estimateQuota: async () => over.quota,
      keepData: over.keepData,
      verifyDigests: over.verifyDigests,
      documentRef: null,
      now: () => 5_000,
    });
  return { fs, locks, storage, emit, dbs, openDatabase, open };
}

describe("openTableStoreBackend -- tier selection", () => {
  it("opens the release's own opfs:// file and holds the lock for its lifetime", async () => {
    const h = harness();
    const backend = await h.open();
    expect(backend.kind).toBe("opfs");
    expect(backend.file).toBe(V9);
    await backend.createDb();
    expect(h.openDatabase).toHaveBeenCalledWith(`opfs://atlas/${V9}`);
    expect(h.locks.held.has("atlas-opfs-v9"), "held while the handle is open").toBe(true);
    await backend.close();
    await tick();
    expect(h.locks.held.has("atlas-opfs-v9"), "released on close").toBe(false);
  });

  it("a second tab runs in memory, never opens the file and emits no fallback event", async () => {
    const h = harness({ locks: fakeLocks(["atlas-opfs-v9"]) });
    const backend = await h.open();
    expect(backend.kind).toBe("memory");
    expect(backend.reason).toBe("lock-held");
    await backend.createDb();
    expect(h.openDatabase).toHaveBeenCalledWith(null);
    expect(h.emit, "a second tab is normal, not a failure").not.toHaveBeenCalled();
  });

  it("storage denied -> memory, one opfs_fallback for analytics, nothing user-visible", async () => {
    const h = harness({ opfsRoot: rejectingOpfsRoot() as never });
    const backend = await h.open();
    expect(backend.kind).toBe("memory");
    expect(h.emit).toHaveBeenCalledExactlyOnceWith("opfs_fallback", {
      reason: "opfs-unavailable",
    });
    const store = backend.makeStore((await backend.createDb()).db, async () => []);
    expect(store.kind).toBe("memory");
  });

  it('"keep data on this device" off -> memory AND the existing files are deleted', async () => {
    const h = harness({ keepData: false, files: { [V9]: 10, "v7.s1.dv1.4.3.duckdb": 20 } });
    const backend = await h.open();
    expect(backend.kind).toBe("memory");
    expect(backend.reason).toBe("setting-off");
    expect([...h.fs.atlas.files.keys()]).toEqual([]);
    expect(h.emit, "a deliberate setting is not a fallback event").not.toHaveBeenCalled();
  });
});

describe("openTableStoreBackend -- boot housekeeping", () => {
  it("deletes stale-suffix files of THIS release and leaves other releases alone", async () => {
    const h = harness({
      files: {
        [V9]: 10,
        "v9.s0.dv1.4.3.duckdb": 10, // stale schema
        "v9.s1.dv1.4.2.duckdb": 10, // stale duckdb engine
        "v7b.s1.dv1.4.3.duckdb": 10, // another release: not stale
        "notes.txt": 1,
      },
    });
    await h.open();
    expect([...h.fs.atlas.files.keys()].sort()).toEqual(
      ["notes.txt", V9, "v7b.s1.dv1.4.3.duckdb"].sort(),
    );
  });

  it("takes the stale file's .wal with it", async () => {
    const h = harness({
      files: { [V9]: 10, "v9.s0.dv1.4.3.duckdb": 10, "v9.s0.dv1.4.3.duckdb.wal": 1 },
    });
    await h.open();
    expect(h.fs.atlas.files.has("v9.s0.dv1.4.3.duckdb.wal")).toBe(false);
  });

  it("drops exactly the _meta rows whose boot digest changed, at session start", async () => {
    const h = harness({
      metaRows: [
        { name: "v9/app/taxon.parquet", digest: "T1", bytes: 10, last_used: 1 }, // stale
        { name: "v9/app/zone_taxon.parquet", digest: "Z1", bytes: 10, last_used: 1 }, // no opinion
        { name: "v9/app/cell/tile=3/data_0.parquet", digest: "C2:3", bytes: 10, last_used: 1 },
      ],
    });
    const backend = await h.open();
    await backend.createDb();
    const sql = h.dbs[0].sql;
    expect(
      sql.some((s) =>
        s.includes(`DROP TABLE IF EXISTS "${tableIdentifier("v9/app/taxon.parquet")}"`),
      ),
    ).toBe(true);
    expect(sql.some((s) => s.includes(tableIdentifier("v9/app/cell/tile=3/data_0.parquet")))).toBe(
      false,
    );

    // the surviving rows are handed to the store, so a reload answers `has()` without a re-fetch
    const store = backend.makeStore(h.dbs[0] as never, h.dbs[0].raw);
    expect(store.has("v9/app/taxon.parquet")).toBe(false);
    expect(store.has("v9/app/zone_taxon.parquet", "Z1")).toBe(true);
  });

  it("(seeded fault) verifyDigests:false serves the stale table instead", async () => {
    const h = harness({
      verifyDigests: false,
      metaRows: [{ name: "v9/app/taxon.parquet", digest: "T1", bytes: 10, last_used: 1 }],
    });
    const backend = await h.open();
    await backend.createDb();
    const store = backend.makeStore(h.dbs[0] as never, h.dbs[0].raw);
    expect(store.has("v9/app/taxon.parquet"), "stale row survives the skipped reconcile").toBe(
      true,
    );
  });
});

describe("openTableStoreBackend -- the corrupted-file self-heal", () => {
  it("deletes the file, falls back to memory, and emits opfs_fallback exactly once", async () => {
    const h = harness({
      files: { [V9]: 4096, [`${V9}.wal`]: 8 },
      failOpen: "IO Error: Database file is corrupt",
    });
    const backend = await h.open();
    const { db } = await backend.createDb();
    expect(backend.kind).toBe("memory");
    expect(h.emit).toHaveBeenCalledExactlyOnceWith("opfs_fallback", { reason: "corrupt" });
    expect(h.fs.atlas.files.has(V9), "the bad file is gone").toBe(false);
    expect(h.fs.atlas.files.has(`${V9}.wal`), "and so is its WAL").toBe(false);
    expect(h.openDatabase).toHaveBeenLastCalledWith(null);
    expect(backend.makeStore(db, async () => []).kind).toBe("memory");
    await tick();
    expect(h.locks.held.size, "the lock is handed back on the self-heal path").toBe(0);
  });
});

describe("openTableStoreBackend -- the cross-version registry", () => {
  it("records this release's file size and last use for other tabs' budgets", async () => {
    const h = harness({ files: { [V9]: 1234, "v7.s1.dv1.4.3.duckdb": 999 } });
    const backend = await h.open();
    await backend.createDb();
    await backend.close();
    const reg = JSON.parse(h.storage.map.get(REGISTRY_KEY)!);
    expect(reg[V9]).toEqual({ bytes: 1234, lastUsedMs: 5000 });
    expect(reg["v7.s1.dv1.4.3.duckdb"]).toEqual({ bytes: 999, lastUsedMs: 0 });
  });

  it("drops registry rows for files that are no longer on disk", async () => {
    const storage = fakeStorage({
      [REGISTRY_KEY]: JSON.stringify({ "v6.s1.dv1.4.3.duckdb": { bytes: 1, lastUsedMs: 1 } }),
    });
    const h = harness({ storage, files: { [V9]: 10 } });
    await (await h.open()).close();
    expect(JSON.parse(storage.map.get(REGISTRY_KEY)!)["v6.s1.dv1.4.3.duckdb"]).toBeUndefined();
  });
});

describe("purgeRestricted (the preview host's Sign out)", () => {
  const files = () => ({
    "v9.s1.dv1.4.3.duckdb": 10, // restricted
    "v9.s1.dv1.4.3.duckdb.wal": 2,
    "v8.s1.dv1.4.3.duckdb": 10, // restricted
    "v7.s1.dv1.4.3.duckdb": 10, // PUBLIC -- must survive
    "notes.txt": 1,
  });

  it("removes only the named versions' files (and their WALs)", async () => {
    const fs = fakeOpfsRoot(files());
    const storage = fakeStorage();
    const removed = await purgeRestricted(["v9", "v8"], { opfsRoot: fs.root as never, storage });
    expect(removed.sort()).toEqual(["v8.s1.dv1.4.3.duckdb", "v9.s1.dv1.4.3.duckdb"]);
    expect([...fs.atlas.files.keys()].sort()).toEqual(["notes.txt", "v7.s1.dv1.4.3.duckdb"]);
  });

  it("a public release's file is NEVER deleted (the seeded fault for this gate)", async () => {
    const fs = fakeOpfsRoot(files());
    await purgeRestricted(["v9"], { opfsRoot: fs.root as never, storage: fakeStorage() });
    expect(fs.atlas.files.has("v7.s1.dv1.4.3.duckdb")).toBe(true);
    expect(fs.atlas.files.has("v8.s1.dv1.4.3.duckdb")).toBe(true);
  });

  it("an empty version list deletes nothing at all", async () => {
    const fs = fakeOpfsRoot(files());
    expect(
      await purgeRestricted([], { opfsRoot: fs.root as never, storage: fakeStorage() }),
    ).toEqual([]);
    expect(fs.atlas.files.size).toBe(5);
  });

  it("is a no-op when this app has never written anything", async () => {
    const empty = {
      root: async () => ({
        getDirectoryHandle: async () => {
          const e = new Error("x");
          e.name = "NotFoundError";
          throw e;
        },
      }),
    };
    await expect(
      purgeRestricted(["v9"], { opfsRoot: empty.root as never, storage: fakeStorage() }),
    ).resolves.toEqual([]);
  });
});

describe("purgeAllStoredData", () => {
  it("removes every release's file and clears the registry", async () => {
    const fs = fakeOpfsRoot({ [V9]: 10, "v7.s1.dv1.4.3.duckdb": 10, "notes.txt": 1 });
    const storage = fakeStorage({
      [REGISTRY_KEY]: JSON.stringify({ [V9]: { bytes: 10, lastUsedMs: 1 } }),
    });
    const removed = await purgeAllStoredData({ opfsRoot: fs.root as never, storage });
    expect(removed.sort()).toEqual([V9, "v7.s1.dv1.4.3.duckdb"].sort());
    expect([...fs.atlas.files.keys()]).toEqual(["notes.txt"]);
    expect(storage.map.get(REGISTRY_KEY)).toBe("{}");
  });
});
