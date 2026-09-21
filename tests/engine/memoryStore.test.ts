import { describe, expect, it, vi } from "vitest";
import { MemoryTableStore, type DuckDBFileHandle } from "../../src/lib/engine/store/memoryStore";

function stubDb(): DuckDBFileHandle & {
  registerFileBuffer: ReturnType<typeof vi.fn>;
  dropFile: ReturnType<typeof vi.fn>;
} {
  return {
    registerFileBuffer: vi.fn().mockResolvedValue(undefined),
    dropFile: vi.fn().mockResolvedValue(undefined),
  };
}

const BUF_A = new Uint8Array([1, 2, 3, 4]);
const BUF_B = new Uint8Array([9, 8, 7]);

describe("MemoryTableStore", () => {
  it("registers a table and returns a read_parquet(...) FROM ref", async () => {
    const db = stubDb();
    const store = new MemoryTableStore(db);
    const ref = await store.register("taxon", "digest-1", BUF_A);
    expect(ref.from).toBe("read_parquet('taxon')");
    expect(db.registerFileBuffer).toHaveBeenCalledExactlyOnceWith("taxon", BUF_A);
  });

  it("is idempotent: registering the same name+digest again does not re-register or re-drop", async () => {
    const db = stubDb();
    const store = new MemoryTableStore(db);
    await store.register("taxon", "digest-1", BUF_A);
    await store.register("taxon", "digest-1", BUF_A);
    expect(db.registerFileBuffer).toHaveBeenCalledTimes(1);
    expect(db.dropFile).not.toHaveBeenCalled();
  });

  it("a different digest for an existing name drops the old registration, then registers the new one", async () => {
    const db = stubDb();
    const store = new MemoryTableStore(db);
    await store.register("taxon", "digest-1", BUF_A);
    await store.register("taxon", "digest-2", BUF_B);
    expect(db.dropFile).toHaveBeenCalledExactlyOnceWith("taxon");
    expect(db.registerFileBuffer).toHaveBeenCalledTimes(2);
    expect(store.get("taxon")?.digest).toBe("digest-2");
    expect(store.get("taxon")?.bytes).toBe(BUF_B.byteLength);
  });

  it("has() checks name, and optionally an exact digest", async () => {
    const db = stubDb();
    const store = new MemoryTableStore(db);
    expect(store.has("taxon")).toBe(false);
    await store.register("taxon", "digest-1", BUF_A);
    expect(store.has("taxon")).toBe(true);
    expect(store.has("taxon", "digest-1")).toBe(true);
    expect(store.has("taxon", "digest-9")).toBe(false);
  });

  it("drop() removes a registration and frees its bytes; a no-op on an unknown name", async () => {
    const db = stubDb();
    const store = new MemoryTableStore(db);
    await store.register("taxon", "digest-1", BUF_A);
    await store.drop("taxon");
    expect(db.dropFile).toHaveBeenCalledExactlyOnceWith("taxon");
    expect(store.has("taxon")).toBe(false);
    expect(store.bytesUsed()).toBe(0);

    await store.drop("never-registered"); // no throw, no dropFile call
    expect(db.dropFile).toHaveBeenCalledTimes(1);
  });

  it("list() and bytesUsed() reflect every currently registered table", async () => {
    const db = stubDb();
    const store = new MemoryTableStore(db);
    await store.register("taxon", "d1", BUF_A);
    await store.register("cell_model", "d2", BUF_B);
    expect(
      store
        .list()
        .map((e) => e.name)
        .sort(),
    ).toEqual(["cell_model", "taxon"]);
    expect(store.bytesUsed()).toBe(BUF_A.byteLength + BUF_B.byteLength);
  });

  it("kind is 'memory'", () => {
    expect(new MemoryTableStore(stubDb()).kind).toBe("memory");
  });
});
