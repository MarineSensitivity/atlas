// atlas-0 S4 spike, part (b) — the `@duckdb/duckdb-wasm@next` side of the ST_Read test. `next`
// floats (another spike, S1, decides the actual pin) — VERSION_LABEL below is the exact version
// `next` resolved to when spikes/4/package.json was installed, captured so RESULTS.md records
// what was really tested rather than a moving tag name.
import * as duckdb from "@duckdb/duckdb-wasm-next";
import mvpWasmUrl from "@duckdb/duckdb-wasm-next/dist/duckdb-mvp.wasm?url";
import mvpWorkerUrl from "@duckdb/duckdb-wasm-next/dist/duckdb-browser-mvp.worker.js?url";
import ehWasmUrl from "@duckdb/duckdb-wasm-next/dist/duckdb-eh.wasm?url";
import ehWorkerUrl from "@duckdb/duckdb-wasm-next/dist/duckdb-browser-eh.worker.js?url";
import { runGpkgTest, type GpkgTestResult } from "./duckdb-gpkg-test";

// captured once from `npm view @duckdb/duckdb-wasm@next version` at fixture-build time (2026-09-21).
const VERSION_LABEL = "1.33.1-dev64.0";

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
