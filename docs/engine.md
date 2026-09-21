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
(gitignored — a real deploy must run the fetch script before `vite build`, the "documented build
step": CI/deploy tooling is not wired up here to avoid touching the shared `pages.yml` mid-parallel-
build; verified by hand that `npm run duckdb:fetch-ext && npx vite build` copies both files through
Vite's `publicDir` into `dist/duckdb-ext/v1.4.3/{wasm_eh,wasm_mvp}/parquet.duckdb_extension.wasm`
unchanged). `spatial`/`json` are deliberately not mirrored (`docs/spikes/S4.md` "Where DuckDB
extensions are hosted" — unchanged by this step).

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

## What this note does NOT claim

- No real Safari, no real mobile browser — Playwright's WebKit build only (same caveat
  `docs/spikes/S1.md` already states for OPFS).
- The "foreign origin" is a local Node static server, not the real S3 bucket (read-only for this
  task) — the CORS mechanism measured here is the general one; whether the bucket's _specific_
  CORS policy already covers a `duckdb-ext/` prefix is unverified and would need a real (writable)
  test against it before relying on this in production.
- One machine, one session, `parquet` only (matches S3/S4's own scope; `spatial`/`json` untouched).
