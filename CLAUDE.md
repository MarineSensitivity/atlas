# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repo: `atlas`, the MarineSensitivity
static app (scores, species, places and reports for U.S. marine areas). Svelte 5 (runes) + Vite +
TypeScript, no SvelteKit, no client router. See `../workflows/.claude/plans_todo/2026-09-20 atlas
app plan.md` for the full plan and decisions (D1-D12); this file only covers what changes how you
work in *this* repo day to day.

## Commands

- Install: `npm ci` (or `npm install` while adding a dependency)
- Dev server: `npm run dev`
- Type-check (svelte-aware): `npm run check` — plain `npm run typecheck` (`tsc --noEmit`) does NOT
  see inside a `.svelte` `<script>` block; use `check` when editing a `.svelte` file
- Unit tests: `npm test` (`vitest run`); watch mode: `npm run test:watch`
- Build: `npm run build` → `dist/`
- Preview the build: `npm run preview`
- Lint / format: `npm run lint`, `npm run format` (`format:check` in CI-style, no writes)
- e2e smoke (chromium/webkit/firefox): `npm run e2e` (needs `npx playwright install` once)
- Size budget: `npm run size-budget` (against a real `npm run build`); the red-fixture control is
  `npm run build:fixture:size-budget` (see `tests/fixtures/size-budget-static-duckdb/`)
- `node scripts/check-dist-session.mjs [dist]`, `node scripts/check-relative-assets.mjs [dist]` —
  the two other build-time invariants (see Rules, below)

## Repo layout

`index.html` (map), `report.html` (print-first report), `gallery.html` (not wired in yet) at the
root; `src/lib/{release,state,grid,geo,engine,raster,map,report,ui,brand,analytics}`;
`src/lens/{scores,species}`; `src/places`; `sql/`; `tests/` (unit + `tests/fixtures/`); `e2e/`
(Playwright); `scripts/{verify,smoke_release,size-budget*,check-*,parity/}`; `docs/{design,spikes}`;
`spikes/`. Most of these are still empty placeholders — they fill in phase by phase (see the plan's
phase table); don't be surprised to find a directory with only a `.gitkeep` note in it.

## Rules that don't change per phase

- **Relative base.** `vite.config.ts` sets `base: "./"`. The exact same `dist/` must run under
  `https://marinesensitivity.org/atlas/` *and* `https://preview.marinesensitivity.org/{ver}/atlas/`
  (Cloudflare Access scopes its reviewer policy by path). Never write or generate an absolute
  `/assets/...` URL, an absolute `href`/`src` outside `public/`-style root files, or anything that
  assumes the app is mounted at `/`. `scripts/check-relative-assets.mjs` enforces this on every
  build.
- **URL-is-the-view.** There is no client router. Every piece of view state — release version,
  lens, selected place, draw geometry — lives in the query string or the `#hash`, decoded on load
  and written back with `history.replaceState` (never `pushState` for ordinary interaction: a link
  must reproduce its exact view). Places use a versioned binary codec in the hash (`g1`, plan D8),
  not a JSON blob. If you're about to add component state that a shared link should reproduce, it
  belongs in the URL, not in a store that only lives in memory.
- **Version resolution order: path beats query beats `latest.txt`.** A version segment in the path
  (`/v9/atlas/...`, the preview host's shape) always wins; `?ver=` is next; `latest.txt` is the
  fallback. A malformed value is treated as absent, never as an error — it just falls through to
  the next tier. The label shape is exactly `^v[0-9]+[a-z]?$`, matching `msens::atlas_resolve_ver()`.
  Source of truth: `src/lib/release/version.ts` (unit-tested). The inline early-fetch script in
  `index.html` is a hand-kept plain-JS copy of the same logic — it has to run before any bundle
  parses, so it cannot `import` the module — keep the two in sync by hand when either changes.
- **Preview mode has exactly one door.** A same-origin `session.json` is the *only* way into
  preview mode (plan D6): it exists only on the preview host's Caddy. A 404 is public. A network
  error is public. Only a `200` with `{"preview": true}` in the body is preview — anything else
  (missing, malformed JSON, `preview` absent or falsy) must default to public. Never fail open.
  Source of truth: `src/lib/release/session.ts` (unit-tested).
- **Numbers never come from the tile server.** Rasters are *displayed* through the existing stock
  titiler (COG tiles) — that's fine, that's what it's for. But scores, cell ids, and zonal statistics
  always come from Parquet (DuckDB-WASM, materialize-then-query — no httpfs range reads in v1), never
  by reading rendered tile pixels. The one sanctioned exception is a species click value, which may
  use `/cog/point`, and only behind an interface so it can be swapped later (plan D4).
- **One MapLibre style, one `setStyle(diff:true)`.** When map code lands (atlas-2/3), the basemap +
  bathymetry + boundaries + data compose into one plain style object, applied with
  `map.setStyle(composed, { diff: true })`. Never `addLayer()` piecemeal after `load` — layers added
  that way can silently vanish across a later style swap (`atlas-refs/"calcofi explore review.md"`
  §5, lesson 3).
- **`@duckdb/duckdb-wasm` and a `maplibre-gl` version are not decided yet.** They're pinned by
  spikes S1 and S2 (`docs/spikes/`, not written yet) with a reason in an inline `package.json`
  comment. Don't add either dependency, and don't guess a version, ahead of that.

## Budgets (`scripts/size-budget.mjs`)

- **350 KB gzip** for the critical path: everything `index.html` loads before first interaction
  (app chunk + eventual maplibre-gl + pmtiles + CSS + fonts).
- Anything meant to be lazy — `duckdb*`, `terra-draw*`, `docx*`, `shp*`, the treemap — must never
  appear in the entry's *static* import graph (it must be a dynamic `import()`). The checker reads
  `dist/.vite/manifest.json`, walks only `imports` (never `dynamicImports`), and greps the reachable
  files' text for those markers — so an accidentally-inlined forbidden module is still caught, not
  just a chunk whose file name happens to say "duckdb".
- `npm run build:fixture:size-budget` builds `tests/fixtures/size-budget-static-duckdb/` (a stub
  module named/worded like the real dependency, statically imported on purpose) and running the
  checker against it must fail — the committed proof that this check can actually fail. Every gate
  in this repo ships with a seeded fault like this one; a check that cannot fail is not a check.

## Testing pyramid

1. **Unit (vitest, `tests/**`).** Pure logic with no DOM and no network: version/session
   resolution, the size-budget graph walk, the dist-invariant checkers, and — as later phases land —
   the coverage math, the places codec, the SQL-vs-msens parity math. Fast, deterministic, one
   fixture per rule/branch (not one broad end-to-end assertion that hides which rule broke). A bug
   fix gets a permanent regression test in the same change, named after the bug.
2. **Build-time invariants (`node scripts/*.mjs`, wired into CI).** Things only a real `vite build`
   output can prove: the size budget, no `session.json` in `dist/`, no absolute `/assets/` URL.
3. **Smoke e2e (Playwright, `e2e/**`, chromium + webkit + firefox).** Does the shell actually paint,
   with zero console errors, in a real browser. `scripts/verify.mjs` is the (currently skeletal)
   state-matrix runner: every view state × {desktop 1280×800, phone 390×844}, asserting
   `assertLayout()` (no horizontal overflow, every `[data-control]` fully on screen).
4. **Parity (later, `scripts/parity/`).** Cross-checked against `msens` at `max|Δ| ≥ 1e-9` — a gate
   that stops the line, not a warning.

Keep scoring/coverage/codec logic itself in a plain, exported TS function under `src/lib/`, not
inline in a component or a script — the test asserts the function; the component just calls it.

## Changelog

Every user-visible change gets a `CHANGELOG.md` line under an `## Unreleased` (or versioned) heading
in the same commit that makes the change — same discipline as `NEWS.md` in `msens`. Bump
`package.json`'s `version` and add the entry together; don't let them drift.

## Code style

- 2-space indent, double quotes (prettier default; `eslint.config.js` + `.prettierrc.json`), no
  semicolon debates — just run `npm run format`.
- camelCase for variables/functions (this is TypeScript, not R — `snake_case` is the R convention in
  the org's other repos, not this one); `UI_CAPS` for true constants.
- Comments lowercase except proper nouns; explain the *why* (a decision, a gotcha, a plan reference)
  more than the *what*. Cite the plan decision (`D2`, `D6`, ...) or the phase (`atlas-1`) a piece of
  code exists to satisfy — the next reader (human or agent) should not have to re-derive it.
- Keep core logic in an exported function under `src/lib/`, callable from a test; a component or a
  script *calls* it.
