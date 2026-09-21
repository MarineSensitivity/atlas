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

// the release function for whatever Web Lock acquireLockCreateAndHold is currently holding in this
// page instance (null when nothing is held).
let heldLockRelease = null;

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

  // --- Web Locks (fix round 1): master plan D3's actual mechanism -- "one tab holds it (Web
  // Locks), everyone else and every failure mode runs in memory." One fixed lock name per dbName so
  // every tab on this origin contends for the same lock (`atlas-opfs:<dbName>`, never opens the
  // opfs:// file itself without holding it).

  // tab 1: acquires the lock with { ifAvailable: true }; if granted (lock !== null), HOLDS the lock
  // unconditionally (until releaseHeldLock(), or automatically if this tab/page is closed/killed
  // outright -- tested by page.close() in the spec) for the life of this call, and separately tries
  // to create the table under it. The hold does NOT depend on that create succeeding: Web Locks
  // itself needs no storage/OPFS at all, so the lock is held even where OPFS is unavailable (WebKit,
  // here) -- that is what lets tab2 genuinely observe "unavailable" and prove the in-memory fallback
  // works everywhere, independent of whether OPFS itself works.
  async acquireLockCreateAndHold(dbName, sourceUrl) {
    const lockName = `atlas-opfs:${dbName}`;
    return new Promise((resolveOuter) => {
      navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
        if (lock === null) {
          resolveOuter({ acquired: false });
          return;
        }
        const result = { acquired: true };
        let heldDb = null;
        try {
          const { duckdb, db } = await createDb(pkg);
          await db.open({ path: `opfs://${dbName}`, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
          const conn = await db.connect();
          await conn.query("INSTALL httpfs; LOAD httpfs;");
          await conn.query(`CREATE TABLE t AS SELECT * FROM '${sourceUrl}'`);
          const res = await conn.query("SELECT count(*)::BIGINT AS n FROM t");
          result.n = Number(res.toArray()[0].n);
          await conn.query("CHECKPOINT");
          await conn.close();
          heldDb = db;
          live = { db };
        } catch (err) {
          result.opfsError = String(err && err.message ? err.message : err);
        }
        resolveOuter(result);
        // hold the lock until releaseHeldLock() resolves this -- unconditional, regardless of
        // whether the OPFS create above succeeded.
        await new Promise((resolveHeld) => {
          heldLockRelease = resolveHeld;
        });
        if (heldDb) {
          await heldDb.terminate();
          live = null;
        }
      });
    });
  },

  // graceful release of whatever lock acquireLockCreateAndHold is currently holding in THIS page.
  releaseHeldLock() {
    if (heldLockRelease) {
      const fn = heldLockRelease;
      heldLockRelease = null;
      fn();
      return true;
    }
    return false;
  },

  // any other tab: probes the SAME lock with { ifAvailable: true }.
  // - lock === null (someone else holds it, e.g. tab 1 above): answers count(*) from a brand-new
  //   IN-MEMORY database (`db.open({})`, no path) -- never calls db.open with an opfs:// path, so a
  //   createSyncAccessHandle conflict is structurally impossible on this branch.
  // - lock acquired (nobody held it, or the holder released/closed): reads the REAL persisted opfs
  //   file, proving a fresh tab can pick the lock back up once it is free.
  async probeLockAndAnswer(dbName, sourceUrl) {
    const lockName = `atlas-opfs:${dbName}`;
    const startedAt = performance.now();
    return new Promise((resolveOuter, rejectOuter) => {
      navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
        try {
          if (lock === null) {
            const { db } = await createDb(pkg);
            await db.open({}); // in-memory: no path, no opfs:// touched at all
            const conn = await db.connect();
            await conn.query("INSTALL httpfs; LOAD httpfs;");
            await conn.query(`CREATE TABLE t AS SELECT * FROM '${sourceUrl}'`);
            const res = await conn.query("SELECT count(*)::BIGINT AS n FROM t");
            const n = Number(res.toArray()[0].n);
            await conn.close();
            await db.terminate();
            resolveOuter({ lockAcquired: false, n, ms: performance.now() - startedAt });
            return;
          }
          const { duckdb, db } = await createDb(pkg);
          await db.open({ path: `opfs://${dbName}`, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
          const conn = await db.connect();
          const res = await conn.query("SELECT count(*)::BIGINT AS n FROM t");
          const n = Number(res.toArray()[0].n);
          await conn.close();
          await db.terminate();
          resolveOuter({ lockAcquired: true, n, ms: performance.now() - startedAt });
        } catch (err) {
          rejectOuter(err);
        }
      });
    });
  },

  // seeded fault: the SAME second-tab flow but with a plain navigator.locks.request (no
  // ifAvailable) -- while tab 1 holds the lock, this call queues and does not run its callback until
  // the lock is free, i.e. it hangs. Raced against timeoutMs so the hang is measured (bounded), not
  // an actual indefinite stall of the test runner.
  async probeLockNoIfAvailable(dbName, timeoutMs) {
    const lockName = `atlas-opfs:${dbName}`;
    const started = performance.now();
    const attempt = new Promise((resolve) => {
      navigator.locks.request(lockName, async () => {
        resolve({ outcome: "acquired-after-wait", ms: performance.now() - started });
      });
    });
    const timeout = new Promise((resolve) =>
      setTimeout(
        () => resolve({ outcome: "timeout", ms: performance.now() - started }),
        timeoutMs,
      ),
    );
    return Promise.race([attempt, timeout]);
  },
};
