// atlas-0 S3 fix round 1: duckdb-wasm extension-autoload investigation. Two full copies of
// duckdb-wasm live side by side in spikes/3/node_modules (package.json aliases
// `@duckdb/duckdb-wasm-next` -> the `next` dist-tag, pinned to the version it resolved to on
// 2026-09-21) so both the stable pin and `next` can be instantiated from the same page, each with
// its own self-hosted mvp/eh bundle (same pattern as src/duckdb-setup.ts).
import * as duckdbStable from "@duckdb/duckdb-wasm";
import stableMvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import stableEhWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import stableMvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import stableEhWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";

import * as duckdbNext from "@duckdb/duckdb-wasm-next";
import nextMvpWorker from "@duckdb/duckdb-wasm-next/dist/duckdb-browser-mvp.worker.js?url";
import nextEhWorker from "@duckdb/duckdb-wasm-next/dist/duckdb-browser-eh.worker.js?url";
import nextMvpWasm from "@duckdb/duckdb-wasm-next/dist/duckdb-mvp.wasm?url";
import nextEhWasm from "@duckdb/duckdb-wasm-next/dist/duckdb-eh.wasm?url";

export type DuckDBVersion = "stable" | "next";

// minimal shape shared by both package copies -- enough for what this harness calls.
interface DuckDBModule {
  selectBundle(bundles: Record<string, { mainModule: string; mainWorker: string | null }>): Promise<{
    mainModule: string;
    mainWorker: string | null;
    pthreadWorker: string | null;
  }>;
  VoidLogger: new () => unknown;
  AsyncDuckDB: new (logger: unknown, worker: Worker) => {
    instantiate(mainModule: string, pthreadWorker: string | null): Promise<void>;
    connect(): Promise<{
      query(sql: string): Promise<{ toArray(): Record<string, unknown>[] }>;
      close(): Promise<void>;
    }>;
    registerFileBuffer(name: string, buffer: Uint8Array): Promise<void>;
  };
}

export const DUCKDB_PKG_VERSION: Record<DuckDBVersion, string> = {
  stable: "1.32.0",
  next: "1.33.1-dev64.0", // `next` dist-tag as of 2026-09-21 (moving tag, pinned here for repro)
};

const MODULES: Record<DuckDBVersion, DuckDBModule> = {
  stable: duckdbStable as unknown as DuckDBModule,
  next: duckdbNext as unknown as DuckDBModule,
};

const BUNDLES: Record<DuckDBVersion, Record<string, { mainModule: string; mainWorker: string }>> = {
  stable: {
    mvp: { mainModule: stableMvpWasm, mainWorker: stableMvpWorker },
    eh: { mainModule: stableEhWasm, mainWorker: stableEhWorker },
  },
  next: {
    mvp: { mainModule: nextMvpWasm, mainWorker: nextMvpWorker },
    eh: { mainModule: nextEhWasm, mainWorker: nextEhWorker },
  },
};

export async function instantiateDuckDB(version: DuckDBVersion) {
  const mod = MODULES[version];
  const bundle = await mod.selectBundle(BUNDLES[version]);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new mod.VoidLogger();
  const db = new mod.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return db;
}
