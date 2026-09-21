// atlas-0 S4 spike, part (b) — shared "does duckdb-wasm's spatial extension load and ST_Read a
// registered .gpkg" harness. Two thin per-version wrapper modules (duckdb-1-32-0.ts,
// duckdb-next.ts) each statically import their OWN aliased @duckdb/duckdb-wasm-* package + its
// own mvp/eh bundle asset URLs (Vite's `?url` asset resolution needs static specifiers, so the
// per-version branching has to happen at the module level, not inside this shared function) and
// call into this one implementation. Measurement-only: records what happened, states no verdict.
//
// Every awaited step is wrapped in a per-stage timeout (STAGE_TIMEOUT_MS). First run without this
// (see RESULTS.md) hung past Playwright's whole-test timeout with zero diagnostic output on every
// single fixture/version, on this machine — wrapping each stage turns "the whole test silently
// hangs" into "stage X did not resolve within N ms", which is itself the measurement when that is
// what happens.

const DEFAULT_STAGE_TIMEOUT_MS = 20_000;
// `instantiate` compiles the ~35-40MB duckdb-*.wasm binary — a first, uncached run of that
// compile step measured well past 20s in this sandbox (see RESULTS.md), so it gets a much longer
// allowance than every other stage; a real hang elsewhere still gets caught at 20s.
const STAGE_TIMEOUT_MS: Record<string, number> = { instantiate: 120_000 };
function stageTimeoutMs(stage: string): number {
  return STAGE_TIMEOUT_MS[stage] ?? DEFAULT_STAGE_TIMEOUT_MS;
}

// duckdbMod is untyped (`any` — see below), so every awaited call through it is already `any`;
// this stays `any`-in/`any`-out rather than fighting TS to preserve a type nothing here has.
function withTimeout(p: Promise<any>, ms: number, stage: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`stage "${stage}" did not resolve within ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export interface DuckDBBundleUrls {
  mvp: { mainModule: string; mainWorker: string };
  eh: { mainModule: string; mainWorker: string };
}

export interface GpkgTestResult {
  versionLabel: string;
  bundleUsed: string;
  lastStageReached: string;
  spatialInstallLoadOk: boolean;
  rowCount: number | null;
  errorText: string | null;
  bytesFetchedGpkg: number;
}

export async function runGpkgTest(
  duckdbMod: any,
  bundles: DuckDBBundleUrls,
  gpkgUrl: string,
  versionLabel: string,
): Promise<GpkgTestResult> {
  let bundleUsed = "unknown";
  let lastStageReached = "start";
  let spatialInstallLoadOk = false;
  let rowCount: number | null = null;
  let errorText: string | null = null;
  let bytesFetchedGpkg = 0;
  let db: any = null;
  let conn: any = null;

  try {
    lastStageReached = "selectBundle";
    const bundle = await withTimeout(duckdbMod.selectBundle(bundles), stageTimeoutMs(lastStageReached), lastStageReached);
    bundleUsed = bundle.mainModule === bundles.eh.mainModule ? "eh" : "mvp";

    lastStageReached = "createWorker";
    const worker = await withTimeout(duckdbMod.createWorker(bundle.mainWorker), stageTimeoutMs(lastStageReached), lastStageReached);

    const logger = new duckdbMod.ConsoleLogger(duckdbMod.LogLevel.WARNING);
    db = new duckdbMod.AsyncDuckDB(logger, worker);

    lastStageReached = "instantiate";
    await withTimeout(db.instantiate(bundle.mainModule, bundle.pthreadWorker), stageTimeoutMs(lastStageReached), lastStageReached);

    lastStageReached = "connect";
    conn = await withTimeout(db.connect(), stageTimeoutMs(lastStageReached), lastStageReached);

    lastStageReached = "install_load_spatial";
    try {
      await withTimeout(conn.query(`INSTALL spatial; LOAD spatial;`), stageTimeoutMs(lastStageReached), lastStageReached);
      spatialInstallLoadOk = true;
    } catch (e: any) {
      errorText = `INSTALL/LOAD spatial failed at stage "${lastStageReached}": ${e?.message ?? String(e)}`;
    }

    if (spatialInstallLoadOk) {
      lastStageReached = "fetch_gpkg";
      const resp = await withTimeout(fetch(gpkgUrl), stageTimeoutMs(lastStageReached), lastStageReached);
      const buf = new Uint8Array(await resp.arrayBuffer());
      bytesFetchedGpkg = buf.byteLength;
      const fileName = gpkgUrl.split("/").pop() ?? "fixture.gpkg";

      lastStageReached = "registerFileBuffer";
      await withTimeout(db.registerFileBuffer(fileName, buf), stageTimeoutMs(lastStageReached), lastStageReached);

      lastStageReached = "ST_Read";
      try {
        const result = await withTimeout(
          conn.query(`SELECT count(*) AS n FROM ST_Read('${fileName}')`),
          stageTimeoutMs(lastStageReached),
          lastStageReached,
        );
        const rows = result.toArray();
        const first = rows[0];
        const n = typeof first?.toJSON === "function" ? first.toJSON().n : first?.n;
        rowCount = Number(n);
      } catch (e: any) {
        errorText = `ST_Read failed at stage "${lastStageReached}": ${e?.message ?? String(e)}`;
      }
    }
  } catch (e: any) {
    errorText = errorText ?? `duckdb setup failed at stage "${lastStageReached}": ${e?.message ?? String(e)}`;
  } finally {
    try {
      if (conn) await withTimeout(conn.close(), 5_000, "teardown_conn_close");
      if (db) await withTimeout(db.terminate(), 5_000, "teardown_db_terminate");
    } catch {
      // best-effort cleanup; a teardown failure/timeout should not mask the real result above
    }
  }

  return { versionLabel, bundleUsed, lastStageReached, spatialInstallLoadOk, rowCount, errorText, bytesFetchedGpkg };
}
