// atlas-2 Step 3 (Sonnet half): the real engine wrapper, booted for real, driven from
// e2e/*.spec.ts. NOT app code -- this fixture exists solely so a real browser can exercise
// src/lib/engine/{engine,bundles,sql,smoke}.ts end to end (a real Worker + WASM module can't run
// under Vitest's Node environment; tests/engine/*.test.ts covers everything dependency-injectable).
import * as duckdb from "@duckdb/duckdb-wasm";
import {
  createRealDuckDB,
  DUCKDB_BUNDLES,
  DUCKDB_ENGINE_VERSION,
} from "../../../src/lib/engine/bundles";
import { Engine, type EngineMark } from "../../../src/lib/engine/engine";
import { smokeCountSql } from "../../../src/lib/engine/smoke";
import { dataUrl } from "../../../src/lib/release/dataBase";

export type Platform = "mvp" | "eh";

export interface BootResult {
  ok: boolean;
  error?: string;
  engineVersion?: string;
}

export interface QueryResult {
  ok: boolean;
  error?: string;
  rows?: unknown[];
}

let engine: Engine | undefined;

/** which platform bundle `selectBundle()` actually picked -- forced by narrowing `bundles` to a
 * single key ("mvp") or left to real feature-detection (which, per docs/spikes/S1.md/S3.md, always
 * picked "eh" in headless Chromium/Firefox/WebKit whenever both were offered). */
function bundlesFor(platform: Platform | undefined): duckdb.DuckDBBundles {
  if (platform === "mvp") return { mvp: DUCKDB_BUNDLES.mvp };
  return DUCKDB_BUNDLES; // "eh" (or unspecified): both offered, real feature-detection decides
}

async function boot(
  opts: {
    platform?: Platform;
    extensionRepository?: string | null;
  } = {},
): Promise<BootResult> {
  await engine?.dispose();
  const bundles = bundlesFor(opts.platform);
  engine = new Engine({
    createDb: () => createRealDuckDB(bundles),
    // `undefined` (the default here too) lets Engine compute its own absolute, document.baseURI-
    // relative default (engine.ts's `defaultExtensionRepository()`) -- NOT a hand-rolled relative
    // string. A bug caught by this fixture's first run: DuckDB's extension-autoload fetch happens
    // INSIDE THE WORKER, whose own script location differs from the page's, so a literal relative
    // string like "./duckdb-ext" resolves against the wrong base there and silently fails.
    extensionRepository: opts.extensionRepository,
  });
  try {
    await engine.boot();
    return { ok: true, engineVersion: DUCKDB_ENGINE_VERSION };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function countTaxon(ver = "v9"): Promise<QueryResult & { n?: number }> {
  if (!engine) return { ok: false, error: "not booted" };
  try {
    const url = dataUrl(ver, "tables/taxon.parquet");
    await engine.load("taxon", url, `smoke-${ver}`);
    const rows = await engine.exec<{ n: bigint | number }>(
      "SELECT count(*) AS n FROM read_parquet('taxon')",
    );
    return { ok: true, n: Number(rows[0]?.n), rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** loads taxon (if not already) and runs sql/smoke_count.sql with `probeValue` through the
 * ORDINARY (lit()'d) params path -- the injection-safety round trip against a real connection. */
async function smokeProbe(probeValue: string, ver = "v9"): Promise<QueryResult> {
  if (!engine) return { ok: false, error: "not booted" };
  try {
    const url = dataUrl(ver, "tables/taxon.parquet");
    await engine.load("taxon", url, `smoke-${ver}`);
    // mirrors MemoryTableStore's own ref format (src/lib/engine/store/memoryStore.ts) -- a bare
    // fixture convenience, not a claim that every backend uses this exact shape.
    const sql = smokeCountSql("read_parquet('taxon')", probeValue);
    const rows = await engine.exec<{ n: bigint | number; probe: string }>(sql);
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function exec(sql: string): Promise<QueryResult> {
  if (!engine) return { ok: false, error: "not booted" };
  try {
    const rows = await engine.exec(sql);
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function marks(): EngineMark[] {
  return (window as unknown as { __marks?: EngineMark[] }).__marks ?? [];
}

declare global {
  interface Window {
    __engineTest: {
      boot(opts?: {
        platform?: Platform;
        extensionRepository?: string | null;
      }): Promise<BootResult>;
      countTaxon(ver?: string): Promise<QueryResult & { n?: number }>;
      smokeProbe(probeValue: string, ver?: string): Promise<QueryResult>;
      exec(sql: string): Promise<QueryResult>;
      marks(): EngineMark[];
    };
  }
}

window.__engineTest = { boot, countTaxon, smokeProbe, exec, marks };
