// atlas-2 Step 4: the injected fakes the OPFS unit tests share -- a fake OPFS directory tree, a
// fake `navigator.locks`, a fake `Storage` and a fake DuckDB handle. NOT a spec file (no
// `*.test.ts` suffix, so vitest's `include` never picks it up); the same convention
// `tests/geo/placeCodecVectors.ts` already uses.
//
// The point of every fake here is that it fails the way the real thing fails: the lock manager can
// be asked to behave like a plain `locks.request` (queue instead of answering `null`), the OPFS
// root can reject the way WebKit's does, the directory can throw `NotFoundError` with that exact
// `name`, and the storage can throw on every access the way a blocked-site-data profile does.

import type { DirHandleLike, FileHandleLike } from "../../src/lib/engine/store/opfsFs";
import type { LockManagerLike } from "../../src/lib/engine/store/select";
import type { StorageLike } from "../../src/lib/engine/store/keepData";

/** let pending microtasks AND the macrotask queue drain. Releasing a Web Lock is asynchronous in
 * the real API too (the lock is handed back when the callback's promise settles), so a test that
 * asserts "released" immediately after `release()` would be asserting something the real API does
 * not promise either. */
export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// ---- OPFS ------------------------------------------------------------------------------------

export class FakeDir implements DirHandleLike {
  files = new Map<string, number>(); // name -> byte size
  dirs = new Map<string, FakeDir>();
  /** every `removeEntry` that actually removed something, in order. */
  removed: string[] = [];

  constructor(files: Record<string, number> = {}) {
    for (const [name, size] of Object.entries(files)) this.files.set(name, size);
  }

  async *keys(): AsyncIterable<string> {
    for (const k of [...this.files.keys(), ...this.dirs.keys()]) yield k;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike> {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!options?.create) throw notFound(name);
    const created = new FakeDir();
    this.dirs.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
    if (!this.files.has(name)) {
      if (!options?.create) throw notFound(name);
      this.files.set(name, 0);
    }
    const size = this.files.get(name)!;
    return { getFile: async () => ({ size }) };
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.dirs.delete(name)) throw notFound(name);
    this.removed.push(name);
  }
}

function notFound(name: string): Error {
  const err = new Error(`no entry "${name}"`);
  err.name = "NotFoundError";
  return err;
}

/** a root containing an `atlas/` directory prefilled with `files` (name -> bytes). */
export function fakeOpfsRoot(files: Record<string, number> = {}): {
  root: () => Promise<DirHandleLike>;
  atlas: FakeDir;
} {
  const atlas = new FakeDir(files);
  const root = new FakeDir();
  root.dirs.set("atlas", atlas);
  return { root: async () => root, atlas };
}

/** the WebKit-shaped failure: `navigator.storage.getDirectory()` itself rejects. */
export function rejectingOpfsRoot(
  message = "The operation failed for an unknown transient reason",
): () => Promise<DirHandleLike> {
  return async () => {
    throw new Error(message);
  };
}

// ---- Web Locks -------------------------------------------------------------------------------

export interface FakeLocks extends LockManagerLike {
  /** names currently held. */
  held: Set<string>;
  /** true if any request was made WITHOUT `ifAvailable` (the seeded fault's signature). */
  sawPlainRequest: boolean;
  releaseAll(): void;
}

/**
 * A `navigator.locks` that behaves like the real one in the only way that matters here: with
 * `{ ifAvailable: true }` a contended request calls back with `null` immediately; WITHOUT it the
 * request QUEUES and never calls back while the lock is held -- which is the measured hang
 * (`docs/spikes/S1.md`: 6001-6024 ms on every engine), reproduced here as a promise that simply
 * never settles.
 */
export function fakeLocks(preHeld: readonly string[] = []): FakeLocks {
  const held = new Set<string>(preHeld);
  const releasers: (() => void)[] = [];
  const api: FakeLocks = {
    held,
    sawPlainRequest: false,
    releaseAll() {
      for (const r of releasers.splice(0)) r();
    },
    async request(name, options, callback) {
      if (!options?.ifAvailable) {
        api.sawPlainRequest = true;
        if (held.has(name)) return new Promise<never>(() => {}); // queues forever: the fault
      }
      if (held.has(name)) return callback(null);
      held.add(name);
      releasers.push(() => held.delete(name));
      const done = callback({ name });
      void done.then(
        () => held.delete(name),
        () => held.delete(name),
      );
      return done;
    },
  };
  return api;
}

// ---- Storage ---------------------------------------------------------------------------------

export function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** a `localStorage` that throws on every access (site data blocked). */
export function throwingStorage(): StorageLike {
  const boom = () => {
    throw new Error("The operation is insecure.");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

// ---- DuckDB --------------------------------------------------------------------------------

export interface FakeDb {
  /** every statement, in order. */
  sql: string[];
  /** rows the next `SELECT ... FROM _meta` should answer with. */
  metaRows: Record<string, unknown>[];
  registered: Map<string, Uint8Array>;
  dropped: string[];
  opened: string | null;
  terminated: boolean;
  /** make a statement whose text contains this substring throw. */
  failOn: string | null;
  /** make `open()` throw with this message. */
  failOpen: string | null;
  registerFileBuffer(name: string, buffer: Uint8Array): Promise<void>;
  dropFile(name: string): Promise<unknown>;
  open(config: { path?: string; accessMode?: number }): Promise<void>;
  connect(): Promise<{
    query<T>(sql: string): Promise<{ toArray(): T[] }>;
    close(): Promise<void>;
  }>;
  terminate(): Promise<void>;
  /** the `RawSql` a store would be handed by `Engine`. */
  raw<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

export function fakeDb(): FakeDb {
  const db: FakeDb = {
    sql: [],
    metaRows: [],
    registered: new Map(),
    dropped: [],
    opened: null,
    terminated: false,
    failOn: null,
    failOpen: null,
    async registerFileBuffer(name, buffer) {
      // the real `AsyncDuckDB.registerFileBuffer` TRANSFERS the buffer into the worker, which
      // DETACHES it on this side -- `buffer.byteLength` is 0 afterwards. A stub that merely stored
      // the array hid a real bug (every `bytes` recorded as 0, so the LRU budget never evicted
      // anything); this fake detaches too, so the unit tests see what the browser sees.
      db.registered.set(name, new Uint8Array(buffer));
      structuredClone(buffer.buffer, { transfer: [buffer.buffer] });
    },
    async dropFile(name) {
      db.dropped.push(name);
      db.registered.delete(name);
      return null;
    },
    async open(config) {
      if (db.failOpen) throw new Error(db.failOpen);
      db.opened = config.path ?? null;
    },
    async connect() {
      return {
        async query<T>(sql: string) {
          const rows = await db.raw<T>(sql);
          return { toArray: () => rows };
        },
        async close() {},
      };
    },
    async terminate() {
      db.terminated = true;
    },
    async raw<T>(sql: string): Promise<T[]> {
      db.sql.push(sql);
      if (db.failOn && sql.includes(db.failOn)) throw new Error(`fake failure on: ${db.failOn}`);
      if (/^SELECT name, digest, bytes, last_used FROM _meta/.test(sql))
        return db.metaRows as unknown as T[];
      return [];
    },
  };
  return db;
}
