// atlas-0 S3 spike: self-hosted DuckDB-WASM, same pattern the real app will use (CLAUDE.md /
// atlas-0 "Settled before this phase": `?url` imports, mvp+eh bundles, no `coi` bundle since GitHub
// Pages cannot send COOP/COEP, same-origin worker). Version 1.32.0 is S1's provisional pin; S3 does
// not decide it, it just uses whatever S1 currently pins (plan S3 paragraph).
import * as duckdb from "@duckdb/duckdb-wasm";
import mvpWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import ehWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

export function initDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) dbPromise = instantiate();
  return dbPromise;
}

async function instantiate(): Promise<duckdb.AsyncDuckDB> {
  const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
    mvp: { mainModule: mvpWasmUrl, mainWorker: mvpWorkerUrl },
    eh: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl },
  };
  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.VoidLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return db;
}
