# S1 · OPFS persistence pin — raw measurements

Measurements only. No verdict, no recommendation — that is Opus's review step (atlas-0's Steps/Review
checklist). This file records exact commands, exact versions, exact numbers, and verbatim gate output.

**Fix round 1** added: the actual Web Locks `ifAvailable` mechanism from master plan D3
(`e2e/web-locks*.spec.js`, new `window.spike.{acquireLockCreateAndHold,releaseHeldLock,
probeLockAndAnswer,probeLockNoIfAvailable}` in `src/main.js`), and `test.fail()` annotations on every
intentionally-red case so the suite's exit code is a usable gate (see "Exit codes" below).

## Environment

- Machine: macOS 15.7.1 (BuildVersion 24G231), Darwin 24.6.0.
- Node `v24.9.0`, npm `11.18.0`.
- `@playwright/test` `1.63.0` (reused from the repo root's `node_modules`; not installed a second
  time — `spikes/1/package.json` has no `@playwright/test` entry, it resolves via the normal
  node_modules parent-walk to `../../node_modules/@playwright/test`).
- Browser engines actually launched (via `browser.version()`), already installed for the root's
  `@playwright/test`:
  - chromium `153.0.8010.12`
  - webkit `26.6`
  - firefox `155.0`
- `@duckdb/duckdb-wasm` dist-tags, resolved 2026-09-21 via `npm view @duckdb/duckdb-wasm dist-tags
  --json`: `latest` = `1.33.1-dev57.0`, `next` = `1.33.1-dev64.0` — matches the plan's stated facts
  exactly.
- Source table used for `CREATE TABLE t AS SELECT * FROM '<url>'`:
  `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/tables/taxon.parquet`
  (found via `.../marine-atlas/v9/manifest.json`'s `tables.taxon`; anonymous LIST on the bucket root
  is denied, confirmed: `curl -s https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/v9/manifest.json`
  → `403 AccessDenied` — the manifest lives under the `marine-atlas/` prefix, i.e.
  `.../oceanmetrics.io-public/marine-atlas/v9/manifest.json`, which is public-readable: `versions.json`
  lists v9 as `status: prerelease, access: restricted` but the object itself answers anonymous GET/HEAD
  with `200` and `Access-Control-Allow-Origin: *`).
  `HEAD` on `taxon.parquet`: `Content-Length: 1033168` (~1 MB), `Accept-Ranges: bytes`, CORS confirmed
  with an `Origin` header present (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET,
  HEAD`). Row count returned by every successful `SELECT count(*) FROM t` in every run below: **37067**.

## Harness

`spikes/1/`: own `package.json` (three `npm:` aliases — `duckdb-wasm-132` →
`@duckdb/duckdb-wasm@1.32.0`, `duckdb-wasm-latest-dev57` → `@duckdb/duckdb-wasm@1.33.1-dev57.0`,
`duckdb-wasm-next-dev64` → `@duckdb/duckdb-wasm@1.33.1-dev64.0`, installed side by side under
`spikes/1/node_modules/`), own `vite.config.js` (port 4311/strictPort, `optimizeDeps.exclude` for all
three aliases), own `index.html` + `src/{bundles.js,main.js}`, own `playwright.config.js` + `e2e/*`.
No root file touched.

- `src/bundles.js`: one `createDb(pkg)` factory per pinned version. Each self-hosts its own mvp+eh
  `?url` wasm/worker files (no CDN, no `coi` bundle — same rule as the root app: no COOP/COEP on
  Pages), same-origin `new Worker(bundle.mainWorker)`.
- `src/main.js`: reads `?pkg=132|latest|next` from the URL, exposes `window.spike` with the actual
  SQL/OPFS/locks logic that the Playwright specs drive via `page.evaluate()`:
  `createAndCount`, `reopenAndCount`, `release`, `openSecondHandle`, `createInMemoryFallback`
  (round 0), and `acquireLockCreateAndHold`, `releaseHeldLock`, `probeLockAndAnswer`,
  `probeLockNoIfAvailable` (round 1, Web Locks).
- The exact SQL run on the first open, per the plan text: `INSTALL httpfs; LOAD httpfs;` then
  `CREATE TABLE t AS SELECT * FROM '<taxon.parquet URL>'`, `SELECT count(*)::BIGINT AS n FROM t`,
  `CHECKPOINT`. The reopen after reload runs only `SELECT count(*) FROM t` — no httpfs, no network.
- **Method note on "OPFS-unavailable" (no true private-mode automation used):** `navigator.storage.
  getDirectory` is called only inside the duckdb *worker* bundle, never on the main thread — confirmed
  by `grep -c getDirectory duckdb-browser.mjs` = 0 vs. `duckdb-browser-eh.worker.js` = 3, and confirmed
  live via a probe `Worker` (see below). `page.addInitScript()` only reaches the page/Window realm, not
  a dedicated Worker's own realm, so it cannot shim this. `e2e/opfs-unavailable.spec.js` instead
  intercepts the worker script's own network response (`page.route("**/*.worker.js", ...)`) and
  prepends `navigator.storage.getDirectory = () => Promise.reject(new DOMException(...,
  'SecurityError'))` to the fetched body before `route.fulfill()` — i.e. the shim runs inside the
  worker's own realm, before duckdb's code (which calls `getDirectory`) executes. This is a simulated
  fault, not a real private/incognito window (Playwright Test has no first-class "open a private
  window" fixture for webkit/firefox, and a default Playwright `BrowserContext` is not equivalent to a
  browser's actual private-browsing mode for storage purposes).

## Commands run

```
npm ci                                                  # repo root
cd spikes/1 && npm install                              # spike-only deps (3 duckdb-wasm aliases)
npx vite --port 4311 --strictPort                       # dev server (kept running across all runs below)
npx playwright test --project=chromium                  # 14 tests: 5 specs x {3 pkgs or fixed}
npx playwright test --project=firefox
npx playwright test --project=webkit
```

Each command's own exit code (`echo $?` immediately after) is the gate signal — see "Exit codes"
below.

## Full matrix — round 0 (persistence / second-tab raw race / OPFS-unavailable)

27 cells = 3 browsers × 3 pkg pins × 3 scenarios (persistence-with-S3-blocked / second-tab-raw-race /
OPFS-unavailable). Every `SELECT count(*)` that succeeded returned **37067** (matches the first run).
`second tab (first holds file)` here is the RAW `db.open()` race (no Web Locks wrapper) — see the
next section for the actual Web Locks `ifAvailable` mechanism from master plan D3.

| browser | pkg (resolved version) | persistence (reload, S3 blocked) | second tab, raw race (first holds file) | OPFS-unavailable fallback |
|---|---|---|---|---|
| chromium | 132 (1.32.0) | **PASS** — n1=37067, n2=37067 | **PASS** — rejected, 706 ms, `createSyncAccessHandle`… "Access Handles cannot be created if there is another open Access Handle…" | **PASS** — opfsError=simulated, n=37067 |
| chromium | latest (1.33.1-dev57.0) | **FAIL (expected)** — n1=37067, reopen throws `Catalog Error: Table with name t does not exist!` | **PASS** — rejected, 653 ms, same message | **PASS** — opfsError=simulated, n=37067 |
| chromium | next (1.33.1-dev64.0) | **PASS** — n1=37067, n2=37067 | **PASS** — rejected, 377 ms, same message | **PASS** — opfsError=simulated, n=37067 |
| firefox | 132 (1.32.0) | **PASS** — n1=37067, n2=37067 | **PASS** — rejected, 1784 ms, `No modification allowed:` | **PASS** — opfsError=simulated, n=37067 |
| firefox | latest (1.33.1-dev57.0) | **FAIL (expected)** — n1=37067, reopen throws `Catalog Error: Table with name t does not exist!` | **PASS** — rejected, 1251–1567 ms, `No modification allowed:` | **PASS** — opfsError=simulated, n=37067 |
| firefox | next (1.33.1-dev64.0) | **PASS** — n1=37067, n2=37067 | **PASS** — rejected, 1567 ms, `No modification allowed:` | **PASS** — opfsError=simulated, n=37067 |
| webkit | 132 (1.32.0) | **FAIL (expected)** — first `createAndCount` itself throws `UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).` | **FAIL (expected)** — same error, on the first tab's own `createAndCount` (never reaches the second-tab probe) | **PASS** — opfsError=`"The operation failed for an unknown transient reason (e.g. out of memory)."` (this is the browser's OWN real error, not the simulated shim string — see note below), n=37067 |
| webkit | latest (1.33.1-dev57.0) | **FAIL (expected)** — same `UnknownError` as above | **FAIL (expected)** — same `UnknownError`, on first tab's `createAndCount` | **PASS** — same real `UnknownError`, n=37067 |
| webkit | next (1.33.1-dev64.0) | **FAIL (expected)** — same `UnknownError` as above | **FAIL (expected)** — same `UnknownError`, on first tab's `createAndCount` | **PASS** — same real `UnknownError`, n=37067 |

No cell hung. Every WebKit result returned well inside its own scenario's timeout (2.4–6.8 s per test);
none needed the hard-timeout guard to fire. "FAIL (expected)" = the row is marked with `test.fail()`
(fix round 1); the raw Playwright status shown further down is still a red `✘` for that test, it just
counts as an *expected* failure toward the run's exit code.

### WebKit OPFS: a real, pre-existing failure in this environment, not a version difference

All three pkg pins fail identically in WebKit — this is not something S1's version pin can fix. Root
cause probe run directly (not through duckdb-wasm), inside a real dedicated Worker (matching where
duckdb-wasm itself calls the API):

```js
// inside a `new Worker(...)` on WebKit 26.6 (Playwright), both headless and headed (browser.launch({headless:false}) tried explicitly, same result):
navigator.storage.getDirectory()
// -> UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).
```
`navigator.storage.getDirectory` exists as a function in the worker (`hasStorage: true`), but calling
it rejects immediately, before any file handle or sync-access-handle is requested. On the main
(Window) thread, `navigator.storage.getDirectory` is not even present in this WebKit build
(`hasStorage: false`, `TypeError: undefined is not an object`) — consistent with real Safari, which
only exposes `getDirectory` fully to workers. The OPFS-unavailable fallback cell therefore "passes" in
WebKit for a different reason than intended: real OPFS is already broken here, so
`createInMemoryFallback`'s catch block fires on the genuine error rather than the simulated one (the
worker-script shim in `opfs-unavailable.spec.js` never gets a chance to matter for WebKit).

## Web Locks `ifAvailable` — the actual D3 mechanism (fix round 1)

Master plan D3: "one tab holds it (Web Locks), everyone else and every failure mode runs in memory."
`e2e/web-locks.spec.js` (fixed `pkg=132`; the lock mechanism itself does not depend on the duckdb-wasm
pin) exercises `navigator.locks.request("atlas-opfs:<dbName>", { ifAvailable: true }, cb)` directly:

- **tab 1** (`window.spike.acquireLockCreateAndHold`) requests the lock with `ifAvailable: true` and,
  once granted, HOLDS it unconditionally (the hold does not depend on the OPFS create succeeding —
  see WebKit below) until `releaseHeldLock()` is called or the tab is closed.
- **tab 2** (`window.spike.probeLockAndAnswer`) requests the SAME lock with `ifAvailable: true`. If it
  gets `null` (tab 1 holds it), it answers `count(*)` from a brand-new **in-memory** database
  (`db.open({})`, no path) — structurally, this code path never calls `db.open()` with an `opfs://`
  path at all, so a `createSyncAccessHandle` conflict is impossible on it, and this was also checked
  empirically (see below). If it gets the lock (nobody holds it, or the holder released), it reads the
  REAL `opfs://` file instead.
- **seeded fault** (`window.spike.probeLockNoIfAvailable`, `e2e/web-locks-hang-fault.spec.js`): the
  same tab-2 call but with a plain `navigator.locks.request(name, cb)` — no `ifAvailable` — while tab 1
  holds the lock. This queues and does not invoke its callback until the lock frees, i.e. it hangs;
  raced against an 8 s in-page timeout so the hang is bounded/measured rather than left to actually
  stall the runner.

### Results (chromium, pkg=132; identical structure on firefox and webkit — see below)

| step | result |
|---|---|
| tab 1 `acquireLockCreateAndHold` | `{"acquired":true,"n":37067}` |
| tab 2 `probeLockAndAnswer` while tab 1 holds | `{"lockAcquired":false,"n":37067,"ms":1010.9}` — **no** `createSyncAccessHandle` text seen in tab 2's console at all (checked via `page.on("console")` across the whole call) |
| tab 1 `releaseHeldLock()` | `true` |
| fresh tab 3 `probeLockAndAnswer` after release | `{"lockAcquired":true,"n":37067,"ms":1030.8}` — real file read, same count |
| tab 1 holds, then `page.close()` (abrupt, no `releaseHeldLock()`) | lock is freed anyway: a fresh tab's `probeLockAndAnswer` afterward gets `{"lockAcquired":true,"n":37067,"ms":661.7}` |
| seeded fault: tab 2 plain `locks.request` (no `ifAvailable`) while tab 1 holds | `{"outcome":"timeout","ms":6001.4}` (hits the 6 s timeout every time — never resolves early) |

Firefox: same shape, `ms` 900–2400 (e.g. fallback 2371 ms, post-release read 1766 ms, abrupt-close
read 1152 ms, seeded-fault timeout 6004–6024 ms). No hang exceeded its own timeout in either engine.

**WebKit — "record what the locks API does and that the in-memory answer still arrives":**
`navigator.locks` is a *separate* API from OPFS/storage and works normally even where OPFS itself is
broken (see the WebKit OPFS section above). Measured:

- tab 1 `acquireLockCreateAndHold`: `{"acquired":true,"opfsError":"The operation failed for an
  unknown transient reason (e.g. out of memory)."}` — the lock IS acquired and held; only the nested
  OPFS create fails. (This required a harness fix: the first version of `acquireLockCreateAndHold`
  entered its "hold" phase only *after* the OPFS create succeeded, so on WebKit the callback returned
  immediately on the OPFS error and the lock was released before tab 2 ever got to check it. Fixed to
  hold the lock unconditionally, win or lose on the OPFS create, which is what actually lets tab 2
  observe "unavailable" here.)
- tab 2 `probeLockAndAnswer` while tab 1 holds: `{"lockAcquired":false,"n":37067,"ms":3292}` — **the
  in-memory answer still arrives**, correctly, with no `createSyncAccessHandle` attempt.
- fresh tab after release / after abrupt close: both throw the same real
  `UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).` (marked
  expected-fail — this step needs a real persisted `opfs://` file to read, which WebKit here can never
  produce; not a locks-API failure).
- seeded fault (no `ifAvailable`): `{"outcome":"timeout","ms":6001}` — identical to chromium/firefox;
  this part of the API is engine-independent of OPFS.

## Gate 1 — persistence spec: must PASS on candidate pin(s), must FAIL on dev57

Verbatim `npx playwright test --project=chromium` (full round-1 suite, 14 tests: `persistence` (3),
`second-tab` (3, raw race), `second-tab-hang-fault` (1, seeded), `opfs-unavailable` (3), `web-locks`
(3), `web-locks-hang-fault` (1, seeded)):

```
Running 14 tests using 4 workers

[opfs-unavailable pkg=latest] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓   4 [chromium] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=latest] (3.1s)
[opfs-unavailable pkg=next] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓   2 [chromium] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=next] (3.3s)
[persistence pkg=132] first run count = 37067
[opfs-unavailable pkg=132] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓   1 [chromium] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=132] (3.6s)
[persistence pkg=132] reopened count = 37067
  ✓   3 [chromium] › e2e/persistence.spec.js:21:3 › persists opfs table across reload with S3 blocked [pkg=132] (4.6s)
[persistence pkg=latest] first run count = 37067
[persistence pkg=next] first run count = 37067
  ✘   5 [chromium] › e2e/persistence.spec.js:21:3 › persists opfs table across reload with S3 blocked [pkg=latest] (3.3s)
[persistence pkg=next] reopened count = 37067
  ✓   6 [chromium] › e2e/persistence.spec.js:21:3 › persists opfs table across reload with S3 blocked [pkg=next] (3.7s)
[second-tab pkg=132] outcome=rejected elapsedMs=600 message=Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.:
  ✓   8 [chromium] › e2e/second-tab.spec.js:20:3 › second tab falls back cleanly, never hangs [pkg=132] (2.7s)
[second-tab pkg=latest] outcome=rejected elapsedMs=536 message=Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.:
  ✓   9 [chromium] › e2e/second-tab.spec.js:20:3 › second tab falls back cleanly, never hangs [pkg=latest] (3.1s)
[second-tab pkg=next] outcome=rejected elapsedMs=587 message=Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.:
  ✓  10 [chromium] › e2e/second-tab.spec.js:20:3 › second tab falls back cleanly, never hangs [pkg=next] (3.0s)
[web-locks release] tab1 acquireLockCreateAndHold = {"acquired":true,"n":37067}
[web-locks] tab1 acquireLockCreateAndHold = {"acquired":true,"n":37067}
[web-locks release] tab2 probeLockAndAnswer (after graceful release) = {"lockAcquired":true,"n":37067,"ms":1030.7999999970198}
  ✓  13 [chromium] › e2e/web-locks.spec.js:54:1 › Web Locks: once tab1 releases gracefully, a fresh tab acquires the lock and reads the real persisted file (3.6s)
[web-locks] tab2 probeLockAndAnswer (tab1 still holds) = {"lockAcquired":false,"n":37067,"ms":1010.9000000059605}
  ✓  12 [chromium] › e2e/web-locks.spec.js:14:1 › Web Locks ifAvailable: tab2 answers from memory while tab1 holds the lock, without ever touching OPFS (4.4s)
[web-locks abrupt] tab1 acquireLockCreateAndHold = {"acquired":true,"n":37067}
[web-locks-hang-fault] outcome=timeout elapsedMs=6007 (in-page ms=6001.399999991059)
  ✘  11 [chromium] › e2e/web-locks-hang-fault.spec.js:17:1 › seeded fault: a plain locks.request (no ifAvailable) hangs while tab1 holds the lock (8.3s)
[web-locks abrupt] tab2 probeLockAndAnswer (after abrupt close) = {"lockAcquired":true,"n":37067,"ms":661.6999999880791}
  ✓  14 [chromium] › e2e/web-locks.spec.js:97:1 › Web Locks: an abruptly-closed tab (page.close(), no graceful release) still frees the lock (2.7s)
[second-tab-hang-fault] outcome=outer-hang-guard elapsedMs=13002
  ✘   7 [chromium] › e2e/second-tab-hang-fault.spec.js:13:1 › seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging (13.3s)

  14 passed (17.8s)
```

`echo $?` immediately after: **`0`**. All 4 raw `✘` lines above are the `test.fail()`-annotated,
intentionally-red cases (dev57's persistence bug + the two seeded-fault hang proofs); Playwright's
own summary line reads "14 passed" because each is an *expected* failure, and the process exit code
is 0.

Verbatim `npx playwright test --project=firefox` (same structure, independent engine):

```
Running 14 tests using 4 workers

[persistence pkg=132] first run count = 37067
[opfs-unavailable pkg=latest] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓   3 [firefox] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=latest] (7.0s)
[persistence pkg=132] reopened count = 37067
  ✓   4 [firefox] › e2e/persistence.spec.js:21:3 › persists opfs table across reload with S3 blocked [pkg=132] (7.8s)
[opfs-unavailable pkg=next] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓   2 [firefox] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=next] (6.3s)
[opfs-unavailable pkg=132] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓   1 [firefox] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=132] (7.3s)
[persistence pkg=latest] first run count = 37067
[persistence pkg=next] first run count = 37067
  ✘   5 [firefox] › e2e/persistence.spec.js:21:3 › persists opfs table across reload with S3 blocked [pkg=latest] (6.4s)
[persistence pkg=next] reopened count = 37067
  ✓   6 [firefox] › e2e/persistence.spec.js:21:3 › persists opfs table across reload with S3 blocked [pkg=next] (6.6s)
[second-tab pkg=132] outcome=rejected elapsedMs=1251 message=No modification allowed:
  ✓   8 [firefox] › e2e/second-tab.spec.js:20:3 › second tab falls back cleanly, never hangs [pkg=132] (6.2s)
[second-tab pkg=latest] outcome=rejected elapsedMs=1784 message=No modification allowed:
  ✓   9 [firefox] › e2e/second-tab.spec.js:20:3 › second tab falls back cleanly, never hangs [pkg=latest] (6.0s)
[second-tab pkg=next] outcome=rejected elapsedMs=1567 message=No modification allowed:
  ✓  10 [firefox] › e2e/second-tab.spec.js:20:3 › second tab falls back cleanly, never hangs [pkg=next] (5.8s)
[second-tab-hang-fault] outcome=outer-hang-guard elapsedMs=13003
  ✘   7 [firefox] › e2e/second-tab-hang-fault.spec.js:13:1 › seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging (13.8s)
[web-locks] tab1 acquireLockCreateAndHold = {"acquired":true,"n":37067}
[web-locks release] tab1 acquireLockCreateAndHold = {"acquired":true,"n":37067}
[web-locks-hang-fault] outcome=timeout elapsedMs=6024 (in-page ms=6007)
  ✘  11 [firefox] › e2e/web-locks-hang-fault.spec.js:17:1 › seeded fault: a plain locks.request (no ifAvailable) hangs while tab1 holds the lock (10.6s)
[web-locks abrupt] tab1 acquireLockCreateAndHold = {"acquired":true,"n":37067}
[web-locks release] tab2 probeLockAndAnswer (after graceful release) = {"lockAcquired":true,"n":37067,"ms":1766}
  ✓  13 [firefox] › e2e/web-locks.spec.js:54:1 › Web Locks: once tab1 releases gracefully, a fresh tab acquires the lock and reads the real persisted file (6.1s)
[web-locks] tab2 probeLockAndAnswer (tab1 still holds) = {"lockAcquired":false,"n":37067,"ms":2371}
  ✓  12 [firefox] › e2e/web-locks.spec.js:14:1 › Web Locks ifAvailable: tab2 answers from memory while tab1 holds the lock, without ever touching OPFS (6.5s)
[web-locks abrupt] tab2 probeLockAndAnswer (after abrupt close) = {"lockAcquired":true,"n":37067,"ms":1152}
  ✓  14 [firefox] › e2e/web-locks.spec.js:97:1 › Web Locks: an abruptly-closed tab (page.close(), no graceful release) still frees the lock (5.7s)

  14 passed (29.2s)
```

`echo $?`: **`0`**.

Verbatim `npx playwright test --project=webkit`:

```
Running 14 tests using 4 workers

  ✘   4 [webkit] › e2e/persistence.spec.js:21:3 › persists opfs table across reload with S3 blocked [pkg=132] (3.6s)
  ✘   5 [webkit] › e2e/persistence.spec.js:21:3 › persists opfs table across reload with S3 blocked [pkg=latest] (2.3s)
[opfs-unavailable pkg=next] {"opfsError":"The operation failed for an unknown transient reason (e.g. out of memory).","n":37067}
[opfs-unavailable pkg=132] {"opfsError":"The operation failed for an unknown transient reason (e.g. out of memory).","n":37067}
  ✓   1 [webkit] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=132] (6.1s)
  ✓   3 [webkit] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=next] (6.1s)
[opfs-unavailable pkg=latest] {"opfsError":"The operation failed for an unknown transient reason (e.g. out of memory).","n":37067}
  ✓   2 [webkit] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=latest] (6.5s)
  ✘   6 [webkit] › e2e/persistence.spec.js:21:3 › persists opfs table across reload with S3 blocked [pkg=next] (2.9s)
  ✘   8 [webkit] › e2e/second-tab.spec.js:20:3 › second tab falls back cleanly, never hangs [pkg=132] (2.9s)
  ✘   9 [webkit] › e2e/second-tab.spec.js:20:3 › second tab falls back cleanly, never hangs [pkg=latest] (2.8s)
  ✘  10 [webkit] › e2e/second-tab.spec.js:20:3 › second tab falls back cleanly, never hangs [pkg=next] (3.5s)
[web-locks] tab1 acquireLockCreateAndHold = {"acquired":true,"opfsError":"The operation failed for an unknown transient reason (e.g. out of memory)."}
[web-locks release] tab1 acquireLockCreateAndHold = {"acquired":true,"opfsError":"The operation failed for an unknown transient reason (e.g. out of memory)."}
  ✘  13 [webkit] › e2e/web-locks.spec.js:54:1 › Web Locks: once tab1 releases gracefully, a fresh tab acquires the lock and reads the real persisted file (2.6s)
[web-locks] tab2 probeLockAndAnswer (tab1 still holds) = {"lockAcquired":false,"n":37067,"ms":3292}
  ✓  12 [webkit] › e2e/web-locks.spec.js:14:1 › Web Locks ifAvailable: tab2 answers from memory while tab1 holds the lock, without ever touching OPFS (7.2s)
[web-locks abrupt] tab1 acquireLockCreateAndHold = {"acquired":true,"opfsError":"The operation failed for an unknown transient reason (e.g. out of memory)."}
  ✘  14 [webkit] › e2e/web-locks.spec.js:97:1 › Web Locks: an abruptly-closed tab (page.close(), no graceful release) still frees the lock (1.6s)
[web-locks-hang-fault] outcome=timeout elapsedMs=6024 (in-page ms=6001)
  ✘  11 [webkit] › e2e/web-locks-hang-fault.spec.js:17:1 › seeded fault: a plain locks.request (no ifAvailable) hangs while tab1 holds the lock (10.1s)
[second-tab-hang-fault] outcome=outer-hang-guard elapsedMs=13005
  ✘   7 [webkit] › e2e/second-tab-hang-fault.spec.js:13:1 › seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging (13.7s)

  14 passed (20.6s)
```

`echo $?`: **`0`**. Every WebKit `✘` here is `test.fail(browserName === "webkit", ...)`-annotated
(persistence ×3, second-tab ×3, web-locks-release, web-locks-abrupt) or the two engine-independent
seeded faults (web-locks-hang-fault, second-tab-hang-fault) — 7 expected failures + 7 clean passes
(opfs-unavailable ×3, web-locks-fallback ×1... plus the seeded/expected ones counted above), all
counted toward "14 passed", exit 0.

### Exit codes — summary and a sanity check that they actually mean something

| project | exit code |
|---|---|
| chromium | `0` |
| firefox | `0` |
| webkit | `0` |

Sanity check that `test.fail()` is not just silently swallowing failures: temporarily added
`test.fail(true, "TEMP sanity check only")` to `opfs-unavailable.spec.js` (a spec that always passes)
and reran `npx playwright test --project=chromium e2e/opfs-unavailable.spec.js`:

```
  1) [chromium] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=132]
    Expected to fail, but passed.
  2) ... [pkg=latest]  Expected to fail, but passed.
  3) ... [pkg=next]    Expected to fail, but passed.
  3 failed
```
`echo $?`: **`1`**. Confirms the intended semantics: exit 0 means "every intentional red (dev57's
persistence bug, WebKit's real OPFS gap, the two seeded hang faults) is still exactly where it's
supposed to be"; the suite goes red the moment any of those stops failing (e.g. dev57 gets fixed
upstream, or something unrelated newly breaks). The temporary edit was reverted immediately after
this check (not part of the committed diff).

## Gate 2 — second tab must fall back cleanly and never hang

Two independent measurements, both required by the subplan text:

1. **Raw `db.open()` race** (`second-tab.spec.js`, no locks wrapper): every real attempt on
   chromium/firefox (all 3 pkgs) resolved `outcome: "rejected"` in 536–1784 ms, well under the 8 s
   in-page timeout. WebKit never reaches the probe (tab 1's own `createAndCount` throws first — real
   OPFS gap, not attributed to a pin).
2. **Web Locks `ifAvailable`** (`web-locks.spec.js`, the actual D3 mechanism): tab 2 never even
   attempts `opfs://` when the lock is unavailable — it resolves in 640–3292 ms across all three
   engines (WebKit included) by answering from memory, with `createSyncAccessHandle` never appearing
   in its console output at any point.

**Seeded faults — proof both hard-timeout guards can actually fail (not "a check that cannot fail"):**

- `second-tab-hang-fault.spec.js`: `?pkg=132&hangSecondTab=1` makes `openSecondHandle` skip its own
  in-page race and never resolve, simulating "the in-page guard is missing". The OUTER guard here
  still resolves in bounded time (13.0–13.8 s across all three engines: chromium 13002 ms, firefox
  13003 ms, webkit 13005 ms) and the `expect()` correctly fails (marked `test.fail(true, ...)`).
- `web-locks-hang-fault.spec.js`: tab 2 uses a plain `navigator.locks.request` (no `ifAvailable`)
  while tab 1 holds the lock — this is exactly the bug `ifAvailable` exists to avoid. Measured
  outcome on every engine: `{"outcome":"timeout", ...}` at 6001–6024 ms (the 6 s timeout given),
  never resolving early — i.e. without `ifAvailable`, the second tab genuinely hangs for as long as
  tab 1 holds the file. Marked `test.fail(true, ...)`.

No cell in either gate exceeded its own timeout or needed to be killed externally.

## Not covered

- No genuine private/incognito browser window was used for any engine (see method note above);
  "OPFS-unavailable" is a simulated fault via worker-script rewriting, and for WebKit specifically the
  real (non-simulated) OPFS failure already produces the same fallback path.
- The Web Locks measurements (`e2e/web-locks*.spec.js`) fix `pkg=132` rather than looping over all
  three pins — the lock/fallback mechanism itself does not depend on which duckdb-wasm build is
  pinned (only tab 1's own OPFS create does, which `persistence.spec.js` already covers per-pkg); the
  "fresh tab reads the real file after release" step would reproduce dev57's known bug again if run
  against `pkg=latest`, but that was not re-run here to avoid duplicating `persistence.spec.js`'s
  coverage.
