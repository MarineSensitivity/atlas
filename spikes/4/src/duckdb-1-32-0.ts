// atlas-0 S4 spike, part (b) — the `@duckdb/duckdb-wasm@1.32.0` side of the ST_Read test (the
// version the plan's S1 spike names as the known-good OPFS pin; here we only care whether the
// `spatial` extension loads and reads a .gpkg, S1's OPFS question is out of scope for this file).
// `?url` imports (no `optimizeDeps` inclusion — same self-hosted pattern the root CLAUDE.md
// mandates for the real app) so Vite emits the wasm/worker as plain hashed assets instead of
// trying to bundle them.
import * as duckdb from "@duckdb/duckdb-wasm-1-32-0";
import mvpWasmUrl from "@duckdb/duckdb-wasm-1-32-0/dist/duckdb-mvp.wasm?url";
import mvpWorkerUrl from "@duckdb/duckdb-wasm-1-32-0/dist/duckdb-browser-mvp.worker.js?url";
import ehWasmUrl from "@duckdb/duckdb-wasm-1-32-0/dist/duckdb-eh.wasm?url";
import ehWorkerUrl from "@duckdb/duckdb-wasm-1-32-0/dist/duckdb-browser-eh.worker.js?url";
import { runGpkgTest, type GpkgTestResult } from "./duckdb-gpkg-test";

// captured once from `npm view @duckdb/duckdb-wasm@1.32.0 version` at fixture-build time (2026-09-21).
const VERSION_LABEL = "1.32.0";

export async function testGpkg(gpkgUrl: string, customExtensionRepository?: string): Promise<GpkgTestResult> {
  return runGpkgTest(
    duckdb,
    {
      mvp: { mainModule: mvpWasmUrl, mainWorker: mvpWorkerUrl },
      eh: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl },
    },
    gpkgUrl,
    VERSION_LABEL,
    customExtensionRepository,
  );
}
