// atlas-0 S4 spike, part (b) — shared "does duckdb-wasm's spatial extension load and ST_Read a
// registered .gpkg" harness. Two thin per-version wrapper modules (duckdb-1-32-0.ts,
// duckdb-next.ts) each statically import their OWN aliased @duckdb/duckdb-wasm-* package + its
// own mvp/eh bundle asset URLs (Vite's `?url` asset resolution needs static specifiers, so the
// per-version branching has to happen at the module level, not inside this shared function) and
// call into this one implementation. Measurement-only: records what happened, states no verdict.
//
// FIX ROUND 1 root cause: the first version of this file called `duckdbMod.createWorker(url)` —
// duckdb-wasm's own helper, which does `fetch(url)` -> `blob()` -> `new Worker(URL.createObjectURL(blob))`.
// That produces a REAL worker (confirmed: the blob's byte count exactly matched the real worker
// file), so `instantiate()`'s hang was never "the worker never started" in the sense of a 404 —
// it was that nothing was listening for a worker-side error, so a failure inside that
// blob-sourced worker (whose `self.location` is a `blob:` URL, not the original http(s) URL) was
// silently swallowed and the pending RPC just never resolved. S1's proven-working harness
// (spikes/1/src/bundles.js, read-only reference) never calls `createWorker()` — it does
// `new Worker(bundle.mainWorker)` directly, a real same-origin http(s) URL, which is what this
// file now does too. `worker.onerror`/`onmessageerror` are wired BEFORE the worker is handed to
// `AsyncDuckDB` so a failure is visible instead of silent, on the (unlikely, now) chance one still
// occurs. See RESULTS.md for the before/after evidence under both `vite dev` and `vite build`+`preview`.

const DEFAULT_STAGE_TIMEOUT_MS = 20_000;
// `instantiate` compiles the ~35-40MB duckdb-*.wasm binary — give it more room than the other
// (fast, local) stages even though it now resolves in well under a second (see RESULTS.md); a
// real hang elsewhere still gets caught at 20s.
const STAGE_TIMEOUT_MS: Record<string, number> = { instantiate: 60_000 };
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
  spatialLoadMs: number | null;
  // from duckdb_extensions() right after LOAD — DuckDB's own record of what it did, which is more
  // reliable than sniffing network traffic: a dedicated Worker's own `fetch()` calls (which is how
  // duckdb-wasm actually retrieves both the main wasm module AND the spatial extension binary) are
  // NOT visible to Playwright's page.on("response") — confirmed empirically here: even the ~35-40MB
  // main wasm binary, which unquestionably WAS fetched (instantiate succeeded), never appeared in
  // that listener. So "how many bytes / from which URL" for the extension is answered from inside
  // DuckDB itself, not from network capture.
  extensionInfo: { installed: boolean; loaded: boolean; installPath: string | null } | null;
  rowCount: number | null;
  bbox: [number, number, number, number] | null;
  vertexCount: number | null;
  errorText: string | null;
  workerErrors: string[];
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
  let spatialLoadMs: number | null = null;
  let extensionInfo: GpkgTestResult["extensionInfo"] = null;
  let rowCount: number | null = null;
  let bbox: [number, number, number, number] | null = null;
  let vertexCount: number | null = null;
  let errorText: string | null = null;
  let bytesFetchedGpkg = 0;
  const workerErrors: string[] = [];
  let db: any = null;
  let conn: any = null;

  try {
    lastStageReached = "selectBundle";
    const bundle = await withTimeout(duckdbMod.selectBundle(bundles), stageTimeoutMs(lastStageReached), lastStageReached);
    bundleUsed = bundle.mainModule === bundles.eh.mainModule ? "eh" : "mvp";

    // fix round 1: a plain, same-origin Worker — NOT duckdbMod.createWorker(), which fetches the
    // script into a Blob first (see the file-header comment for why that silently hangs
    // instantiate() instead of erroring). This mirrors S1's proven-working
    // spikes/1/src/bundles.js createDb().
    lastStageReached = "new Worker";
    const worker = new Worker(bundle.mainWorker);
    worker.addEventListener("error", (e: ErrorEvent) => {
      workerErrors.push(`worker error: ${e.message ?? "(no message)"} at ${e.filename ?? "?"}:${e.lineno ?? "?"}`);
    });
    worker.addEventListener("messageerror", (e: MessageEvent) => {
      workerErrors.push(`worker messageerror: ${String(e.data)}`);
    });

    const logger = new duckdbMod.ConsoleLogger(duckdbMod.LogLevel.WARNING);
    db = new duckdbMod.AsyncDuckDB(logger, worker);

    lastStageReached = "instantiate";
    await withTimeout(db.instantiate(bundle.mainModule, bundle.pthreadWorker), stageTimeoutMs(lastStageReached), lastStageReached);

    lastStageReached = "connect";
    conn = await withTimeout(db.connect(), stageTimeoutMs(lastStageReached), lastStageReached);

    lastStageReached = "install_load_spatial";
    const spatialT0 = performance.now();
    try {
      await withTimeout(conn.query(`INSTALL spatial; LOAD spatial;`), stageTimeoutMs(lastStageReached), lastStageReached);
      spatialInstallLoadOk = true;
      spatialLoadMs = performance.now() - spatialT0;

      lastStageReached = "duckdb_extensions_introspect";
      const extRes = await withTimeout(
        conn.query(`SELECT installed, loaded, install_path FROM duckdb_extensions() WHERE extension_name = 'spatial'`),
        stageTimeoutMs(lastStageReached),
        lastStageReached,
      );
      const extRow = extRes.toArray()[0];
      const extJson = typeof extRow?.toJSON === "function" ? extRow.toJSON() : extRow;
      if (extJson) {
        extensionInfo = {
          installed: Boolean(extJson.installed),
          loaded: Boolean(extJson.loaded),
          installPath: extJson.install_path ?? null,
        };
      }
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
          conn.query(
            `SELECT count(*) AS n, min(ST_XMin(geom)) AS xmin, min(ST_YMin(geom)) AS ymin, ` +
              `max(ST_XMax(geom)) AS xmax, max(ST_YMax(geom)) AS ymax, ` +
              `sum(ST_NPoints(geom)) AS vtx FROM ST_Read('${fileName}')`,
          ),
          stageTimeoutMs(lastStageReached),
          lastStageReached,
        );
        const rows = result.toArray();
        const first = rows[0];
        const row = typeof first?.toJSON === "function" ? first.toJSON() : first;
        rowCount = Number(row.n);
        bbox = [Number(row.xmin), Number(row.ymin), Number(row.xmax), Number(row.ymax)];
        vertexCount = Number(row.vtx);
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

  return {
    versionLabel,
    bundleUsed,
    lastStageReached,
    spatialInstallLoadOk,
    spatialLoadMs,
    extensionInfo,
    rowCount,
    bbox,
    vertexCount,
    errorText,
    workerErrors,
    bytesFetchedGpkg,
  };
}
