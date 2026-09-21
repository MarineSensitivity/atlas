// atlas-0 Step 4, S1: one entry per pinned @duckdb/duckdb-wasm version under test (spikes/1/package.json
// npm-aliases them so all three coexist in node_modules). Each self-hosts its own mvp+eh wasm/worker
// files via Vite's `?url` suffix -- same self-hosting rule the root app will use (no CDN, no `coi`
// bundle, same-origin worker: atlas-refs/"calcofi explore review.md" S1, root vite.config.ts comment).
import * as duckdb132 from "duckdb-wasm-132";
import mvpWorker132 from "duckdb-wasm-132/dist/duckdb-browser-mvp.worker.js?url";
import ehWorker132 from "duckdb-wasm-132/dist/duckdb-browser-eh.worker.js?url";
import mvpWasm132 from "duckdb-wasm-132/dist/duckdb-mvp.wasm?url";
import ehWasm132 from "duckdb-wasm-132/dist/duckdb-eh.wasm?url";

import * as duckdbLatestDev57 from "duckdb-wasm-latest-dev57";
import mvpWorkerLatest from "duckdb-wasm-latest-dev57/dist/duckdb-browser-mvp.worker.js?url";
import ehWorkerLatest from "duckdb-wasm-latest-dev57/dist/duckdb-browser-eh.worker.js?url";
import mvpWasmLatest from "duckdb-wasm-latest-dev57/dist/duckdb-mvp.wasm?url";
import ehWasmLatest from "duckdb-wasm-latest-dev57/dist/duckdb-eh.wasm?url";

import * as duckdbNextDev64 from "duckdb-wasm-next-dev64";
import mvpWorkerNext from "duckdb-wasm-next-dev64/dist/duckdb-browser-mvp.worker.js?url";
import ehWorkerNext from "duckdb-wasm-next-dev64/dist/duckdb-browser-eh.worker.js?url";
import mvpWasmNext from "duckdb-wasm-next-dev64/dist/duckdb-mvp.wasm?url";
import ehWasmNext from "duckdb-wasm-next-dev64/dist/duckdb-eh.wasm?url";

const REGISTRY = {
  132: {
    duckdb: duckdb132,
    resolvedVersion: "1.32.0",
    bundles: {
      mvp: { mainModule: mvpWasm132, mainWorker: mvpWorker132 },
      eh: { mainModule: ehWasm132, mainWorker: ehWorker132 },
    },
  },
  latest: {
    duckdb: duckdbLatestDev57,
    resolvedVersion: "1.33.1-dev57.0",
    bundles: {
      mvp: { mainModule: mvpWasmLatest, mainWorker: mvpWorkerLatest },
      eh: { mainModule: ehWasmLatest, mainWorker: ehWorkerLatest },
    },
  },
  next: {
    duckdb: duckdbNextDev64,
    resolvedVersion: "1.33.1-dev64.0",
    bundles: {
      mvp: { mainModule: mvpWasmNext, mainWorker: mvpWorkerNext },
      eh: { mainModule: ehWasmNext, mainWorker: ehWorkerNext },
    },
  },
};

export function getEntry(pkg) {
  const entry = REGISTRY[pkg];
  if (!entry) throw new Error(`unknown pkg "${pkg}" (expected 132 | latest | next)`);
  return entry;
}

// fresh AsyncDuckDB instance (own worker + wasm module) for the given pkg key. Does NOT open any file
// yet -- mirrors the boot sequence in atlas-refs/"calcofi explore review.md" S1 (selectBundle -> new
// Worker -> new AsyncDuckDB -> instantiate).
export async function createDb(pkg) {
  const { duckdb, bundles } = getEntry(pkg);
  const bundle = await duckdb.selectBundle(bundles);
  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return { duckdb, db, worker };
}
