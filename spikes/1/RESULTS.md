# S1 · OPFS persistence pin — raw measurements

Measurements only. No verdict, no recommendation — that is Opus's review step (atlas-0's Steps/Review
checklist). This file records exact commands, exact versions, exact numbers, and verbatim gate output.

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
  SQL/OPFS logic (`createAndCount`, `reopenAndCount`, `release`, `openSecondHandle`,
  `createInMemoryFallback`) that the Playwright specs drive via `page.evaluate()`.
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
npm ci                                                 # repo root
cd spikes/1 && npm install                             # spike-only deps (3 duckdb-wasm aliases)
npx vite --port 4311 --strictPort                      # dev server (kept running across all runs below)
npx playwright test --project=chromium                 # 9 tests: 3 specs x 3 pkgs
npx playwright test --project=webkit
npx playwright test --project=firefox
npx playwright test e2e/second-tab-hang-fault.spec.js   # seeded-fault proof, all 3 projects
```

## Full matrix

27 cells = 3 browsers × 3 pkg pins × 3 scenarios (persistence-with-S3-blocked / second-tab /
OPFS-unavailable). Every `SELECT count(*)` that succeeded returned **37067** (matches the first run).

| browser | pkg (resolved version) | persistence (reload, S3 blocked) | second tab (first holds file) | OPFS-unavailable fallback |
|---|---|---|---|---|
| chromium | 132 (1.32.0) | **PASS** — n1=37067, n2=37067 | **PASS** — rejected, 706 ms, `createSyncAccessHandle`… "Access Handles cannot be created if there is another open Access Handle…" | **PASS** — opfsError=simulated, n=37067 |
| chromium | latest (1.33.1-dev57.0) | **FAIL** — n1=37067, reopen throws `Catalog Error: Table with name t does not exist!` | **PASS** — rejected, 653 ms, same message | **PASS** — opfsError=simulated, n=37067 |
| chromium | next (1.33.1-dev64.0) | **PASS** — n1=37067, n2=37067 | **PASS** — rejected, 377 ms, same message | **PASS** — opfsError=simulated, n=37067 |
| firefox | 132 (1.32.0) | **PASS** — n1=37067, n2=37067 | **PASS** — rejected, 1238 ms, `No modification allowed:` | **PASS** — opfsError=simulated, n=37067 |
| firefox | latest (1.33.1-dev57.0) | **FAIL** — n1=37067, reopen throws `Catalog Error: Table with name t does not exist!` | **PASS** — rejected, 958 ms, `No modification allowed:` | **PASS** — opfsError=simulated, n=37067 |
| firefox | next (1.33.1-dev64.0) | **PASS** — n1=37067, n2=37067 | **PASS** — rejected, 997 ms, `No modification allowed:` | **PASS** — opfsError=simulated, n=37067 |
| webkit | 132 (1.32.0) | **FAIL** — first `createAndCount` itself throws `UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).` | **FAIL** — same error, on the first tab's own `createAndCount` (never reaches the second-tab probe) | **PASS** — opfsError=`"The operation failed for an unknown transient reason (e.g. out of memory)."` (this is the browser's OWN real error, not the simulated shim string — see note below), n=37067 |
| webkit | latest (1.33.1-dev57.0) | **FAIL** — same `UnknownError` as above | **FAIL** — same `UnknownError`, on first tab's `createAndCount` | **PASS** — same real `UnknownError`, n=37067 |
| webkit | next (1.33.1-dev64.0) | **FAIL** — same `UnknownError` as above | **FAIL** — same `UnknownError`, on first tab's `createAndCount` | **PASS** — same real `UnknownError`, n=37067 |

No cell hung. Every WebKit result returned well inside its own scenario's timeout (2.4–6.8 s per test);
none needed the hard-timeout guard to fire.

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

## Gate 1 — persistence spec: must PASS on candidate pin(s), must FAIL on dev57

Verbatim `npx playwright test --project=chromium` (chosen because it is the one engine where the
gate has clean pass/fail signal — see WebKit note above; firefox reproduces the identical pass/fail
split, verbatim further down):

```
Running 9 tests using 4 workers

[opfs-unavailable pkg=132] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓  2 [chromium] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=132] (3.0s)
[opfs-unavailable pkg=latest] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓  1 [chromium] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=latest] (3.1s)
[opfs-unavailable pkg=next] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓  3 [chromium] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=next] (3.5s)
[persistence pkg=132] first run count = 37067
[persistence pkg=132] reopened count = 37067
  ✓  4 [chromium] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=132] (4.8s)
[persistence pkg=latest] first run count = 37067
[persistence pkg=next] first run count = 37067
[second-tab pkg=132] outcome=rejected elapsedMs=706 message=Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.:
  ✓  7 [chromium] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=132] (3.5s)
[persistence pkg=next] reopened count = 37067
  ✓  6 [chromium] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=next] (4.3s)
  ✘  5 [chromium] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=latest] (4.5s)
[second-tab pkg=latest] outcome=rejected elapsedMs=653 message=Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.:
  ✓  8 [chromium] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=latest] (3.5s)
[second-tab pkg=next] outcome=rejected elapsedMs=377 message=Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.:
  ✓  9 [chromium] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=next] (3.4s)


  1) [chromium] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=latest] 

    Error: page.evaluate: Error: Catalog Error: Table with name t does not exist!
    Did you mean "pg_tables"?

    LINE 1: SELECT count(*)::BIGINT AS n FROM t
                                              ^

      32 |     await page.waitForFunction(() => !!window.spike);
      33 |
    > 34 |     const n2 = await page.evaluate(async ({ dbName }) => window.spike.reopenAndCount(dbName), {
         |                           ^
      35 |       dbName,
      36 |     });
      37 |     console.log(`[persistence pkg=${pkg}] reopened count = ${n2}`);
        at f.onMessage (http://localhost:4311/node_modules/duckdb-wasm-latest-dev57/dist/duckdb-browser.mjs?v=e5e4c80e:1:11938)
        at f.onMessage (http://localhost:4311/node_modules/duckdb-wasm-latest-dev57/dist/duckdb-browser.mjs?v=e5e4c80e:1:11938)
        at /Users/bbest/Github/MarineSensitivity/atlas/.claude/worktrees/agent-ad0e36bab80099108/spikes/1/e2e/persistence.spec.js:34:27

    Error Context: test-results/persistence-persists-opfs--ebd8b-with-S3-blocked-pkg-latest--chromium/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/persistence-persists-opfs--ebd8b-with-S3-blocked-pkg-latest--chromium/trace.zip
    Usage:

        npx playwright show-trace test-results/persistence-persists-opfs--ebd8b-with-S3-blocked-pkg-latest--chromium/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  1 failed
    [chromium] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=latest] 
  8 passed (11.2s)
```

Result: 8 passed, 1 failed — the 1 failure is exactly `pkg=latest` (dev57) in `persistence.spec.js`,
every other combination (including dev57's own second-tab and opfs-unavailable cells) passed. This is
the proof the test can see the bug: same harness, same page, only the pinned duckdb-wasm build differs.

Verbatim `npx playwright test --project=firefox` (same split, independent engine):

```
Running 9 tests using 4 workers

[opfs-unavailable pkg=next] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓  4 [firefox] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=next] (4.7s)
[opfs-unavailable pkg=latest] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓  2 [firefox] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=latest] (5.1s)
[opfs-unavailable pkg=132] {"opfsError":"simulated: OPFS unavailable (private mode)","n":37067}
  ✓  3 [firefox] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=132] (5.7s)
[persistence pkg=132] first run count = 37067
[persistence pkg=latest] first run count = 37067
[persistence pkg=132] reopened count = 37067
  ✓  1 [firefox] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=132] (7.2s)
[persistence pkg=next] first run count = 37067
[persistence pkg=next] reopened count = 37067
  ✓  6 [firefox] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=next] (6.0s)
  ✘  5 [firefox] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=latest] (6.3s)
[second-tab pkg=132] outcome=rejected elapsedMs=1238 message=No modification allowed:
  ✓  7 [firefox] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=132] (5.6s)
[second-tab pkg=latest] outcome=rejected elapsedMs=958 message=No modification allowed:
  ✓  8 [firefox] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=latest] (4.9s)
[second-tab pkg=next] outcome=rejected elapsedMs=997 message=No modification allowed:
  ✓  9 [firefox] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=next] (4.0s)


  1) [firefox] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=latest] 

    Error: page.evaluate: Catalog Error: Table with name t does not exist!
    Did you mean "pg_tables"?

    LINE 1: SELECT count(*)::BIGINT AS n FROM t
                                              ^
    onMessage@http://localhost:4311/node_modules/duckdb-wasm-latest-dev57/dist/duckdb-browser.mjs?v=e5e4c80e:1:11938
    EventListener.handleEvent*attach@http://localhost:4311/node_modules/duckdb-wasm-latest-dev57/dist/duckdb-browser.mjs?v=e5e4c80e:1:10436
    f@http://localhost:4311/node_modules/duckdb-wasm-latest-dev57/dist/duckdb-browser.mjs?v=e5e4c80e:1:10322
    createDb@http://localhost:4311/src/bundles.js:64:14
    async*reopenAndCount@http://localhost:4311/src/main.js:46:34
    @debugger eval code line 311 > eval:3:24
    evaluate@debugger eval code:313:16
    @debugger eval code:1:44
    @debugger eval code:1:62

        at onMessage@http://localhost:4311/node_modules/duckdb-wasm-latest-dev57/dist/duckdb-browser.mjs?v=e5e4c80e:1:11938
        at EventListener.handleEvent*attach@http://localhost:4311/node_modules/duckdb-wasm-latest-dev57/dist/duckdb-browser.mjs?v=e5e4c80e:1:10436
        at f@http://localhost:4311/node_modules/duckdb-wasm-latest-dev57/dist/duckdb-browser.mjs?v=e5e4c80e:1:10322
        at createDb@http://localhost:4311/src/bundles.js:64:14
        at async*reopenAndCount@http://localhost:4311/src/main.js:46:34
        at @debugger eval code line 311 > eval:3:24
        at evaluate@debugger eval code:313:16
        at @debugger eval code:1:44
        at @debugger eval code:1:62
        at /Users/bbest/Github/MarineSensitivity/atlas/.claude/worktrees/agent-ad0e36bab80099108/spikes/1/e2e/persistence.spec.js:34:27

    Error Context: test-results/persistence-persists-opfs--ebd8b-with-S3-blocked-pkg-latest--firefox/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/persistence-persists-opfs--ebd8b-with-S3-blocked-pkg-latest--firefox/trace.zip
    Usage:

        npx playwright show-trace test-results/persistence-persists-opfs--ebd8b-with-S3-blocked-pkg-latest--firefox/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  1 failed
    [firefox] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=latest] 
  8 passed (16.9s)
```

Verbatim `npx playwright test --project=webkit` (all 3 pkgs fail identically — the pre-existing
environment-level OPFS failure described above, not a version-specific split):

```
Running 9 tests using 4 workers

[opfs-unavailable pkg=132] {"opfsError":"The operation failed for an unknown transient reason (e.g. out of memory).","n":37067}
  ✓  1 [webkit] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=132] (6.1s)
[opfs-unavailable pkg=latest] {"opfsError":"The operation failed for an unknown transient reason (e.g. out of memory).","n":37067}
  ✓  4 [webkit] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=latest] (6.5s)
[opfs-unavailable pkg=next] {"opfsError":"The operation failed for an unknown transient reason (e.g. out of memory).","n":37067}
  ✓  2 [webkit] › e2e/opfs-unavailable.spec.js:16:3 › falls back to in-memory when OPFS is unavailable [pkg=next] (6.8s)
  ✘  3 [webkit] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=132] (6.2s)
  ✘  6 [webkit] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=next] (4.6s)
  ✘  5 [webkit] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=latest] (5.0s)
  ✘  7 [webkit] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=132] (4.6s)
  ✘  8 [webkit] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=latest] (2.7s)
  ✘  9 [webkit] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=next] (2.4s)


  1) [webkit] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=132] 

    Error: page.evaluate: UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).

      18 |     await page.waitForFunction(() => !!window.spike);
      19 |
    > 20 |     const n1 = await page.evaluate(
         |                           ^
      21 |       async ({ dbName, sourceUrl }) => window.spike.createAndCount(dbName, sourceUrl),
      22 |       { dbName, sourceUrl: SOURCE_URL },
      23 |     );
        at /Users/bbest/Github/MarineSensitivity/atlas/.claude/worktrees/agent-ad0e36bab80099108/spikes/1/e2e/persistence.spec.js:20:27

  (same UnknownError, same stack shape, repeated for pkg=latest, pkg=next, and all three second-tab.spec.js cases — the first `createAndCount` call itself throws before any pin-specific behavior can run)

  6 failed
    [webkit] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=132] 
    [webkit] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=latest] 
    [webkit] › e2e/persistence.spec.js:14:3 › persists opfs table across reload with S3 blocked [pkg=next] 
    [webkit] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=132] ──
    [webkit] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=latest] 
    [webkit] › e2e/second-tab.spec.js:15:3 › second tab falls back cleanly, never hangs [pkg=next] ─
  3 passed (17.8s)
```

## Gate 2 — second tab must fall back cleanly and never hang

From the chromium/firefox runs above: every real second-tab attempt (both engines, all 3 pkgs)
resolved as `outcome: "rejected"` in 377–1238 ms, well under the 8 s in-page timeout — none needed
the hard-timeout guard. WebKit never reaches the second-tab probe at all in this environment (the
first tab's own `createAndCount` already throws — see Gate 1's WebKit output).

**Seeded fault — proof the hard-timeout guard can actually fail (not "a check that cannot fail"):**
`e2e/second-tab-hang-fault.spec.js` loads with `?pkg=132&hangSecondTab=1`, which makes
`window.spike.openSecondHandle` (src/main.js) skip its own in-page race and return a promise that
never resolves — simulating "the in-page guard is missing/broken". The spec's OUTER guard (same
`Promise.race` shape as `second-tab.spec.js`) must still resolve within bounded time and the
resulting `expect()` must fail. Verbatim `npx playwright test e2e/second-tab-hang-fault.spec.js`
(all 3 projects):

```
  1) [chromium] › e2e/second-tab-hang-fault.spec.js:13:1 › seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging

    Error: second tab must not hang (seeded fault: this must fail)

    expect(received).not.toBe(expected) // Object.is equality

    Expected: not "outer-hang-guard"

    > 37 |   expect(result.outcome, "second tab must not hang (seeded fault: this must fail)").not.toBe(
         |                                                                                         ^
      38 |     "outer-hang-guard",
      39 |   );

  2) [webkit] › e2e/second-tab-hang-fault.spec.js:13:1 › seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging
     (identical assertion failure)

  3) [firefox] › e2e/second-tab-hang-fault.spec.js:13:1 › seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging
     (identical assertion failure)

  3 failed
    [chromium] › e2e/second-tab-hang-fault.spec.js:13:1 › seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging
    [webkit] › e2e/second-tab-hang-fault.spec.js:13:1 › seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging
    [firefox] › e2e/second-tab-hang-fault.spec.js:13:1 › seeded fault: a hung in-page attempt is still caught by the outer guard, not left hanging
```

Console line preceding each chromium/webkit/firefox failure: `[second-tab-hang-fault]
outcome=outer-hang-guard elapsedMs=13002` (13.0 s ≈ `IN_PAGE_TIMEOUT_MS` (8000) +
`OUTER_GUARD_MS - IN_PAGE_TIMEOUT_MS` (5000) exactly). All three runs completed and failed in bounded
time (13.0–13.3 s each) — the seeded hang never actually hung the test runner, and the assertion
correctly reports it as a failure.

## Not covered

- No genuine private/incognito browser window was used for any engine (see method note above);
  "OPFS-unavailable" is a simulated fault via worker-script rewriting, and for WebKit specifically the
  real (non-simulated) OPFS failure already produces the same fallback path.
- `Web Locks ifAvailable` specifically was not exercised as a distinct code path — the measurement
  taken is what `db.open()` itself does when a second handle is requested for a file already open
  elsewhere (it rejects, in both chromium and firefox, without any `navigator.locks` wrapping added by
  this harness).
