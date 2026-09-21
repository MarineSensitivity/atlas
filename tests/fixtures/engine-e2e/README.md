# engine e2e fixture

A standalone Vite app (own `vite.config.ts`, own `playwright.config.ts`, port 4391 — separate from
the root `e2e/` spec's 4331) that boots the REAL `src/lib/engine/{engine,bundles,sql,smoke}.ts`
against a real browser: a real self-hosted `Worker` + DuckDB-WASM module, which
`tests/engine/*.test.ts` (Vitest, `node` environment, dependency-injected) cannot exercise — there
is no real `Worker`/WASM under plain Node.

`main.ts` exposes `window.__engineTest` (`boot`, `countTaxon`, `smokeProbe`, `exec`, `marks`) for
`e2e/*.spec.ts` to drive. `publicDir` points at the repo's own `public/`, so this fixture serves the
same DuckDB extension mirror the real app would — run `npm run duckdb:fetch-ext` once before
`npm run e2e:engine` (a missing mirror makes every spec here fail the same way
`extension-unset.spec.ts` deliberately provokes).

Specs:

- `extension-mirror.spec.ts` — the required gate: boots the engine (both the `eh` and a
  forced-`mvp` bundle), reads `marine-atlas/v9/tables/taxon.parquet` with
  `**/extensions.duckdb.org/**` blocked, asserts 37,067 rows and zero hits on the blocked host.
- `extension-unset.spec.ts` — seeded fault: no mirror + CDN blocked must fail clearly (`data engine
unavailable: ...`), never hang.
- `single-chain.spec.ts` — seeded fault: a slow `exec()` issued first still finishes before a fast
  one issued right after it, against a real connection (not just the dependency-injected proof in
  `tests/engine/engine.test.ts`).
- `injection.spec.ts` — seeded fault: an injection-shaped probe value round-trips as inert data
  through a real query, and the table survives.
- `cross-origin.spec.ts` — measures whether `custom_extension_repository` works pointed at a
  cross-origin host (a local stand-in for the bucket), with and without CORS headers.

Run: `npm run e2e:engine` (all three engines) or `npx playwright test
--config=tests/fixtures/engine-e2e/playwright.config.ts --project=chromium` for one.
