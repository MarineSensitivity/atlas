# engine/ — DuckDB-WASM extension mirror: eh vs mvp, and cross-origin

atlas-2 Step 3 (Sonnet half). This is the engine note atlas-0's hand-over asked this step to write:
measure the `mvp` bundle flavour (never selected in `docs/spikes/S1.md`/`S3.md` — every engine in
those spikes picked `eh`), and measure whether a cross-origin `custom_extension_repository` works at
all (neither spike tried it — S3.md's own gap list: "the extension mirror was tested for parquet
only, on wasm_eh, in chromium").

Harness: `tests/fixtures/engine-e2e/` (a standalone Vite app booting the real
`src/lib/engine/{engine,bundles,sql,smoke}.ts`, port 4391) + its Playwright specs, run
`npm run duckdb:fetch-ext && npm run e2e:engine` (chromium, firefox, webkit). Every number and
message below is copied verbatim from a real run on 2026-09-21 (macOS 15.7.1, Node 24, this
worktree).

## The mirror itself

`scripts/fetch-duckdb-extensions.mjs` fetches the `parquet` extension for both platforms, keyed by
the DuckDB **engine** version baked into the pinned `@duckdb/duckdb-wasm@1.32.0` (`v1.4.3`, not the
npm version — `src/lib/engine/bundles.ts`'s `DUCKDB_ENGINE_VERSION`):

| platform   | URL                                                                           | bytes                                                                |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `wasm_eh`  | `https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm`  | 3,045,039 (matches `docs/spikes/S3.md`'s own eh measurement exactly) |
| `wasm_mvp` | `https://extensions.duckdb.org/v1.4.3/wasm_mvp/parquet.duckdb_extension.wasm` | 2,867,304 (**new**: never fetched or measured before this step)      |

Written into `public/duckdb-ext/v1.4.3/{wasm_eh,wasm_mvp}/parquet.duckdb_extension.wasm`
(gitignored — re-fetched, not committed). `.github/workflows/pages.yml`'s `checks` job runs
`node scripts/fetch-duckdb-extensions.mjs` before `npx vite build`, so the mirror ships in every
published `dist/`; `npx vite build` copies both files through Vite's `publicDir` into
`dist/duckdb-ext/v1.4.3/{wasm_eh,wasm_mvp}/parquet.duckdb_extension.wasm` unchanged (verified by
hand). `spatial`/`json` are deliberately not mirrored (`docs/spikes/S4.md` "Where DuckDB extensions
are hosted" — unchanged by this step).

**The mirror is a supply-chain input, pinned.** `scripts/duckdb-extensions.manifest.json` commits
the exact byte size and sha256 of every mirrored file (re-measured 2026-09-21; a fresh re-download
hashed identically, confirming `extensions.duckdb.org` serves byte-identical content):

| platform   | bytes     | sha256                                                             |
| ---------- | --------- | ------------------------------------------------------------------ |
| `wasm_eh`  | 3,045,039 | `22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55` |
| `wasm_mvp` | 2,867,304 | `0785c6c95d003eff4faa7b3b4b660f02c9c92f6d68d135ddf330d42e3a650600` |

`scripts/fetch-duckdb-extensions.mjs` verifies every download against this manifest and fails
(non-zero exit, nothing written) on a size or hash mismatch — an unexpectedly different file from a
third party is refused, not silently shipped. `scripts/check-duckdb-ext.mjs` (`npm run
check:duckdb-ext`, wired into `pages.yml` after `vite build`) re-verifies the same manifest against
whatever actually ended up in `dist/duckdb-ext/`, AND confirms neither pinned file is reachable from
`index.html`'s STATIC import graph (`assertMirrorNotInStaticGraph`, reusing
`size-budget-core.mjs`'s own static-graph walk) — the mirror must only ever be fetched at runtime by
DuckDB's own extension-autoload, never bundled. Both checks (missing file, tampered
byte/hash) are covered by named, seeded-fault tests in `tests/check-duckdb-ext.test.ts`.

**Published size added: 5,912,343 B (5.64 MiB)** for both platforms together (3,045,039 + 2,867,304),
entirely OUTSIDE the size budget: `size-budget.mjs`'s static-graph walk never visits `duckdb-ext/`
(publicDir copies have no entry in `dist/.vite/manifest.json` at all — there is nothing for the
walk to follow), confirmed by a real `npm run build && node scripts/size-budget.mjs` (11.5 KB gzip
static, unaffected by the mirror's presence) and by `assertMirrorNotInStaticGraph`'s own test suite.

## eh vs mvp — both work, forced explicitly

`selectBundle()` picked `eh` by default in every browser here too (same as S1/S3), so `mvp` was
forced by offering ONLY the `mvp` bundle key (`tests/fixtures/engine-e2e/main.ts`'s `bundlesFor()`).
Both flavours, with `extensions.duckdb.org` network-blocked and the same-origin mirror set, read
`marine-atlas/v9/tables/taxon.parquet` (a real, public bucket fetch — no fixture) and return exactly
**37,067** rows, on all three engines:

| platform       | chromium   | firefox    | webkit     |
| -------------- | ---------- | ---------- | ---------- |
| `eh`           | PASS 37067 | PASS 37067 | PASS 37067 |
| `mvp` (forced) | PASS 37067 | PASS 37067 | PASS 37067 |

## A relative `custom_extension_repository` breaks silently — worth stating explicitly

Not asked for, but found while building this fixture: the extension-autoload fetch runs **inside
the DuckDB worker**, whose own script location differs from the page's. A relative repository value
(e.g. the literal string `"./duckdb-ext"`) resolves against the _worker's_ location, not the page's,
and fails — on `eh` with "signature is either missing or invalid" (DuckDB fetched the wrong,
non-WASM response and rejected it), and on `mvp` with an unrelated-looking low-level `_setThrew is
not defined`. `src/lib/engine/engine.ts`'s `defaultExtensionRepository()` avoids this by building an
**absolute** URL from `document.baseURI` on the main thread before it ever reaches the worker; this
is why the option exists at all rather than a hand-rolled relative string, and this fixture's first
run caught exactly this class of bug (documented inline in `main.ts`, reverted before this note).

## Cross-origin `custom_extension_repository`: works, but only with CORS

The app's own data fetches already cross an origin boundary in production
(`src/lib/release/dataBase.ts`'s `PUBLIC_DATA_BASE` is the S3 bucket, a different origin than either
host the app is served from) — that already works because the bucket answers CORS for those objects.
This measures whether DuckDB-WASM's **own internal** extension-autoload fetch is subject to the same
mechanism, using a local "foreign origin" static server (`tests/fixtures/engine-e2e/foreign-server.mjs`,
port 4392) standing in for hosting the mirror on the bucket, since the real bucket is read-only here:

| foreign origin                        | chromium                            | firefox                                | webkit                                                   |
| ------------------------------------- | ----------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| WITHOUT `Access-Control-Allow-Origin` | FAIL: `function signature mismatch` | FAIL: `Extension ... is not available` | FAIL: `call_indirect to a signature that does not match` |
| WITH `Access-Control-Allow-Origin: *` | PASS 37067                          | PASS 37067                             | PASS 37067                                               |

**Conclusion: a cross-origin repository works**, subject to ordinary CORS — the same rule that
already governs every other cross-origin fetch this app makes. If the extension mirror is ever
hosted on the bucket instead of same-origin under `dist/duckdb-ext/`, it needs the bucket's existing
CORS policy to cover `duckdb-ext/*` the same way it already covers `tables/*`/`manifest.json`; no
DuckDB-specific allowance is needed beyond that.

## Extension mirror unset + CDN blocked: the user-visible failure, per browser

The seeded fault `tests/fixtures/engine-e2e/e2e/extension-unset.spec.ts` runs: no
`custom_extension_repository` set, `**/extensions.duckdb.org/**` blocked, then a `read_parquet()`.
`docs/spikes/S3.md` called the underlying failure "not a catchable error... a WASM-level crash" —
true at the SQL-error layer, but it IS a rejected promise a surrounding `try`/`catch` catches (same
finding as S3's own gate re-run), which is why `Engine#exec`/`#load` can normalize it. The **raw**
message differs by engine — every one of these was copied verbatim from a real run:

| browser  | raw message                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| chromium | `RuntimeError: function signature mismatch` (the whole message; no `Extension Autoloading Error` wrapper)                                                                                                                      |
| firefox  | `Extension Autoloading Error: An error occurred while trying to automatically install the required extension 'parquet': Extension https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm is not available` |
| webkit   | `call_indirect to a signature that does not match (evaluating 'u(..._)')`                                                                                                                                                      |

`src/lib/engine/engine.ts`'s `EngineUnavailableError` wraps every one of these identically as `data
engine unavailable: <raw message>` — the one user-visible shape a caller (a future click handler)
has to know about, regardless of engine or browser.

## The 25 MB materialize guard now refuses BEFORE downloading (fix round 1)

The original guard (`Engine#load`) fetched the whole body, THEN checked `byteLength` — a 374 MB
`cell.parquet` would download in full on a phone and only then be refused, exactly backwards.
`src/lib/engine/materialize.ts`'s `fetchWithSizeGuard()` now checks twice, in order: (1) a
`Content-Length` response header over the guard aborts the request (`AbortController`) and throws
WITHOUT ever calling `resp.body.getReader()`; (2) the body is otherwise read as a stream and capped —
aborted the moment the running total crosses the guard, never buffering more than the guard plus one
chunk — which also catches a LYING `Content-Length` (a small header, a larger real body), not just a
missing one. Both layers, and both of their seeded-fault removals, are covered in
`tests/engine/materialize.test.ts`.

**What the real bucket sends, verified in a real browser (not just `curl`).** A cross-origin
`fetch()` from a real Chromium page (Playwright, a `data:` origin — the strictest, opaque-origin
case) to `marine-atlas/v9/tables/taxon.parquet` came back `type: "cors"` (not `"opaque"`) with
`content-length: "1033168"` readable from JS. `curl -I` against the same URL (with an `Origin`
header) shows why: `Access-Control-Allow-Origin: *` and, explicitly,
`Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges, ETag` — S3 exposes
`Content-Length` on every object this app reads, so the pre-check above works against the real
bucket, not just same-origin test fixtures. (`Content-Length` is also a CORS-safelisted response
header by spec regardless, so this would likely work even without the explicit expose-headers line —
S3 sends it anyway.)

## What this note does NOT claim

- No real Safari, no real mobile browser — Playwright's WebKit build only (same caveat
  `docs/spikes/S1.md` already states for OPFS).
- The "foreign origin" is a local Node static server, not the real S3 bucket (read-only for this
  task) — the CORS mechanism measured here is the general one; whether the bucket's _specific_
  CORS policy already covers a `duckdb-ext/` prefix is unverified and would need a real (writable)
  test against it before relying on this in production.
- One machine, one session, `parquet` only (matches S3/S4's own scope; `spatial`/`json` untouched).
- The materialize-guard streaming path was measured against test doubles (a hand-rolled reader), not
  a real multi-hundred-MB fetch — the mechanism (abort on running total) is generic Streams API
  behaviour, but the exact chunk sizes a real S3 response delivers were not measured here.
