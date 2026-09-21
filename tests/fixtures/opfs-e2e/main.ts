// atlas-2 Step 4: the OPFS gate's harness page. NOT app code -- it exists so a real browser can
// drive the real `src/lib/engine/store/*` against a real DuckDB-WASM worker, a real OPFS and a real
// public parquet. Everything the specs assert is computed HERE (the specs only assert outcomes),
// the same division `tests/fixtures/engine-e2e/main.ts` and `spikes/1/src/main.js` already use.
//
// The fault switches below (`plainLock`, `opfsDenied`, `checkpoint`, `verifyDigests`) are the
// seeded faults this gate ships with: each one is a deliberately-wrong (or deliberately-degraded)
// option handed to the real code, and a spec asserts the specific breakage it causes. They live in
// the HARNESS, not in `src/lib`, except where the option is a genuine seam the library already has
// (`checkpoint` / `verifyDigests`, documented as fault switches in `opfsBackend.ts`, the same
// pattern as `engine.ts`'s `extensionRepository: null`).
import { Engine } from "../../../src/lib/engine/engine";
import { dataUrl } from "../../../src/lib/release/dataBase";
import {
  defaultOpenDatabase,
  openTableStoreBackend,
  purgeAllStoredData,
  purgeRestricted,
  type CreatedDb,
  type StoreBackend,
} from "../../../src/lib/engine/store/opfsBackend";
import { atlasDir, listDbFiles, type DirHandleLike } from "../../../src/lib/engine/store/opfsFs";
import { opfsDbFileName } from "../../../src/lib/engine/store/opfsPaths";
import type { LockManagerLike } from "../../../src/lib/engine/store/select";

function log(msg: string) {
  console.log(msg);
  const el = document.getElementById("log");
  if (el) el.textContent += msg + "\n";
}

/** the one real object every spec reads: `marine-atlas/v9/tables/taxon.parquet`, 37,067 rows. */
const TAXON_PATH = "tables/taxon.parquet";
export const TAXON_ROWS = 37067;

interface InitOptions {
  ver?: string;
  schema?: string;
  /** the digest `Engine#load` keys `taxon` on -- change it to exercise the re-materialize rule. */
  digest?: string;
  keepData?: boolean;
  /** quota handed to `storeBudgetBytes()`; the budget is 20% of it. */
  quota?: number;
  /**
   * simulate "storage denied": `navigator.storage.getDirectory()` rejects. Injected at the app's
   * own seam rather than by rewriting the worker script the way `spikes/1` did -- the seam IS the
   * `probeOpfs`/`opfsRoot` provider, and S1's own gap list says a real private window may fail at a
   * DIFFERENT call, which is why the whole open sequence is inside one `try`. WebKit exercises the
   * un-simulated version of this case for free (its `getDirectory()` genuinely rejects).
   */
  opfsDenied?: boolean;
  // --- seeded faults ---
  /** drop `{ ifAvailable: true }`: a contended request QUEUES and the tab never answers. */
  plainLock?: boolean;
  /** remove every CHECKPOINT. */
  checkpoint?: boolean;
  /** skip the session-start digest reconcile. */
  verifyDigests?: boolean;
}

interface Emitted {
  name: string;
  params: Record<string, unknown>;
}

let engine: Engine | null = null;
let backend: StoreBackend | null = null;
let events: Emitted[] = [];
let openedPaths: (string | null)[] = [];
let current: Required<Pick<InitOptions, "ver" | "schema" | "digest">> = {
  ver: "v9",
  schema: "1",
  digest: "T1",
};

/** a LockManager that forwards to the real one but strips `ifAvailable` -- the seeded fault. */
function plainLockManager(): LockManagerLike {
  return {
    request(name, _options, callback) {
      return navigator.locks.request(name, callback as never) as Promise<unknown>;
    },
  };
}

function taxonName(ver: string): string {
  return `${ver}/${TAXON_PATH}`;
}

async function init(opts: InitOptions = {}) {
  await close();
  events = [];
  openedPaths = [];
  current = { ver: opts.ver ?? "v9", schema: opts.schema ?? "1", digest: opts.digest ?? "T1" };

  backend = await openTableStoreBackend({
    ver: current.ver,
    schema: current.schema,
    duckdbVersion: "v1.4.3",
    // the digest expectation is stated directly rather than derived from a boot.json: this gate is
    // about the STORE, and a hand-written expectation is what lets one spec flip a single digest.
    expectedDigest: (name) => (name === taxonName(current.ver) ? current.digest : undefined),
    emit: (name, params) => {
      events.push({ name, params: { ...params } });
      log(`[emit] ${name} ${JSON.stringify(params)}`);
    },
    openDatabase: async (path): Promise<CreatedDb> => {
      openedPaths.push(path);
      return defaultOpenDatabase(path);
    },
    locks: opts.plainLock ? plainLockManager() : undefined,
    opfsRoot: opts.opfsDenied
      ? () => Promise.reject(new Error("The operation is not allowed (storage denied)"))
      : undefined,
    keepData: opts.keepData,
    estimateQuota: async () => opts.quota,
    checkpoint: opts.checkpoint,
    verifyDigests: opts.verifyDigests,
  });

  engine = new Engine({
    createDb: () => backend!.createDb(),
    store: (db, raw) => backend!.makeStore(db, raw),
  });
  await engine.boot();
  const result = {
    kind: backend.kind,
    reason: backend.reason,
    file: backend.file,
    budgetBytes: backend.budgetBytes,
    storeKind: engine.store?.kind ?? null,
    openedPaths: [...openedPaths],
  };
  log(`[init] ${JSON.stringify(result)}`);
  return result;
}

/** `Engine#load` + a real `count(*)`. On a reload this does NOT re-fetch: the store's `has(name,
 * digest)` already answers true, which is exactly what the S3-blocked gate proves. */
async function loadAndCount(opts: { name?: string; path?: string; digest?: string } = {}) {
  if (!engine) throw new Error("not initialized");
  const name = opts.name ?? taxonName(current.ver);
  const path = opts.path ?? TAXON_PATH;
  const started = performance.now();
  await engine.load(name, dataUrl(current.ver, path), opts.digest ?? current.digest);
  const ref = engine.store!.ref(name);
  if (!ref) throw new Error(`no ref for ${name}`);
  const rows = await engine.exec<{ n: bigint | number }>(`SELECT count(*) AS n FROM ${ref.from};`);
  const out = { n: Number(rows[0]?.n), from: ref.from, ms: performance.now() - started };
  log(`[count] ${name} -> ${JSON.stringify(out)}`);
  return out;
}

/** register one extra copy of the same parquet under a TILE name, so the LRU budget has something
 * it is allowed to evict (a non-tile table is pinned by policy). */
async function loadTile(tile: number) {
  return loadAndCount({
    name: `${current.ver}/serve/cell_model/tile=${tile}/data_0.parquet`,
    digest: `${current.ver}:cell_model:${tile}`,
  });
}

function tables() {
  return (engine?.store?.list() ?? []).map((e) => ({
    name: e.name,
    digest: e.digest,
    bytes: e.bytes,
    lastUsedMs: e.lastUsedMs,
  }));
}

async function dir(): Promise<DirHandleLike | null> {
  return atlasDir(undefined, false);
}

async function listFiles() {
  const d = await dir();
  return d ? listDbFiles(d) : [];
}

/** EVERY entry in `atlas/`, including the `.wal` side files `listDbFiles()` deliberately hides --
 * the CHECKPOINT gate has to see where the bytes actually are. */
async function entries(): Promise<{ name: string; bytes: number }[]> {
  const d = (await dir()) as (DirHandleLike & { keys(): AsyncIterable<string> }) | null;
  if (!d) return [];
  const out: { name: string; bytes: number }[] = [];
  for await (const name of d.keys()) {
    let bytes: number;
    try {
      bytes = (await (await d.getFileHandle(name)).getFile()).size;
    } catch {
      bytes = -1; // unreadable; reported rather than hidden
    }
    out.push({ name, bytes });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : 1));
  return out;
}

/** overwrite a db file with garbage, so the next `open()` fails the way a truncated/corrupted file
 * does. Uses the ordinary OPFS write API from the main thread (DuckDB's own handle is closed). */
async function corrupt(file: string) {
  const d = await dir();
  if (!d) throw new Error("no atlas dir");
  const handle = (await d.getFileHandle(file)) as unknown as {
    createWritable(opts?: { keepExistingData?: boolean }): Promise<{
      write(data: BufferSource): Promise<void>;
      truncate(n: number): Promise<void>;
      close(): Promise<void>;
    }>;
  };
  const w = await handle.createWritable({ keepExistingData: false });
  await w.truncate(0);
  await w.write(new TextEncoder().encode("NOT A DUCKDB FILE".repeat(64)));
  await w.close();
  log(`[corrupt] ${file}`);
}

async function close() {
  await engine?.dispose().catch(() => {});
  await backend?.close().catch(() => {});
  engine = null;
  backend = null;
}

declare global {
  interface Window {
    __opfsTest: {
      TAXON_ROWS: number;
      init(opts?: InitOptions): Promise<unknown>;
      loadAndCount(opts?: { name?: string; path?: string; digest?: string }): Promise<{
        n: number;
        from: string;
        ms: number;
      }>;
      loadTile(tile: number): Promise<{ n: number; from: string; ms: number }>;
      tables(): { name: string; digest: string; bytes: number; lastUsedMs: number }[];
      events(): Emitted[];
      openedPaths(): (string | null)[];
      storeKind(): string | null;
      fileNameFor(ver: string, schema?: string): string;
      listFiles(): Promise<{ file: string; ver: string; bytes: number }[]>;
      entries(): Promise<{ name: string; bytes: number }[]>;
      corrupt(file: string): Promise<void>;
      purgeRestricted(versions: string[]): Promise<string[]>;
      purgeAll(): Promise<string[]>;
      close(): Promise<void>;
    };
  }
}

window.__opfsTest = {
  TAXON_ROWS,
  init,
  loadAndCount,
  loadTile,
  tables,
  events: () => events,
  openedPaths: () => openedPaths,
  storeKind: () => engine?.store?.kind ?? backend?.kind ?? null,
  fileNameFor: (ver, schema = "1") => opfsDbFileName({ ver, schema, duckdb: "v1.4.3" }),
  listFiles,
  entries,
  corrupt,
  purgeRestricted: (versions) => purgeRestricted(versions),
  purgeAll: () => purgeAllStoredData(),
  close,
};

log("opfs harness ready");
