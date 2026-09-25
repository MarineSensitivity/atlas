# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repo: `atlas`, the MarineSensitivity
static app (scores, species, places and reports for U.S. marine areas). Svelte 5 (runes) + Vite +
TypeScript, no SvelteKit, no client router. See `../workflows/.claude/plans/2026-09-20 atlas
app plan.md` for the full plan and decisions (D1-D12); this file only covers what changes how you
work in _this_ repo day to day.

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
- Size budget: `npm run size-budget` (against a real `npm run build`); the red-fixture controls are
  `npm run build:fixture:size-budget` (see `tests/fixtures/size-budget-static-duckdb/`) and
  `npm run build:fixture:size-budget-worker` (see `tests/fixtures/size-budget-worker/`)
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
  `https://marinesensitivity.org/atlas/` _and_ `https://preview.marinesensitivity.org/{ver}/atlas/`
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
  Source of truth: `src/lib/release/version.ts` (unit-tested). Resolution is only step one: what
  finally renders is whatever the access gate below allows.
- **Preview mode has exactly one door.** A same-origin `session.json` is the _only_ way into
  preview mode (plan D6): it exists only on the preview host's Caddy. A 404 is public. A network
  error is public. Only a `200` with `{"preview": true}` in the body is preview — anything else
  (missing, malformed JSON, `preview` absent or falsy) must default to public. Never fail open.
  Source of truth: `src/lib/release/session.ts` (unit-tested). It is also the app's **only
  same-origin fetch**, and the public path must never _await_ it (see the gate, below).
- **Data origins are formed in exactly one place, and they are absolute.** `latest.txt`,
  `versions.json` and every release file live in the bucket, not on either host:
  `src/lib/release/dataBase.ts` holds the literal `PUBLIC_DATA_BASE`
  (`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/`, path-style, with the
  `marine-atlas/` prefix — the bare `…/{ver}/…` path answers 403) and is the one place a release
  URL is built (`dataBase(ver, session)`, `dataUrl()`, `registryUrl()`). Never `fetch(ver +
"/manifest.json")` or any other relative release URL: it resolves against the mount point, so
  under `/v9/atlas/` it becomes `/v9/atlas/v9/manifest.json` (404 on every host) and makes the data
  origin depend on where the app happens to be served. On a **preview** session only, a
  `session.data` prefix (a string, or a per-version map) overrides the base — plan D6's committed
  follow-up, an unguessable prefix revealed only to a signed-in reviewer. It is validated before
  use (https only, no credentials, no query/hash, normalized to a trailing `/`) and ignored
  otherwise; a public session's `data` is never honoured.
- **The public host renders public releases only** (plan D6, `src/lib/release/access.ts`).
  `versions.json` rows carry `access`; today v7b, v8 and v9 are `restricted`. A restricted release
  is fetched **only** when `session.json` says `preview: true` — otherwise not one request under
  that version is ever made. Everything fails **closed**: a row with no `access` key, an
  unrecognized `access` value, and a version with no row at all are all treated as not-renderable;
  an unreadable `versions.json` allows _only_ `latest.txt`'s version, and a preview session does
  not widen that. A denied version **falls through to `latest.txt`** (the same rule a malformed
  `?ver=` follows) with `{ver, reason}` recorded on `window.__early.denied` so the UI can say why;
  if the fall-through target is itself denied, nothing renders. `session.json` is awaited **only**
  when a candidate release is restricted (`requiresSession()`), so the public path never blocks on
  a same-origin round trip.
- **The inline early-fetch script is a second copy of four modules, and a test proves it.**
  `index.html`'s inline script duplicates `src/lib/release/{version,session,access,dataBase}.ts`
  because it must run before any bundle parses. `tests/release/access-cases.ts` is the single case
  table; `tests/release/access.test.ts` drives the modules through it and
  `tests/release/inline-early-fetch.test.ts` runs the **real** inline script (extracted from
  `index.html`) in a `node:vm` sandbox through the same table, plus literal-equality checks on
  `VERSION_RE` and `DATA_BASE`. Change one copy without the other and exactly one of those files
  goes red. Add the case to the shared table, never to only one side.
- **Numbers never come from the tile server.** Rasters are _displayed_ through the existing stock
  titiler (COG tiles) — that's fine, that's what it's for. But scores, cell ids, and zonal statistics
  always come from Parquet (DuckDB-WASM, materialize-then-query — no httpfs range reads in v1), never
  by reading rendered tile pixels. The one sanctioned exception is a species click value, which may
  use `/cog/point`, and only behind an interface so it can be swapped later (plan D4).
- **One MapLibre style, one `setStyle(diff:true)`.** When map code lands (atlas-2/3), the basemap +
  bathymetry + boundaries + data compose into one plain style object, applied with
  `map.setStyle(composed, { diff: true })`. Never `addLayer()` piecemeal after `load` — layers added
  that way can silently vanish across a later style swap (`atlas-refs/"calcofi explore review.md"`
  §5, lesson 3).
- **Analytics never leaks the URL fragment, and code alone cannot guarantee that.** Every hit
  `src/lib/analytics/` builds carries an explicit `page_location`/`page_title`, never the live page's
  own href/fragment or document title (`send_page_view: false` on the GA4 config call; see
  `analytics.ts`'s module header). But GA4's own **Enhanced Measurement → "Page changes based on
  browser history events"** setting, if left on, makes gtag.js independently re-read the live URL on
  every `history.replaceState` — bypassing all of that. See `docs/analytics.md` for why this must stay
  off for `G-9HW6L751XG`, how to verify it in the network panel, and the gates that do cover the
  code side (`tests/analytics/noRawLocation.wiring.test.ts`, and the Playwright spec
  `e2e/fixtures/analytics-privacy/privacy.spec.ts`, run by `npm run e2e:analytics-privacy`).
- **The spike pins: `@duckdb/duckdb-wasm` at exactly `1.32.0`, `maplibre-gl` at `^6.10.0`, and the
  three upload parsers at exactly `shpjs@6.2.0`, `@tmcw/togeojson@7.1.2`, `flatgeobuf@4.4.0`.**
  Decided by spikes S1, S2 and S4; the evidence is in `docs/spikes/S1.md`, `S2.md`, `S4.md` (each
  ends in a one-line `**Verdict:**`), and the short reason is in `package.json`'s `pinReasons` block
  (JSON has no comments, so that block _is_ lesson 10's inline comment). `tests/pins.test.ts` goes
  red if any range drifts from its verdict line — change both together, or re-run the spike and
  rewrite the verdict. **None of these packages is imported from `src/` yet** (the parsers land in
  atlas-6, and each must be a dynamic `import()`, never a static one). Whoever first imports one
  follows the wiring rules the pins depend on, because the pin is worth nothing without them:
  - **DuckDB (atlas-2):** self-host the `mvp` + `eh` bundles via `?url` and construct the worker
    yourself — `new Worker(bundle.mainWorker)`, same-origin — never `createWorker()`, never the
    `coi` bundle, and keep `@duckdb/duckdb-wasm` in `optimizeDeps.exclude`. Open `opfs://` only
    inside `navigator.locks.request(name, { ifAvailable: true }, cb)` (a plain `locks.request` is a
    measured hang), hold that lock for the handle's whole lifetime, `CHECKPOINT` before close, and
    fall back to an in-memory database on every failure — OPFS is never required. `read_parquet()`
    autoloads a 3 MB extension from `extensions.duckdb.org`: self-host it and
    `SET custom_extension_repository` to a same-origin mirror before the first query (keyed by the
    DuckDB _engine_ version — `1.32.0` → `v1.4.3` — not the npm version), because the blocked-CDN
    failure is a `RuntimeError: function signature mismatch` WASM crash, not a catchable error.
  - **MapLibre (atlas-2/3):** import it **named** (6.x has no default export; a default import is a
    hard build failure), and wire the worker as
    `import url from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"; setWorkerUrl(url);` —
    plain `?url` ships a worker whose 514 KB shared chunk 404s, and then rasters still paint while
    vector layers silently never parse. So every map test asserts a _rendered vector feature_
    (`isSourceLoaded()` **and** `queryRenderedFeatures().length > 0`), not just painted pixels. Pass
    `canvasContextAttributes: { preserveDrawingBuffer: true }` (the bare top-level key is silently
    ignored and `readPixels` then reads `(0,0,0,0)`) and call `map.resize()` right after
    construction (without it raster tile requests are non-deterministic headless). Do **not** add
    `maplibre-gl` to `optimizeDeps.exclude`.
  - **Uploads (atlas-6):** every parser is a dynamic `import()`, and every parser's output goes
    through one normalizer in `src/lib/geo/` that rejects projected coordinates (no parser but
    `shpjs` reprojects, and `shpjs` returns raw metres _silently_ when a zip has no `.prj`), rewinds
    rings to RFC 7946 (GDAL's shapefile writer disagrees with every other format's winding across
    ±180°) and computes a dateline-aware bbox (all four parsers report a 355°-wide box for a 5°-wide
    Aleutian polygon). A `.gpkg` goes through DuckDB `spatial`, which is **not** self-hosted: it
    costs a one-time ~22 MB fetch from `extensions.duckdb.org`, so it is prompted, lazy, and falls
    back to "convert to GeoJSON". See `docs/spikes/S4.md`.

## Budgets (`scripts/size-budget.mjs`)

- **450 KB gzip** for the static critical path: everything `index.html`'s own `<script>`s load before
  first interaction (app chunk + eventual maplibre-gl + pmtiles + CSS + fonts). Plan D13, relaxed
  2026-09-21 (owner: "we don't need to be so tight on the 350 KB budget") — the original 350 KB cap
  (atlas-0 Deliverable 4) left too little room once atlas-3 step 3's shell (Svelte runtime +
  Shell.svelte + the self-hosted Jost/Carlito brand fonts) was actually measured: spike S2's
  maplibre-gl 6.10 + pmtiles + CSS (**288,149 B gzip, 281.4 KiB**, measured on the pinned `^6.10.0`
  with the same `gzipSync(level 9)` this checker uses) plus the shell's own ~108 KB gzip already
  totals ~396 KB, leaving under 54 KB for atlas-4/5's lens code under the old cap. 450 KB leaves
  ~50 KB more than that; budget accordingly.
- **150 KB gzip, separately, for runtime workers** (`RUNTIME_WORKER_BUDGET_BYTES`, unchanged by D13):
  a worker referenced from the static graph (e.g. maplibre-gl's, wired via `?worker&url` per S2.md —
  143.9 KB gzip measured) downloads at construction time, before first interaction, but it is not part
  of the entry's own `<script>` payload, so it is not folded into the static number — it gets its own
  budget instead. The two together ("before first interaction") total 600 KB.
  The checker does NOT rely on the manifest's `assets`/`imports` fields to find it (that depends on
  chunk-splitting specifics this repo doesn't control): it reads the compiled text of every file on the
  static path for the `new URL("<file>.js", import.meta.url)` pattern a `?worker&url` import (or a
  hand-written `new Worker(new URL(...))`) compiles to, resolves it dist-relative, and confirms it by
  actually reading the file — a worker referencing a worker of its own is followed transitively. The
  script prints both budget lines plus their sum ("before first interaction") and fails on either.
- Anything meant to be lazy — `duckdb*`, `terra-draw*`, `docx*`, `shp*`, the treemap — must never
  appear in the entry's _static_ import graph, and must never appear inside a runtime worker either
  (it must be a dynamic `import()`). The checker reads `dist/.vite/manifest.json`, walks only `imports`
  (never `dynamicImports`), and greps the reachable files' (and any runtime workers') text for those
  markers — so an accidentally-inlined forbidden module is still caught, not just a chunk whose file
  name happens to say "duckdb".
- A manifest with no entry for `index.html`, or an entry with no `"file"` (a build that silently failed
  to emit it), is a hard `FAIL`, never a vacuous pass over zero files.
- `npm run build:fixture:size-budget` builds `tests/fixtures/size-budget-static-duckdb/` (a stub
  module named/worded like the real dependency, statically imported on purpose) and
  `npm run build:fixture:size-budget-worker` builds `tests/fixtures/size-budget-worker/` (a stub
  worker padded past the runtime-worker budget with deterministic, gzip-incompressible bytes) —
  running the checker against either must fail, and CI (`pages.yml`) asserts that on every run, not
  just in a unit test: the committed proof that this check can actually fail. Every gate in this repo
  ships with a seeded fault like this one; a check that cannot fail is not a check.

## Testing pyramid

1. **Unit (vitest, `tests/**`).** Pure logic with no DOM and no network: version/session
   resolution, the size-budget graph walk, the dist-invariant checkers, and — as later phases land —
   the coverage math, the places codec, the SQL-vs-msens parity math. Fast, deterministic, one
   fixture per rule/branch (not one broad end-to-end assertion that hides which rule broke). A bug
   fix gets a permanent regression test in the same change, named after the bug.
2. **Build-time invariants (`node scripts/*.mjs`, wired into CI).** Things only a real `vite build`
   output can prove: the size budget, no `session.json` in `dist/`, no absolute `/assets/` URL.
3. **Smoke e2e (Playwright, `e2e/**`, chromium + webkit + firefox).** Does the shell actually paint,
   with zero console errors, in a real browser — and does the release-access gate hold in a real
   browser (public host + `?ver=v9` makes zero requests under `/v9/`; `/v9/atlas/` renders v9 only
   with a `preview` session). **Hermetic**: every bucket URL is `page.route`d to a fixture, so no
   spec ever touches the live network; the preview server runs on port 4331. `scripts/verify.mjs` is the (currently skeletal)
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
- Comments lowercase except proper nouns; explain the _why_ (a decision, a gotcha, a plan reference)
  more than the _what_. Cite the plan decision (`D2`, `D6`, ...) or the phase (`atlas-1`) a piece of
  code exists to satisfy — the next reader (human or agent) should not have to re-derive it.
- Keep core logic in an exported function under `src/lib/`, callable from a test; a component or a
  script _calls_ it.

## Round-2 lessons (2026-09-24/25) — what the gates missed and what now catches it

Round 2 shipped 0.10.21 → 0.10.67 in two days with green gates throughout, and three of the
five Opus eyes-on reviews still said HOLD on real defects. The pattern each time: a gate that was
**code-shaped** (element exists, expression compiles, test green against its own fixture) while the
screen was wrong. These rules are now part of every merge:

- **Eyes-on before push, every merge.** `scripts/eyes-shots.mjs` shoots the real build (40 states:
  phone 390×844@2x + desktop 1280×800, fresh browser context per state, projected taps on known
  scored cells with a `WARN`/`-MISSED` mark when none hits, the Program-Area states, the report map
  scrolled into frame). The orchestrator looks at them and an Opus 5.5 review judges them against
  `scratchpad/briefs/eyes-review.md` before the push. Three false results were fixed in the harness
  itself (a petal selector that never hit `path.petal`, table shots before "Loading species…"
  cleared, two states that were byte-identical); a harness that cannot fail is not a check.
- **Hermetic fixtures hide timing.** The report's one-shot map style built the instant `model`
  turned non-null, before any place had its score — every place painted the no-data colour on the
  live site while the caption (reactive) was right. `blockWasm()` made the engine reject _faster_
  than the map's imports resolved, so every test ran the race the safe way. Rule: a one-shot build
  that reads a progressively-loaded value must gate on that value's completion, and its e2e must
  reproduce the live timing (`slowRealWasm()` — `route.continue()` after a delay, never an abort,
  which hangs `bootEngine()` forever).
- **A probe must never read 403/404 as DOWN.** The health banner's data-origin probe hit a URL the
  fixtures did not mock and classed the resulting 404 as an outage; because the banner was a fixed
  overlay it covered the top bar and 97 three-engine tests timed out on every browser. The banner
  now lives in flow below the top bar (never over interactive chrome) and only 5xx / network error /
  timeout count as down. Any change under `src/shell/` or `src/lib/ui/` runs `npm run e2e:shell`
  locally before the merge (R3-D3: `playwright test --project=chromium --workers=1
e2e/shell.*.spec.ts e2e/feedback.spec.ts`, ~3 min — the alias exists so this local gate is one
  command instead of one a round has to remember to hand-type, which is how V3's fixed-overlay
  banner reached CI with 97 reds in the first place: no local gate ran `e2e/shell.*` unless a
  round happened to touch those paths).
- **Every camera fit takes the chrome padding.** The species fit, the Scores zone fit (search pick,
  Places zoom, click) and the phone default all go through `chromePadding.ts`: the sheet's live
  detent + chip band on the phone, the docked panel's footprint + its 12 px outer inset + a 20 px
  gutter on desktop, the legend card's height only (never a full side column), 20 px side gutters
  on the phone. Fits use MapLibre's own `cameraForBounds()` (projection-aware; the phone draws the
  globe at these zooms) — hand-rolled Mercator math regressed the phone species view in 0.10.56.
  A wide model (the v7 leatherback spans the Pacific) cannot be framed at 390 px; that is a product
  decision (round-3 plan A1), not a bug.
- **Pixel gates must first prove the layer painted.** Under CI's software GL a single `readPixel`
  assertion passed with the layer-stack fault applied because the raster never painted and the
  probe read the basemap colour either way. Gate on the whole spec, or assert the un-promoted
  colour at a control point first.
- **Seeded-fault registry hygiene.** `test-faults.mjs --only <id>` takes ONE id per run. After
  every merge, `git apply --check` every `tests/faults/*.patch` — or just run `npm run
  faults:check` (R3-D2, `scripts/check-faults-apply.mjs`), which does exactly that against
  `test-faults.mjs`'s own `FAULTS` manifest (the one place a patch path is written — `FAULTS` is
  now `export`ed so this script can read it without running a single gate) and exits 1 listing
  every patch that no longer applies. It is a much cheaper first line of defense than discovering a
  stale patch mid-`npm run test:faults` (a full gate run, sometimes a real browser build, per
  entry) — six patches went stale in ONE round alone (2026-09-25). Regenerate a stale one on an
  otherwise clean tree with `git apply --reject` + a hand edit, cut it with
  `git diff HEAD -- <that one file>`, and prove it red with `--only` **before** writing the commit
  message (a patch once shipped that did not even apply, with a message claiming red). When a fix
  adds a second sentence/branch to what a fault reverts (W4's one-place caption), the patch must
  revert both or the gate stays green. Stage explicit paths; `git add -A -- . ':!.tmp'` exits 1 on
  the ignored path and silently breaks a `&&` chain.
- **Copy changes break specs nobody ran.** Rewording the struck-pill tooltip redded
  `species.smoke.spec.ts`, which no round had touched. Grep `e2e/` and `tests/` for the old wording
  in the same change.
- **Gallery baselines are two sets.** Darwin regenerates locally (`npm run e2e:gallery --
--update-snapshots`, then LOOK at the PNG); linux comes only from CI (`gh run download <run> -n
gallery-test-results`, copy each final-attempt `*-actual.png` over `*-chromium-linux.png`) — or run
`npm run gallery:baselines-from-ci -- <run-id>` (R3-D1, `scripts/gallery-baselines-from-ci.mjs`),
which does exactly that (downloads the artifact, keeps each screenshot's final CI attempt, copies
it over the matching `e2e/gallery.spec.ts-snapshots/*.png`, prints what it replaced/added) so
installing the linux set is one command instead of a manual unzip-and-copy. Still needs a human to
`git diff --stat` the result before committing — the script never commits for you.
  Every gallery-rendered component change costs a second push.
- **One screenshot PER SECTION, never a full-page shot (R3-D1).** `e2e/gallery.spec.ts` used to
  take one `toHaveScreenshot({ fullPage: true })` per theme x viewport; the desktop shot's total
  page height (~10,200px, every section stacked) jittered by 1px between CI runs (a section's
  subpixel rounding or font metric under CI's fonts), and `toHaveScreenshot` refuses ANY size
  mismatch before it ever compares pixels — so the job failed every time regardless of
  `maxDiffPixelRatio` (CI run 36114961882, 2026-09-25). The spec now screenshots each
  `.gallery-section` element on its own (`gallery-{theme}-{viewport}-{sectionId}.png`, one file per
  `src/gallery/sections/*.svelte` module) — a much smaller, stable height per file, so the SAME
  1px-of-total-page jitter (if it recurs) lands inside `maxDiffPixelRatio`'s tolerance for that one
  section instead of failing a whole-page size check outright. A new gallery section (just a new
  file under `src/gallery/sections/`, per `App.svelte`'s own header) gets its own baseline
  automatically — nothing to edit in the spec.
- **Parallel rounds reserve versions and never share files.** The orchestrator resolves the
  registries (CHANGELOG order = version order, package + both lock fields = the higher version,
  `test-faults.mjs` rebuilt from main's file + the branch's new entries, GATES count). A merge that
  conflicts inside a `&&` chain dies silently — never chain a merge with anything.
- **Labels resolve everywhere or nowhere.** A Program Area's display name comes from
  `paLabel(key, publishedName, unit)` (bundle name, else the generated `programAreaNames.ts`
  table, else the key) — search ranking, map tooltip, flower title, table header, report, GeoJSON
  export all go through it. A fix that "reads `name` from the bundle" was code-shaped for weeks
  because no published bundle carried names.
- **The feedback endpoint commits to `main`.** `scripts/feedback/Code.gs` files a public issue and
  commits `feedback/<id>.png`; `pages.yml` ignores `feedback/**` on push so a report never re-runs
  CI or cancels the in-flight slow jobs. GA4's Enhanced Measurement history setting and the two
  Apps Scripts (`feedback` vs the usage-log Sheet behind `VITE_LOG_URL`, which is the Shiny apps'
  `MSENS_LOG_URL`) are documented in `docs/feedback.md` and `docs/analytics.md`.
