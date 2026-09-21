// atlas-2 Step 3 (Sonnet half): self-hosted DuckDB-WASM bundles, the measured working wiring from
// `spikes/1/src/bundles.js` and `spikes/3/src/duckdb-setup.ts` (atlas-0 S1/S3), pinned to exactly
// `1.32.0` (`docs/spikes/S1.md`; `tests/pins.test.ts` guards the pin itself, not this file). `mvp`
// and `eh` wasm/worker files are self-hosted via `?url` imports -- no CDN, and this module is never
// reachable from the entry's static import graph (dynamic `import()` only; the size-budget script's
// forbidden-marker scan is what proves that). The worker is constructed by hand --
// `new Worker(bundle.mainWorker)`, same-origin -- never `duckdb.createWorker()` (a blob worker:
// `instantiate()` hangs forever, S1 Consequence 2) and never the `coi` bundle (GitHub Pages cannot
// send COOP/COEP).
import * as duckdb from "@duckdb/duckdb-wasm";
import mvpWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import ehWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";

export { duckdb };

/** both platform bundles, self-hosted. Passing only one of these two keys to `selectBundle()` forces
 * that platform regardless of what the browser would otherwise pick -- how `docs/engine.md`'s mvp
 * vs eh measurement and the e2e spec force each flavour in turn. */
export const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasmUrl, mainWorker: mvpWorkerUrl },
  eh: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl },
};

/** the underlying DuckDB **C++ engine** version baked into the pinned `1.32.0` npm release -- NOT
 * the npm version. This is the path segment DuckDB's extension autoloader keys the mirror on
 * (`{repository}/{engineVersion}/{platform}/{name}.duckdb_extension.wasm`, confirmed in
 * `docs/spikes/S3.md`/`S4.md`); bumping `@duckdb/duckdb-wasm` means re-deriving this and
 * re-mirroring (`scripts/fetch-duckdb-extensions.mjs`). */
export const DUCKDB_ENGINE_VERSION = "v1.4.3";

export interface CreatedDuckDB {
  db: duckdb.AsyncDuckDB;
  worker: Worker;
}

/**
 * Instantiate a fresh, self-hosted `AsyncDuckDB` (own worker + wasm module). Does not open any file
 * or run any query -- `engine.ts`'s boot sequence does that next (connect, then `SET
 * custom_extension_repository` before the first real query). `bundles` defaults to both platforms
 * (real `selectBundle()` feature-detection); pass a single-key object to force a platform.
 */
export async function createRealDuckDB(
  bundles: duckdb.DuckDBBundles = DUCKDB_BUNDLES,
): Promise<CreatedDuckDB> {
  const bundle = await duckdb.selectBundle(bundles);
  if (!bundle.mainWorker) throw new Error("selectBundle(): selected bundle has no mainWorker");
  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.VoidLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return { db, worker };
}
