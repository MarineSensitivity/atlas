// atlas-0 S3 fix round 1: does duckdb-wasm's extension autoload work fully self-hosted? CLAUDE.md
// says DuckDB is self-hosted (mvp/eh wasm+worker via `?url` imports) and GitHub Pages cannot proxy
// a remote origin -- so if `read_parquet()` needs a network round trip to extensions.duckdb.org
// that is NOT self-hosted, that's a real gap in the "self-hosted" plan decision. Exposes
// window.__ext for the Playwright spec (e2e/s3.ext.spec.ts) to drive.
import { instantiateDuckDB, type DuckDBVersion } from "./duckdb-versions";

// the first metric's tile-3492 fixture cell (see cases.ts CASES.click) -- any local tile works,
// this just needs to trigger a `read_parquet()` call.
const PROBE_TILE_URL = "/app/cell/tile=3492/data_0.parquet";

export interface ProbeResult {
  ok: boolean;
  ms: number;
  rows?: number;
  error?: string;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { ms: performance.now() - t0, value };
  } catch (err) {
    return { ms: performance.now() - t0, error: String(err) };
  }
}

// runs `read_parquet()` against a local tile, which triggers the parquet extension's autoload on
// first use in a fresh AsyncDuckDB instance. `customRepository`, if given, is set before the query
// (`SET custom_extension_repository = ...`); a fresh `AsyncDuckDB` is created per call so the
// autoload always actually fires (no cross-call extension-already-loaded shortcut).
async function probeReadParquet(version: DuckDBVersion, customRepository?: string): Promise<ProbeResult> {
  const db = await instantiateDuckDB(version);
  try {
    const conn = await db.connect();
    try {
      if (customRepository) {
        await conn.query(`SET custom_extension_repository = '${customRepository}';`);
      }
      const resp = await fetch(PROBE_TILE_URL);
      const buf = new Uint8Array(await resp.arrayBuffer());
      const fileName = `ext-probe-${version}-${Math.random().toString(36).slice(2)}.parquet`;
      await db.registerFileBuffer(fileName, buf);
      const { ms, value, error } = await timed(async () => {
        const result = await conn.query(`SELECT count(*) AS n FROM read_parquet('${fileName}')`);
        return Number(result.toArray()[0].n);
      });
      if (error) return { ok: false, ms, error };
      return { ok: true, ms, rows: value };
    } finally {
      await conn.close();
    }
  } catch (err) {
    return { ok: false, ms: NaN, error: String(err) };
  }
}

// `INSTALL x; LOAD x;` on a fresh instance -- triggers the same autoload mechanism for any named
// extension, not just the one `read_parquet` needs implicitly.
async function probeLoadExtension(version: DuckDBVersion, name: string): Promise<ProbeResult> {
  const db = await instantiateDuckDB(version);
  try {
    const conn = await db.connect();
    try {
      const { ms, error } = await timed(() => conn.query(`INSTALL ${name}; LOAD ${name};`));
      if (error) return { ok: false, ms, error };
      return { ok: true, ms };
    } finally {
      await conn.close();
    }
  } catch (err) {
    return { ok: false, ms: NaN, error: String(err) };
  }
}

declare global {
  interface Window {
    __ext: {
      probeReadParquet(version: DuckDBVersion, customRepository?: string): Promise<ProbeResult>;
      probeLoadExtension(version: DuckDBVersion, name: string): Promise<ProbeResult>;
    };
  }
}

window.__ext = { probeReadParquet, probeLoadExtension };
