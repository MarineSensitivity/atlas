// atlas-0 Step 4, S1 harness page. Not part of the shipped app. Picks the duckdb-wasm build named by
// ?pkg= (132 | latest | next) and exposes window.spike so the Playwright spec drives it via
// page.evaluate(). All SQL/OPFS logic lives here (not in the test) so the test only asserts outcomes.
import { createDb, getEntry } from "./bundles.js";

function log(msg) {
  console.log(msg);
  const el = document.getElementById("log");
  if (el) el.textContent += msg + "\n";
}

const params = new URLSearchParams(location.search);
const pkg = params.get("pkg") ?? "132";
const entry = getEntry(pkg);
log(`spike ready: pkg=${pkg} resolvedVersion=${entry.resolvedVersion}`);

// keeps a live db handle across evaluate() calls: the "second tab" scenario needs the FIRST tab to
// hold its opfs file open (not terminate) while a second page probes the same file.
let live = null;

window.spike = {
  pkg,
  resolvedVersion: entry.resolvedVersion,

  // S1 step 1: opens opfs://<dbName> READ_WRITE, LOADs httpfs, `CREATE TABLE t AS SELECT * FROM
  // '<sourceUrl>'`, counts, CHECKPOINTs. Leaves the connection+db OPEN; caller decides whether to
  // release() (normal case) or hold it open (second-tab case).
  async createAndCount(dbName, sourceUrl) {
    const { duckdb, db } = await createDb(pkg);
    live = { db };
    await db.open({ path: `opfs://${dbName}`, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
    const conn = await db.connect();
    await conn.query("INSTALL httpfs; LOAD httpfs;");
    await conn.query(`CREATE TABLE t AS SELECT * FROM '${sourceUrl}'`);
    const res = await conn.query("SELECT count(*)::BIGINT AS n FROM t");
    const n = Number(res.toArray()[0].n);
    await conn.query("CHECKPOINT");
    await conn.close();
    return n;
  },

  // S1 step 2 (persistence assertion): brand-new worker+wasm (simulates the page reload having torn
  // down the old JS realm), reopens the SAME opfs file READ_WRITE, counts -- no network needed here
  // (the Playwright spec blocks S3 before calling this).
  async reopenAndCount(dbName) {
    const { duckdb, db } = await createDb(pkg);
    live = { db };
    await db.open({ path: `opfs://${dbName}`, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
    const conn = await db.connect();
    const res = await conn.query("SELECT count(*)::BIGINT AS n FROM t");
    const n = Number(res.toArray()[0].n);
    await conn.close();
    await db.terminate();
    live = null;
    return n;
  },

  // releases whatever this page instance is holding open.
  async release() {
    if (live) {
      await live.db.terminate();
      live = null;
    }
  },

  // S1 "second tab while the first holds the file": brand-new worker+wasm in THIS page trying to open
  // the SAME opfs file READ_WRITE while another tab may still hold it. Races the open+query attempt
  // against a hard in-page timeout so a real hang reports as {outcome:"timeout"}, never blocks the
  // caller (page.evaluate) indefinitely.
  //
  // seeded-fault mode (?hangSecondTab=1, e2e/second-tab-hang-fault.spec.js): skips the in-page race
  // entirely and returns a promise that never resolves, simulating "the in-page hang guard is
  // missing/broken" -- proof that the OUTER Playwright-side guard (second-tab.spec.js's own
  // Promise.race) is what actually turns a hang into a failure, not a stall. Never used outside that
  // one proof spec.
  async openSecondHandle(dbName, timeoutMs) {
    if (params.get("hangSecondTab") === "1") {
      return new Promise(() => {});
    }
    const attempt = (async () => {
      const { duckdb, db } = await createDb(pkg);
      try {
        await db.open({ path: `opfs://${dbName}`, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
        const conn = await db.connect();
        const res = await conn.query("SELECT count(*)::BIGINT AS n FROM t");
        const n = Number(res.toArray()[0].n);
        await conn.close();
        await db.terminate();
        return { outcome: "opened", n };
      } catch (err) {
        await db.terminate().catch(() => {});
        return { outcome: "rejected", message: String(err && err.message ? err.message : err) };
      }
    })();
    const timeout = new Promise((resolve) =>
      setTimeout(
        () => resolve({ outcome: "timeout", message: `no result after ${timeoutMs}ms` }),
        timeoutMs,
      ),
    );
    return Promise.race([attempt, timeout]);
  },

  // S1 "private-or-OPFS-unavailable": the Playwright spec makes navigator.storage.getDirectory()
  // reject INSIDE the duckdb worker (by rewriting the worker script response, since OPFS access
  // happens only in the worker realm, not the main thread -- confirmed by grep of the dist bundles).
  // Proves the fallback: catch the opfs open failure, fall back to an in-memory db (`open({})`, no
  // path), and still serve the same query.
  async createInMemoryFallback(sourceUrl) {
    const { duckdb, db } = await createDb(pkg);
    let opfsError = null;
    try {
      await db.open({
        path: "opfs://atlas-spike-should-fail.duckdb",
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      });
    } catch (err) {
      opfsError = String(err && err.message ? err.message : err);
    }
    await db.open({}); // in-memory: no path
    const conn = await db.connect();
    await conn.query("INSTALL httpfs; LOAD httpfs;");
    await conn.query(`CREATE TABLE t AS SELECT * FROM '${sourceUrl}'`);
    const res = await conn.query("SELECT count(*)::BIGINT AS n FROM t");
    const n = Number(res.toArray()[0].n);
    await conn.close();
    await db.terminate();
    return { opfsError, n };
  },
};
