import { describe, expect, it, vi } from "vitest";
import {
  Engine,
  EngineUnavailableError,
  MATERIALIZE_MAX_BYTES,
  type DuckDBConnLike,
  type DuckDBHandleLike,
  type EngineMark,
} from "../../src/lib/engine/engine";

/** a fully in-Node, no-browser DuckDB double: records every `query()` call (and, via `onQuery`,
 * lets a test control timing/ordering/failure per call) without any real worker/WASM involved --
 * exactly the point of `engine.ts`'s dependency-injected `createDb`. */
function fakeHandle(opts: { onQuery?: (sql: string) => Promise<unknown[]> | unknown[] } = {}) {
  const registerFileBuffer = vi.fn().mockResolvedValue(undefined);
  const dropFile = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const terminate = vi.fn().mockResolvedValue(undefined);
  const workerTerminate = vi.fn();

  // cast away the generic signature: a vi.fn() mock can't itself stay generic over <T>, but the
  // object structurally satisfies DuckDBConnLike for every T a test actually asks for.
  const query = vi.fn(async (sql: string) => {
    const rows = (await opts.onQuery?.(sql)) ?? [];
    return { toArray: () => rows };
  }) as unknown as DuckDBConnLike["query"];

  const conn: DuckDBConnLike = { query, close };

  const db: DuckDBHandleLike = {
    registerFileBuffer,
    dropFile,
    connect: vi.fn().mockResolvedValue(conn),
    terminate,
  };

  const createDb = vi.fn(async () => ({ db, worker: { terminate: workerTerminate } }));
  return { createDb, db, conn, registerFileBuffer, dropFile, close, terminate, workerTerminate };
}

describe("Engine boot()", () => {
  it("is idempotent: concurrent boot() calls create the DB exactly once", async () => {
    const h = fakeHandle();
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null });
    await Promise.all([engine.boot(), engine.boot(), engine.boot()]);
    expect(h.createDb).toHaveBeenCalledTimes(1);
  });

  it("sets custom_extension_repository (lit()-escaped) before returning, when configured", async () => {
    const h = fakeHandle();
    const engine = new Engine({ createDb: h.createDb, extensionRepository: "./duckdb-ext" });
    await engine.boot();
    expect(h.conn.query).toHaveBeenCalledExactlyOnceWith(
      "SET custom_extension_repository = './duckdb-ext';",
    );
  });

  it("skips the SET when extensionRepository is explicitly null (seeded-fault harness only)", async () => {
    const h = fakeHandle();
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null });
    await engine.boot();
    expect(h.conn.query).not.toHaveBeenCalled();
  });

  it("a failed boot clears the cached promise so the next call retries", async () => {
    let attempt = 0;
    const createDb = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("worker failed to start");
      const h = fakeHandle();
      return h.createDb();
    });
    const engine = new Engine({ createDb, extensionRepository: null });

    await expect(engine.boot()).rejects.toThrow(EngineUnavailableError);
    await expect(engine.boot()).resolves.toBeUndefined();
    expect(attempt).toBe(2);
  });

  it("wraps a boot failure as EngineUnavailableError with the original message inside", async () => {
    const createDb = vi.fn(async () => {
      throw new Error("no worker support");
    });
    const engine = new Engine({ createDb, extensionRepository: null });
    await expect(engine.boot()).rejects.toThrow(/data engine unavailable: no worker support/);
  });
});

describe("Engine#exec — single promise chain (calcofi lesson 2)", () => {
  // seeded fault: two exec() calls issued back-to-back, with the FIRST deliberately slow, must
  // still run strictly in call order -- the second may not start until the first has fully
  // finished. If #enqueue ever stops chaining onto #chain (e.g. calls fn() directly), this test
  // goes red: "start:FAST" would appear before "done:SLOW".
  it("serializes exec() calls: a slow first query blocks a fast second one from starting early", async () => {
    const order: string[] = [];
    const h = fakeHandle({
      onQuery: async (sql) => {
        order.push(`start:${sql}`);
        if (sql === "SLOW") await new Promise((r) => setTimeout(r, 30));
        order.push(`done:${sql}`);
        return [{ sql }];
      },
    });
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null });

    const p1 = engine.exec("SLOW");
    const p2 = engine.exec("FAST");
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(order).toEqual(["start:SLOW", "done:SLOW", "start:FAST", "done:FAST"]);
    expect(r1).toEqual([{ sql: "SLOW" }]);
    expect(r2).toEqual([{ sql: "FAST" }]);
  });

  it("a rejected exec() does not poison the chain for a later call", async () => {
    const h = fakeHandle({
      onQuery: (sql) => {
        if (sql === "BAD") throw new Error("syntax error");
        return [{ ok: true }];
      },
    });
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null });

    await expect(engine.exec("BAD")).rejects.toThrow(EngineUnavailableError);
    await expect(engine.exec("GOOD")).resolves.toEqual([{ ok: true }]);
  });

  it("load() and exec() share the same chain (a load in flight delays a later exec)", async () => {
    const order: string[] = [];
    let resolveFetch: (() => void) | undefined;
    const fetchImpl = vi.fn(async () => {
      order.push("load:start");
      await new Promise<void>((r) => {
        resolveFetch = r;
      });
      order.push("load:done");
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const h = fakeHandle({
      onQuery: (sql) => {
        order.push(`exec:${sql}`);
        return [];
      },
    });
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null, fetchImpl });

    const loadP = engine.load("t", "https://example.test/t.parquet", "digest-1");
    const execP = engine.exec("SELECT 1");
    // let the chain (boot -> store lookup -> fetchImpl call) actually reach fetchImpl before we
    // resolve it -- several real microtask hops away, so poll rather than assume a fixed count.
    for (let i = 0; i < 50 && order.length === 0; i++) await Promise.resolve();
    expect(order).toEqual(["load:start"]); // exec must NOT have run yet
    resolveFetch?.();
    await Promise.all([loadP, execP]);
    expect(order).toEqual(["load:start", "load:done", "exec:SELECT 1"]);
  });
});

describe("Engine#load — materialize-then-query", () => {
  it("fetches the whole object and registers it via the store", async () => {
    const h = fakeHandle();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4])));
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null, fetchImpl });

    await engine.load("taxon", "https://example.test/taxon.parquet", "digest-1");
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("https://example.test/taxon.parquet", {
      signal: expect.any(AbortSignal),
    });
    expect(h.registerFileBuffer).toHaveBeenCalledExactlyOnceWith("taxon", expect.any(Uint8Array));
    expect(engine.store?.has("taxon", "digest-1")).toBe(true);
  });

  it("is idempotent through the store: the same name+digest is not re-fetched", async () => {
    const h = fakeHandle();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null, fetchImpl });

    await engine.load("taxon", "https://example.test/taxon.parquet", "digest-1");
    await engine.load("taxon", "https://example.test/taxon.parquet", "digest-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.registerFileBuffer).toHaveBeenCalledTimes(1);
  });

  // seeded fault: an object over the 25 MB guard must be refused, not silently materialized.
  it("refuses (throws) to materialize an object over the 25 MB guard", async () => {
    const oversized = new Uint8Array(MATERIALIZE_MAX_BYTES + 1);
    const h = fakeHandle();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(oversized));
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null, fetchImpl });

    await expect(
      engine.load("huge", "https://example.test/huge.parquet", "digest-1"),
    ).rejects.toThrow(/loading "huge":.*exceeds the 26214400 B whole-object guard/s);
    expect(h.registerFileBuffer).not.toHaveBeenCalled();
  });

  it("allows an object exactly at the 25 MB guard", async () => {
    const atLimit = new Uint8Array(MATERIALIZE_MAX_BYTES);
    const h = fakeHandle();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(atLimit));
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null, fetchImpl });
    await expect(
      engine.load("atlimit", "https://example.test/atlimit.parquet", "digest-1"),
    ).resolves.toBeUndefined();
    expect(h.registerFileBuffer).toHaveBeenCalledTimes(1);
  });

  it("wraps an HTTP failure as EngineUnavailableError", async () => {
    const h = fakeHandle();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null, fetchImpl });
    await expect(
      engine.load("missing", "https://example.test/missing.parquet", "digest-1"),
    ).rejects.toThrow(/data engine unavailable:.*HTTP 404/s);
  });
});

describe("Engine marks", () => {
  it("records engine:boot, engine:load and engine:exec marks with timing", async () => {
    const h = fakeHandle({ onQuery: () => [{ n: 1 }] });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2])));
    const marks: EngineMark[] = [];
    const engine = new Engine({
      createDb: h.createDb,
      extensionRepository: null,
      fetchImpl,
      marksSink: (m) => marks.push(m),
    });

    await engine.load("t", "https://example.test/t.parquet", "d1");
    await engine.exec("SELECT 1");

    const names = marks.map((m) => m.name);
    expect(names).toContain("engine:boot");
    expect(names).toContain("engine:load");
    expect(names).toContain("engine:exec");
    for (const m of marks) {
      expect(typeof m.startMs).toBe("number");
      expect(m.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Engine#dispose", () => {
  it("closes the connection, terminates the db and the worker", async () => {
    const h = fakeHandle();
    const engine = new Engine({ createDb: h.createDb, extensionRepository: null });
    await engine.boot();
    await engine.dispose();
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(h.workerTerminate).toHaveBeenCalledTimes(1);
  });
});
