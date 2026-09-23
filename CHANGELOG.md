# atlas 0.10.9

`atlas-8` fix round 1 (of 2): merged with `main` (atlas-7's report, 0.10.5-0.10.8); the widened
specs were RED on webkit/firefox as reported, root-caused and fixed for real (not loosened).

- **Root cause, both originally-reported failures (and two more found the same way): a raster
  applied by a lens' own reactive effect, or manually injected by a test, can land while
  `map.isStyleLoaded()` is still false** and get QUEUED (`src/lib/map/styleQueue.ts`), flushing
  only on the map's next `"idle"` or its 4000ms fallback — `map.loaded()` says nothing about
  whether that queue has flushed. Chromium usually won the race by luck of timing; WebKit/Firefox
  reproducibly lost it.
  - `e2e/map.spec.ts` "paints a raster": `ScoresLens.svelte`'s own lazy-mount effect
    (`mapExtra = scoresMapInputs(...)`) was clobbering the test's manually-injected raster.
    Fixed self-healingly: the raster is re-injected on every poll iteration, so whichever
    injection is temporally last always wins, regardless of which engine's module-loading timing
    is slower.
  - `e2e/species.smoke.spec.ts` "switching species twice": the OLD assertion checked
    `isSourceLoaded` once, then read the source URL once with no further wait — so it could
    read a STALE (first-selected) URL while the SECOND selection's style was still sitting in the
    queue. Fixed by polling the URL itself until it matches, covering the 4000ms fallback.
  - `e2e/species.smoke.spec.ts` "a range draws >= 1 rendered feature": same shape as the
    `map.spec.ts` fix (manual injection vs. the species lens' own mount effect) — same
    self-healing fix.
  - `e2e/scores.firstpaint.spec.ts` "paints the score raster" (v7 AND v9, on any engine): same
    queue-flush race, no manual injection this time (`ScoresLens`'s OWN effect can queue). Fixed
    by waiting for the real layer (`r_lyr`) to exist before polling pixels; the previous narrow
    `browserName==="firefox" && ver==="v9"` skip is removed — no longer needed.
- **`e2e/species.timing.spec.ts`**: a real, one-time browser-process warm-up cost (measured: the
  FIRST page a freshly-launched browser ever navigates took 20.9s here vs ~1.1s for the 2nd-5th,
  same browser, fresh contexts) can exceed this test's per-run polling ceilings. Widened them
  (10s→30s per poll, plus `test.setTimeout(120_000)`) so this one-time cost is not the artificial
  bottleneck; the actual gate (`BUDGET_MS` on the median of 3) is unchanged.
- **`scripts/verify.mjs` is now self-sufficient**: if nothing answers `VERIFY_BASE_URL` yet, it
  builds `dist/` and starts its own `vite preview`, waits for it, runs the matrix, and shuts down
  ONLY the server it started (a server it finds already running is reused, never killed).
  `--no-server` fails fast instead, for a caller that wants to manage the server itself.
- Gates: `tsc` 0 · `svelte-check` 0/0 · `vitest` 169 files / 2548 tests, 3 skipped · `eslint` 0 ·
  `prettier` clean · `npx playwright test --project={chromium,webkit,firefox} --workers=1` (run
  one engine at a time per the shared-machine load rule): 91/91, 81/81 (10 chromium-only skips),
  82/82 (9 skips) — 0 failed, 0 did not run, on all three. `node scripts/verify.mjs` (chromium,
  self-started server): 6/6 on a `--limit=2` smoke check.

# atlas 0.10.8

- `e2e/report.spec.ts`'s `page.pdf()` block is skipped on webkit and firefox (`page.pdf()` exists only
  in headless Chromium); it had failed there, not skipped, on the first full three-engine run.

# atlas 0.10.7

`atlas-7` fix round 1 (Opus review): no second copy of the map; the checklist's real gates against
real Parquet fixtures; five seeded faults as tests, not arguments.

- **No second copy of the map.** `reportMap.ts` no longer restates the basemap tile URL or a
  zone's `label_pt` lookup, and `mapWiring.ts` is deleted: `Report.svelte` now imports `createMap`
  (`lib/map/map.ts`) and `composeStyle`/`basemapForTheme`/`zoneLabelsFromBoot` (`lib/map/style.ts`,
  `layers/{basemap,zones}.ts`) directly, same as the app. Accepted the ~6 KB gzip this puts back on
  `index.html` (see the size line below).
  `tests/report/noSecondMapCopy.wiring.test.ts` (seeded fault: a restated basemap host, a
  hand-built `new MapLibreMap(...)`, or a hardcoded glyphs URL under `src/report/` is caught) is
  the mechanical guard against it recurring.
- **Real Parquet fixtures, real gates.** `e2e/fixtures/report/*.parquet` (`generate.sql`, the
  duckdb CLI, same "generate once, commit the binary" convention as `e2e/fixtures/places/`): a
  synthetic 48x48 grid with FOUR `cell`/`cell_model` partition tiles, real `taxon`/`zone_taxon`
  rows. `e2e/report.spec.ts` gained: (a) 20 zone places rendering complete in < 10 s; (b) a 4-tile
  custom (drawn) place's scores AND species rendering complete, cold, in < 15 s, combining all
  four `cell_model` batches; (c) `page.pdf()` + `pdf-parse`: place/table labels present, the
  PREVIEW watermark present for v9/preview and absent for v7 (the rotated watermark text comes
  back letter-per-line from pdfjs — matched whitespace-stripped); (d) the downloaded HTML opens
  with every http(s) request routed to a hard abort and still shows map/flowers/tables; (e) the
  permalink reproduces byte-identical `scores.csv`/`species.csv` (compared via `fflate#unzipSync`)
  across a **fresh browser context**. Needed `npm run duckdb:fetch-ext` locally (CI already runs
  this before `vite build`) — DuckDB-WASM's `read_parquet()` autoloads the `parquet` extension and
  the self-hosted mirror under `public/duckdb-ext/` is gitignored, dev-only.
- **Five seeded faults, as tests**: `tests/report/noHtmlDirective.wiring.test.ts` (`{@html name}`
  in any `src/report/**/*.svelte`); `tests/report/windowOpenSync.wiring.test.ts` (an `await` before
  `window.open()` in either entry point's handler); `tests/report/rampDomainFromPlaces.wiring.test.ts`
  (a release-wide rescale reference feeding the map's color domain instead of `model.map.domain`);
  `tests/report/printBreakInside.test.ts` (`break-inside: avoid` missing from `table tr` under
  `@media print`); the watermark-absent-for-restricted and table-row-break faults are additionally
  exercised live by `e2e/report.spec.ts`'s `page.pdf()` block above.
- Gates: `tsc` 0 · `svelte-check` 0/0 · `vitest` 163 files / 2501 tests, all green · `eslint` 0 ·
  `prettier` clean · `vite build` succeeds · `size-budget --entry index.html` 415.2 KB gzip static
  - 140.5 KB worker = 555.7 KB combined (budget 600 KB; up from 0.10.6's 414.8 KB now that the map
    wiring is shared code again, not a restatement) · `size-budget --entry report.html --allow-marker
duckdb` 52.6 KB gzip static, 0 worker (unchanged) · `e2e/report.spec.ts` 15/15 green (chromium) ·
    `e2e/shell.smoke.spec.ts` 4/4 still green.

# atlas 0.10.6

`atlas-7` step 4: the two entry points into the report.

- **Places panel "Report"** (`src/places/Places.svelte`) — a footer button beside Share/Download
  that opens `report.html?ver={ver}#pl={sel.pl}` for every place currently in the panel.
  `window.open()` runs SYNCHRONOUSLY inside the click handler (no `await` before it) so no browser
  treats the tab as unrequested — the exact popup-blocker workaround the legacy Shiny app's
  placeholder-tab trick (`apps/scores/app.R:1311-1326`) no longer needs. `ver` is the release this
  panel is actually viewing (`window.__early.version`, already read here); `pl` is reused verbatim
  from `sel.pl`, never re-encoded.
- **Zones table "Report on selected"** (`src/lens/scores/ZonesTable.svelte` + `TablePanel.svelte`)
  — a checkbox column (only rendered when a caller passes `onReportSelected`) plus a toolbar button
  that opens a report for one multi-key zone Place carrying every checked key, in the table's own
  rank order. `TablePanel.svelte` builds the `z.<set>.<keys>` token with `places/model.ts`'s own
  `zoneSetForUnit()`/`hashFromPlaces()` — the identical encoding a Places-panel zone place uses —
  and opens it the same synchronous way.
- Neither entry point imports anything from `src/lib/report/` or `src/report/`: both just build a
  URL string and call `window.open()`, so index.html's own static graph is untouched by this step
  (confirmed: `size-budget --entry index.html` is unchanged from 0.10.5's number).
- Analytics: `report_open{n_places, kinds}` fires once, from inside `report.html` itself
  (`Report.svelte`, after `expandPlaces()` resolves) rather than from either opener, so a single
  click is a single event regardless of which entry point was used; `report_export{format}` fires
  per export button. Both event names were already reserved in `lib/analytics/events.ts` (atlas-2);
  `sanitize.ts` already strips `pl`/`t` from every event unconditionally, so neither a place name
  nor a vertex nor the hash can reach either one.
- Gates: `tsc` 0 * `svelte-check` 0/0 * `vitest` 158 files/2485 tests, all green * `eslint` 0
  (added `svelte/reactivity`'s `SvelteSet` for the checkbox selection, per `svelte/prefer-svelte-
reactivity`) * `prettier` clean * `size-budget --entry index.html` unchanged at 414.7 KB gzip
  static / 555.3 KB combined * `e2e/shell.smoke.spec.ts` and `e2e/report.spec.ts` still green.

# atlas 0.10.5

`atlas-7` steps 2-3: the report document itself, its progressive rendering, the print stylesheet
and the three client-side exporters. Landed together because the document and its export buttons
are one file (`Report.svelte`); step 4 (entry points) follows in 0.10.6.

- **`report.html` + `src/report/Report.svelte`** — the document, mounted by `src/report-main.ts`.
  Header band (MST mark, the agency lockup behind `VITE_SEAL=1` via `lib/ui/sealVisibility.ts`,
  release chip, generated stamp, the permalink and its QR — a PNG `<img>`, never `{@html}` — wave
  footer); intro; Parameters (collapsed, a `hidden`-attribute disclosure so print CSS can force it
  open); the map (places filled by mean score, `spectral_r`, opacity 0.6, point-on-surface labels
  with a white halo, `Legend.svelte`, positron basemap + attribution); one flower per place (tabs
  on screen, all panels always in the DOM so print shows them sequentially); the Table of Scores
  with coverage footnotes; the Summary of Species per place (counts cross-tab, top 20 linking to
  the Species lens, "Download full species list" as a client Blob, the empty-case string); Sources
  and Method (citations via `lib/release/cite.ts`); Provenance (collapsed SQL, "Reproduce in R").
  Progressive rendering: `placeInputs` starts every place's `scores`/`species` at `null` and
  `buildReport()` (already-merged, untouched) re-runs after each place lands, with ONE visible
  `.progress-line` plus `announce()` calls.
- **`report.html`'s access gate** — the SAME inline early-fetch script as `index.html`,
  byte-for-byte (this file's own header explains why it must be a second copy, not an import).
  `tests/release/inline-early-fetch.test.ts` now asserts the two are identical and runs the shared
  `ACCESS_CASES` table against report.html's own copy too.
- **`src/report/data.ts`** — dispatches each place to the SAME engine paths the app already uses:
  a zone place's scores come straight from `boot.zones` (`model.ts#zoneScoreInput`, no engine at
  all) and its species from `speciesForZone()`; a custom place goes through
  `places/{dataEngine,results}.ts`'s D7b-clipped blend — no second query path.
- **`src/report/reportMap.ts` + `mapWiring.ts`** — a standalone MapLibre map for the print/export
  figure, deliberately NOT importing `lib/map/{map,style,layers/*}.ts`: those are reachable
  STATICALLY from `index.html` already, and report.html importing them too shared a Rollup chunk
  with index.html's own entry, measured to grow its committed static budget by 6.3 KB gzip for
  code only report.html needed. `mapWiring.ts` restates the small, load-bearing slice of
  `map.ts#createMap` (named maplibre-gl imports, the `?worker&url` wiring, `preserveDrawingBuffer`)
  and `reportMap.ts` restates `layers/{basemap,zones}.ts`'s two facts (the positron tile URL, a
  zone's `label_pt`) instead. `captureMapPng()` waits for `idle`, forces a repaint, waits two
  animation frames, then rejects an all-black/all-white capture.
- **`src/report/{exportFiles,exportHtml,exportZip,exportDocx,flowerSvg,svgToPng,qr}.ts`** — Print
  (`window.print()`); Download HTML (a detached DOM clone with the live map swapped for its
  captured PNG, `collectPageCss()` inlining every stylesheet, self-contained because this document
  loads no custom web font to begin with); the data-package ZIP (lazy `fflate` over
  `buildDataPackageFiles()`'s pure file list — `scores_<place>.csv`, `species_<place>.csv` via the
  app's own `lens/scores/species.ts#toCsv`, `places.geojson`, `query/*.sql`, `provenance.json`,
  `CITATION.md`, `README.md`); Word (lazy `docx`, coded styles per D9 — no reference template
  exists to match). `report.css` imports only `lib/brand/tokens.css`, never `fonts.css`, and sets
  `data-theme="paper"` explicitly (tokens.css's un-themed default is `navy` — the very first e2e
  run caught this as a real color-contrast failure). `@page { size: Letter; margin: .75in }`, a
  `position: fixed` running footer/watermark (Chromium repeats fixed elements per page; CSS Paged
  Media margin boxes are the spec-correct primary but unsupported there), `break-inside: avoid` on
  figures/table rows/flowers, `table thead { display: table-header-group }` so a spanning table's
  header repeats.
- **`src/report/colors.ts`** — the report's own twin of `lib/map/colors.ts`: every color literal a
  standalone SVG/canvas/MapLibre-style needs outside any stylesheet, in one file.
  `tests/raster/ramps.wiring.test.ts` now exempts it the same way it exempts the map's.
- **`scripts/size-budget.mjs` `--allow-marker`** — report.html's provenance section narrates
  "DuckDB-WASM 1.32.0" as prose and its Word button used to say "Word (.docx)"; both are
  `FORBIDDEN_LAZY_MARKERS` substrings that a build-output text scan cannot tell apart from an
  actually-bundled dependency. `--allow-marker duckdb` drops that marker for report.html's own
  invocation; `tests/report-lazy-import-duckdb.wiring.test.ts` (a source-level, entry-relative
  scan, the same technique as `tests/treemap-lazy-import.wiring.test.ts`) is what still proves
  `@duckdb/duckdb-wasm` and `docx` are never statically bundled by either entry.
- **Gates measured on this branch**: `tsc` 0 errors; `svelte-check` 0/0; `vitest` 158 files / 2485
  tests / 3 skipped, all green; `eslint` 0; `prettier --check` clean; `vite build` (both entries in
  one graph) succeeds; `size-budget --entry index.html` 414.7 KB gzip static + 140.5 KB worker =
  555.3 KB combined (budget 600 KB) — **up from the previously-committed 409.3 KB** because
  `maplibre-gl` itself is now shared between the two entries (report.html genuinely needs it too,
  and `tests/size-budget-gallery-isolation.test.ts` pins index.html and report.html to the SAME
  Rollup config, unlike gallery.html) — the avoidable share (`lib/map/{style,layers/*}.ts`,
  `camera.ts`) was eliminated via `mapWiring.ts`/`colors.ts` above, and 555.3 KB still clears the
  600 KB combined budget comfortably; `size-budget --entry report.html --allow-marker duckdb`
  52.6 KB gzip static, 0 worker (budget 450/150 KB); both committed red fixtures still fail;
  `e2e/report.spec.ts` (chromium, hermetic, zone places only — see that file's own header for
  scope) 9/9 green, and caught two real bugs before commit: the theme was never set (white text on
  a light background) and a stray trailing CSS rule silently defeated the print watermark under
  `@media print`.

# atlas 0.10.3

`atlas-8` step 3: budgets and the browser suites in CI; `docs/performance.md`.

- **`.github/workflows/pages.yml`, six new jobs**: `e2e` (the root Playwright suite, all three
  engines, then the `timing` project as its own step after them), `e2e-gallery`, `e2e-engine`,
  `e2e-opfs`, and `parity` (v9 against the real bucket — verified PASS, max|Δ| < 1e-9 on every
  quantity, before this job was written). `publish` now depends on all of them, plus `checks` and
  `test-faults` (0.10.1).
- **`docs/performance.md`** — what every budget/timing gate measured on this laptop (size-budget:
  409.4/140.5/549.9 KB gzip; the timing gate: median 1579 ms of 3 cold runs against a 2.5s budget)
  and an honest accounting of what has NOT yet been observed on a real CI runner (this session has
  no CI access) — the jobs are wired, not yet run for real; atlas-0's F6 ask ("record the runner's
  number") is half-done until the first real `main` run's numbers are pasted back in.
- **The three slowest `verify.mjs` states, profiled**: all three are early-in-the-run desktop
  states within 500-1150ms of each other regardless of what they render — cost is dominated by
  per-page browser/hydration overhead, not by any state's own data. No fix indicated.
- `scripts/verify.mjs` now times every state and prints the slowest 3 at the end of a run.

`atlas-8` step 4: the fiddly bits that are code, not data.

- **Playwright route handlers now tolerate a test ending** (`e2e/routeSafety.ts`'s `safeRoute`) —
  the Firefox teardown race ("`route.fetch: Test ended`" outside any test, skipping the next one)
  is swallowed at the handler level in `e2e/{hermetic,map-hermetic,species-hermetic}.ts`; any other
  error still propagates.
- **`Panel.svelte`'s nested landmarks, fixed**: the panel body no longer carries a second
  `role="region"` inside the section that is already the panel's one landmark. New gate:
  `tests/ui/panelLandmarks.test.ts`.
- **The skip link now reaches the tool rail too**: a second skip link ("Skip to the tools",
  `#rail-region`) precedes the existing one — the rail's single roving-tabindex stop used to be
  reachable only by Shift+Tab backward from the panel. New gate: `tests/shell/skipLinks.test.ts`.
- **`?theme=navy|paper` accepted as aliases of `dark|light`** — the gallery/mockups' own theme-name
  convention now resolves correctly if pasted into the real app, in both the real parser
  (`THEME_ALIASES`, `src/lib/state/codec.ts`) and index.html's inline pre-paint script. New gate:
  `tests/shell/themeAliases.test.ts`; `tests/shell/theme-preboot.test.ts`'s shared case table grew
  two rows.
- **`DataTable`'s filter `<input>` itself reaches 44 CSS px tall on a coarse pointer** (spec §11) —
  the wrapping label already did; the visible, tappable input stayed ~28px. New gate:
  `e2e/gallery.spec.ts`'s "atlas-8 fix" describe block.
- **The Categories demo table no longer overflows the page at 320 CSS px** — wrapped in a
  `overflow-x: auto` scroll container (SC 1.4.10 exempts a data table's own scroll, never the
  page's). New gates: `tests/ui/categoriesOverflow.test.ts`, `e2e/gallery.spec.ts`'s "atlas-8 fix".
- Found while running the full gallery suite: `e2e/gallery.spec.ts`'s own Panel-body test still
  asserted the pre-fix `role="region"` — updated to assert its absence instead.

# atlas 0.10.2

`atlas-8` step 2: the Playwright state matrix, widened to three engines.

- **`scripts/verify.mjs`, filled in** — grew from a 4-state, chromium-only skeleton to 58 named
  view states (shell/theme, the scores lens' projection × outline × unit × palette × layer × area ×
  zone-selection combinations, the species lens' species × US-only × representation combinations) ×
  3 viewports (1280×800 / 390×844 / 320×800) × 3 engines (chromium/webkit/firefox) = 522 runs, fully
  hermetic (reuses `e2e/{hermetic,map-hermetic,species-hermetic}.ts`'s own fixtures via the same
  bundler-extension resolve hook `scripts/parity/run.mjs` uses). Per-state assertions beyond
  `assertLayout()`: a `gl.readPixels` raster probe (alpha-blended against `SCORE_RASTER_OPACITY`,
  not the raw fixture colour) and a rendered-vector-feature count, both run at desktop only (the
  fixture camera is desktop-tuned; a Program Area can legitimately sit outside a phone's narrower
  view at the same zoom — not a bug this matrix owns). `--engines=`/`--limit=`/`--states=` flags for
  fast local iteration.
- **Two real bugs the matrix found and fixed:**
  - The version chip's unstyled `PREVIEW` badge (`src/lib/ui/VersionBadge.svelte`) widened
    `button.chip` past its 84px CLS-stable min-width, pushing the topbar's theme toggle 0.7px past
    the right edge at 320 CSS px — only reachable by viewing a restricted/preview release (the
    species lens' v9 fixture). Fixed with a compact `.ms-preview-badge` style (`shell.css`).
  - `e2e/places.spec.ts`'s keyboard-only rename test selected the existing text with `Home` then
    `Shift+End`, which did not update WebKit's DOM selection the same way Chromium/Firefox's did —
    the later `type()` call inserted instead of replaced. Switched to `ControlOrMeta+a`.
- **`e2e/map.spec.ts`, `e2e/scores.firstpaint.spec.ts`, `e2e/species.smoke.spec.ts`,
  `e2e/places.spec.ts` widened from chromium-only to all three engines** (all measured green,
  except one open finding below).
- **One open, honestly-scoped finding, not silently widened:** `scores.firstpaint.spec.ts`'s v9
  raster probe reproducibly times out on Firefox specifically when run immediately after v7's four
  tests in the same file/worker (passes reliably alone or as the first test); root cause not
  isolated within this session. Skipped narrowly (`browserName==="firefox" && ver==="v9"`) with the
  finding documented in the test file itself, rather than reverting the whole file to chromium-only.
- **`e2e/verify.faults.spec.ts`** — the pyramid's three named seeded faults for this gate: a raster
  source 404 (DOM/layout stays fine; the pixel probe is what catches it), `setStyle` losing the zone
  layer (the vector-feature count is what catches it), and a panel pushed off-screen at 390 px
  (`assertLayout`'s per-control bounding-box check catches it, its whole-document overflow check
  does not).

# atlas 0.10.1

`atlas-8` step 1: gate inventory + the seeded-fault suite.

- **`tests/GATES.md`** — every gate named across atlas-0…7/9's subplans and Progress logs, where it
  lives, its committed seeded fault (or the rewrite that gave it one). ~95 gates inventoried; ~90
  already self-prove on `npm test`; 4 were "CANNOT FAIL" and are fixed in this release.
- **`npm run test:faults` (`scripts/test-faults.mjs`)** — the seeded faults that must be applied to
  the REAL exported function (not a parallel copy in a test file): each one is a committed unified
  diff under `tests/faults/*.patch`, applied in its own `git worktree add --detach` copy of HEAD
  under `$TMPDIR`, run against its named gate, and asserted RED, then discarded. Ships with three
  faults: `coverage-quadratic-scan` (the widened ratio gate below), `rmod-guard-drop`, and
  `opfs-eviction-order`. Wired into `pages.yml` as its own job, gating `publish` the same way
  `checks` does.
- **The coverage vertex-ratio gate, widened** (`tests/geo/coverage.test.ts`) — the existing 600↔2400
  vertex pair (threshold 8×) measured a real O(n²) fault at only ~2× (atlas-2's own closing-review
  finding: too weak to be load-proof). Added a 600↔16,000-vertex pair, threshold 16× — the same
  fault now measures 34–41× against a 5.4–7.6× baseline.
- **Species lens source scan widened** (`tests/lens/species/sourceScan.test.ts`) — now also scans
  `src/lib/map/**` (previously invisible to it), and follows one relative-import hop per file so a
  forbidden grid constant re-exported from a sibling module is caught even when its literal digits
  never appear in the scanned file's own text.
- **`document.title` has exactly one writer** — `Shell.svelte` and the species lens
  (`src/lens/species/state.svelte.ts`) each ran an independent effect writing it, racing on Svelte's
  own effect-scheduling order. Consolidated to `Shell.svelte`; new source-scan gate
  `tests/shell/documentTitle.test.ts`.
- **Upload refusal-copy per-rule assertions** (`tests/geo/upload/messages.test.ts`) — the old
  aggregate checks let a vague-but-grammatical "mysteryRule" through undetected. Added per-rule
  tables: `what` must name the number/name that decided a count-based rule's outcome (13 rules);
  `fix` must name a concrete format or tool (20 of 22 rules).

# atlas 0.10.0

`atlas-7` step 1: the report data model — one pure function from `(release, places)` to a plain
object whose every number equals what R produces for the same places.

- **`buildReport()` (`src/lib/report/model.ts`)** — header (title, `ver · status · access`,
  generated stamp, permalink parts, the PREVIEW banner and `PREVIEW_` file prefix on a restricted
  release), intro, per-place parameters (kind, zone keys or vertex count / bbox / area / N cells /
  the D7b share inside the study area / the place token), the map's ramp domain, one flower per
  place, the Table of Scores with a coverage footnote for every component below 100 %, the species
  cross-tab + top 20 + full list, dataset citations, and a provenance block that replaces
  `devtools::session_info()` (every table read with its digest, app SHA, DuckDB-WASM version,
  timestamp, the SQL that ran, and a runnable "Reproduce in R" snippet carrying the real place
  token). It **fetches nothing**: the caller supplies the already-run queries, and every one of them
  may be `null` so the document can render progressively. Every figure also carries a text summary
  (`model.summaries`), the accessibility gate's input.
- **The numbers gate.** `tests/fixtures/report/{v7,v9}/report_{gaa,gulf_rectangle,aleutian_dateline}.json`
  — six committed R references generated read-only by `scripts/parity/report_fixtures.R`
  (`npm run report:fixtures`; see `tests/fixtures/report/README.md` for the exact commands).
  `tests/lib/report/numbers.test.ts` asserts every score within `1e-9` and the counts, the top-20
  order and the full-list order **exactly**, per place per version, with the input rows shuffled
  first so the model's own sorts are what is measured. R and TypeScript agree on all six.
- **Six seeded faults** (`tests/lib/report/faults.ts` + `faults.test.ts`), each proven red against
  the same fixtures: a mis-mapped `er_consolidate` arm, the ramp not widened when every place
  agrees, `Overall` as a weighted mean, the top 20 sorted by the wrong column, a suppressed coverage
  footnote, and the D7b clip bypassed for a custom place.
- **`src/lib/release/cite.ts`** — new, and the app's ONE dataset-citation path. It reads
  `boot.datasets`' `citation`/`link_info`, which nothing did before (the species lens's
  `datasetIndex()` keeps only the display fields). It lives under `release/`, not under `report/`,
  so a lens can use it without dragging the report into `index.html`'s static graph.
- **`tests/report-lazy-import.wiring.test.ts`** — `src/lib/report/` must stay unreachable from
  `src/main.ts`'s static import graph. `scripts/size-budget.mjs` only ever walks `index.html`, so it
  could not have caught a leak until it grew past the budget; this scan states the invariant
  directly. `index.html`'s static critical path is unchanged at 409.3 KB gzip.
- **`docs/report-model.md`** — the model's shape and what steps 2–3 render from it, including the
  two places where two numbers legitimately differ: a zone place's published `zone_metric` vs the
  same area traced as a custom place (v9 GAA 40.4484 vs 40.4982), and the flower's drawn-petal mean
  vs the table's `Overall` on releases that publish both `primary producer` and `primprod`.

# atlas 0.9.15

- The species first-paint timing gate's Playwright project now `depends` on the three engine
  projects, so in a full `npx playwright test` run it starts only once they have finished and the
  machine is quiet (started concurrently it hit its 10 s predicate timeout; alone, and now in the
  full run, medians of ~1.5 s). `--project=timing` still runs it on its own.

# atlas 0.9.14

`atlas-6` fix round 1 (Opus review): four must-fixes in the places panel.

- **Share dialog: dead ladder, link/number divergence.** `ShareDialog.svelte` now branches on
  `fit.simplified` BEFORE `fit.status`, so the simplify-and-accept ladder actually renders whenever
  a rung already ran to fit the link (previously unreachable: `fit.status === "ok"` is true for an
  accepted rung too). `copyLink()` now builds the copied URL from `fit.hash` via the new
  `shareUrl()` helper (`src/places/share.ts`), never `location.href` verbatim — which used to copy
  the ORIGINAL, unsimplified link while the dialog displayed the simplified length. Accepting a
  rung recomputes from `fit.places` directly so the numbers on screen update before anything is
  copied.
- **"Show analysis cells" now paints the D7b-clipped set.** `Places.svelte`'s
  `toggleAnalysisCells()` calls the new `placeCellsInStudyArea()` (`src/places/results.ts`) instead
  of the raw, unclipped `geo/coverage.ts#cellsInPolygon()` — a place straddling the study-area edge
  no longer paints land/foreign-water squares the analysis itself never counts.
- **D7b's study-area clip has a behavioural test**, not just a text regex over the SQL: a new
  `tests/analysis/studyAreaClip.test.ts` evaluates the real `sql/cells_in_study_area.sql` WHERE
  clause against a small in-memory cell table (`in_usa` TRUE/FALSE/NULL), proving NULL counts as
  inside and the composite reflects only the clipped cells. `MAX_PLACES` (model.ts vs.
  upload/normalize.ts) and `CIRCLE_SEGMENTS` are now pinned with a regression test each.
- **Fresh-profile round trip**: `e2e/places.spec.ts` gained a real-release test (a tiny checked-in
  DuckDB-WASM fixture) proving that copying a place's share link and opening it in a brand-new
  browser context recomputes the identical cell count and composite.

# atlas 0.9.13

atlas-5 fix round 3: pins four reviewer faults that stayed GREEN, plus the five-probe
`/cog/point` gate as a permanent unit test.

- **US-only toggle keeps a shared selection (SpeciesPicker.svelte)**: `data/picker.ts`'s
  `keepSelection` was already pure and tested, but nothing exercised the SVELTE WIRING that calls
  it — dropping that call stayed green. New e2e case (`e2e/species.smoke.spec.ts`) loads a non-US
  taxon directly, ticks "Only species in US waters", and asserts the fallback to the default; also
  asserts a taxon in both lists survives the toggle either direction.
- **`createSearchLogger(now)`** (new, `data/picker.ts`): the 900 ms debounce + ≥ 3 chars +
  no-repeats `search_species` rule, pulled out of `SpeciesPicker.svelte`'s inline `setTimeout` so a
  fake-clock unit test can pin it (`tests/lens/species/picker.test.ts`) — a 900 → 90 ms fault and
  an "allow a repeat" fault both now go red.
- **`popup.ts`'s 0.5 luminance threshold** now has a PAIRED fixture (`#7f7f7f`, 0.498 → white,
  beside `#808080`, 0.502 → black) — the previous one-sided fixture could not tell "the threshold
  is 0.5" apart from "the threshold is anywhere below 0.502"; a 0.5 → 0.35 fault now goes red.
- **`src/lib/map/styleQueue.ts`**: a bounded fallback (`DEFAULT_STYLE_FALLBACK_MS` = 4000) flushes
  a queued style even if `"idle"` never fires — a HUNG tile request (no response, ever) used to
  strand a queued style silently, same symptom as fix round 1's bug, just triggered by the network
  instead of event timing. Unit-tested with a fake clock; e2e twin in `species.smoke.spec.ts` hangs
  both basemap and titiler tiles and asserts a species switch still shows the new raster source.
- New unit test: `tests/lens/species/popup.test.ts`'s "the five `/cog/point` probes" drives the
  real `createTitilerValueSource` (cog / AquaX-delivered / pmtiles-presence / nodata / off-grid)
  into `popupContent.displayValue`, pinning the whole click pipeline, not just the swatch math.

# atlas 0.9.12

`atlas-4` fix round 2: the flower threw on every v8/v9 view. Both releases publish
`extrisk_primary_producer_ecoregion_rescaled` (the species-category extinction-risk term) AND the
unrelated `primprod_ecoregion_rescaled` (raw environmental productivity) — both fold onto ONE
`primprod` category (`categories.ts`'s synonym table predates a release publishing both at once),
and `computeFlowerGeometry` deliberately throws when two components share a category. Verified
against the publish pipeline itself (`workflows/score_cell_metrics.qmd`:
`comp_keys <- c(glue("extrisk_{sp_cats}_ecoregion_rescaled"), "primprod_ecoregion_rescaled")`) that
BOTH terms genuinely feed the composite score as separate, equal-weight inputs — this is a FLOWER
DISPLAY collision only, not a data-correctness issue.

- `src/lens/scores/flower.ts`: every path (`fromMetrics`/`zoneFlowerComponents`,
  `defaultFlowerComponents`, `cellFlowerComponents`) now runs its components through
  `dedupeFlowerComponents` — ONE slot per resolved category, keeping the ER-weighted
  species-category term over the bare environmental twin on a collision. Each now returns a
  `DedupResult` (`{components, droppedLabels}`) instead of a bare array.
- `src/lib/ui/flowerGeometry.ts`: new `computeFlowerGeometrySafe` — the throwing
  `computeFlowerGeometry`, but a same-category collision degrades (first-seen category wins,
  the rest reported in `droppedKeys`) instead of throwing; a belt-and-braces fallback for a caller
  that did not already de-duplicate its own data. `Flower.svelte` calls this, never the throwing
  form directly, and announces every dropped label (its own catch AND the caller's
  `droppedLabels` prop) exactly once via the shared Announcer ("duplicate component skipped:
  {key}") — a data quirk degrades the flower, it never blanks it.
- New fixture `tests/lens/scores/fixtures.ts`'s `BOOT_V9`, trimmed from the LIVE v9
  `app/boot.json` (curl'd 2026-09-22): the exact 17-key `layers` list and the exact
  `flower_default.AK` (8 entries, both "primary producer" and "primprod" present) — the real
  collision, not a synthetic stand-in. `e2e/scores.firstpaint.spec.ts` now runs its whole suite on
  BOTH v7 and v9 (v9 via a preview session — it is `restricted` in the versions fixture, matching
  the live registry); the default-flower test's expected hub value is version-specific (v9: 7
  kept of 8, mean rounded to 22).
- New `src/lib/map/style.ts`'s `layersControlItems(style)`: a "layers control" derived from the
  actually-composed style's own layer ids, never a hand-maintained list — the structural fix for
  the ported Shiny app's known bug (parity doc §6.4: a control hardcoded to `pra_ln`/`pra_lbl`/
  `er_ln`/`r_lyr`/`outside_pra_lyr` while the real ids were `programarea_ln`/`programarea_lbl`/
  `ecoregion_ln`/…, so three of five switches were dead after any sidebar change). This
  architecture already avoided that bug; `tests/map/style.test.ts` now names and pins it.

# atlas 0.9.11

- The species cold first-paint gate (`e2e/species.smoke.spec.ts`'s "paints the first species pixel

- The species cold first-paint gate (`e2e/species.smoke.spec.ts`'s "paints the first species pixel
  within 2.5s cold" test) is now its own serial Playwright project: moved to
  `e2e/species.timing.spec.ts` (project `timing`, `workers: 1`), gated on the MEDIAN of 3 fresh-context
  cold loads rather than a single sample, so engine-matrix CPU contention (measured: 3,065 ms inside
  the full `npx playwright test` run vs 1,578-1,621 ms alone) can no longer fail it spuriously. No
  functional species-lens test changed; shared fixtures moved to `e2e/species-hermetic.ts`.

# atlas 0.9.10

`atlas-4` fix round 2: `src/shell/Shell.svelte` statically imported every lens' panel component
(`ScoresLens`, `VersionPickerModal`, `WelcomeModal`, `SpeciesLensPanel`, `SpeciesPicker`,
`SpeciesLegend`, `NotFoundModal`, `Places`) — 450.4 KB gzip static, 0.4 KB over
`scripts/size-budget.mjs`'s 450 KB budget, and a species-only deep link downloaded the entire
scores lens it never renders (`e2e/species.smoke.spec.ts`'s cold first-pixel spec measured
2,742 ms). Measured after this fix: **409.2 KB gzip static** (budget 450) / **140.5 KB gzip runtime
worker** (budget 150); species cold first-pixel back to **2,061 ms** (budget 2,500).

- Every lens PANEL component now loads as its own dynamic `import()` chunk, chosen by `sel.lens`
  (`ScoresLens` on "scores"; `SpeciesLens`/`SpeciesPicker`/`SpeciesLegend`/`NotFoundModal` together
  on "species") or by `activeTool === "places"` (`Places`) — the same `Component<any>` held in
  `$state`, resolved by a `$effect`, rendered via `{@const Comp = ...}` pattern
  `TablePanel.svelte`/`Composition.svelte` already used for `Composition.svelte`/`Treemap.svelte`.
  `VersionPickerModal`/`WelcomeModal` are app-wide chrome (not gated on `sel.lens`) and load
  unconditionally right after mount — still their own chunk, out of the entry's static graph, just
  not delayed. The species lens' pure data/wiring layer (`state.svelte.ts`) and the places map store
  (`placesMap.svelte.ts`) stay static, since both are needed before any panel component mounts and
  neither imports a `.svelte` file itself. The ONE `panelBody` snippet and the ONE
  `composeStyle`/`applyStyle` effect are unchanged in structure — a lens still only computes
  `composeStyle` inputs (docs/map.md); the shell still owns mounting and the one style call. A
  chunk still in flight falls back to the existing `TOOL_BODY[activeTool]` skeleton text (or simply
  renders nothing, for an overlay/modal with no visible closed state), so
  `e2e/shell.cls.spec.ts`'s skeleton/hydrated geometry-equality gate is unaffected.
- New regression test, `tests/shell/lazy-lens-imports.test.ts`: a source scan asserting
  `Shell.svelte` never statically imports a `.svelte` panel component under `src/lens/` or
  `src/places/`, with its own seeded-fault case (mirrors `tests/places/lazyImports.test.ts`'s
  technique for terra-draw).

# atlas 0.9.9

`atlas-6` step 4: results and share (Deliverables 5-7), closing out the phase. Measured:
**420.2 KB gzip static** (budget 450) / **140.5 KB gzip runtime worker** (budget 150).

- **Results for a custom place**, by the published zone method (master plan D7/D7b), reusing
  `src/places/dataEngine.ts` from step 3: coverage ("N% of this place is inside the US study
  area", each component's own coverage/mean-where-present), composite + a `Flower` (shared
  `src/lib/ui/`, not the scores lens's own — this renders entirely within `src/places/**`), and a
  components `DataTable`. A place wholly outside the study area gets the "no scores" notice
  (`ResultsPanel.svelte`), never a row of zeros.
- **Species need `cell_model` tiles**: the fetch plan (tile count, MB — real `Content-Length` via
  `HEAD`, falling back to a documented average) shows before anything downloads; above 40 tiles or
  150 MB it asks first (`src/places/fetchPlan.ts`); progress reads "batch N of M" as each
  ≤ 8-tile batch's buffers are dropped. `capabilities.cell_model === false` shows "species aren't
  available for this release" instead of a table.
- **Share** (`ShareDialog.svelte`) states what the link carries (release, lens, layer, camera, N
  places) and its length; over 2,000 chars a note, over 8,000 the simplification ladder
  (before/after vertices, area change %, cells changed) — and **accepting writes the simplified
  geometry back to `#pl=` itself**, never a share-only copy, so the numbers visibly update before
  the (now-shorter) link is copied. Nothing fitting even simplified offers the GeoJSON download
  first. Reuses `geo/placeCodec.ts`'s `fitPlacesToUrl` (atlas-2) — this phase only adds the "what it
  carries" summary and the before/after diff.
- **Analytics** (`place_draw`, `place_upload`, `place_share`) are now wired at their real call
  sites — a drawn shape, an upload's outcome, a copied share link — all counts/buckets only
  (`src/places/analytics.ts`, built in step 1). Every call site's `track` prop defaults to a no-op:
  no GA4 loader is mounted app-wide yet (`analytics.ts`'s own header), so nothing sends anything
  until a later phase wires that in.

# atlas 0.9.8

`atlas-6` step 3, UI half: upload (Deliverable 4). Drop a file anywhere on the map (a native
drop/dragover listener on the map's own container) or use the picker; `src/lib/geo/upload/` (atlas-2's
parsing half) is called only through a dynamic `import()`, so this is the first time anything in
`src/` reaches it. `src/places/dataEngine.ts` is new: the ONE lazily-created DuckDB engine +
`AnalysisSources` this panel now shares between the study-area check here and Deliverable 5's
results (a later commit) — `Engine` itself, and `analysis/templates.ts` (which embeds every
`sql/*.sql` file verbatim, comments included), are dynamic imports for the same reason terra-draw
was in step 2: a correctly-lazy reference that still matched `scripts/size-budget.mjs`'s
forbidden-marker text scan ("duckdb"; `composition.sql`'s own comments happen to say "treemap").
Measured: **409.1 KB gzip static** (budget 450) / **140.5 KB gzip runtime worker** (budget 150).

- Every refusal (a bad file, a point/line geometry, a self-intersection, an out-of-range or
  projected coordinate, a `.gpkg` with no runtime wired) renders verbatim (what/why/fix) in the
  panel, never "invalid file".
- A multi-feature file asks once: keep every shape as its own place (auto-named "Uploaded place N",
  editable via the existing inline rename — a live "name from this property" picker is NOT wired
  this step, a documented scope trim) or merge into one. Re-parses with the chosen
  `multiFeature` option rather than re-implementing the split client-side.
- The GeoPackage consent prompt (naming the ~22 MB, third-party `extensions.duckdb.org` download)
  is written, but with `runtime: null` (no DuckDB `spatial` wiring in this phase — docs/upload.md's
  own documented limitation): every `.gpkg` ends at the "convert to GeoJSON" fallback refusal today;
  wiring a real runtime later needs no UI change.
- **"Must touch the study area" (D7b) is a real, network-backed check** (`src/places/studyArea.ts`):
  fetches only the place's own `cell` tiles (materialize-then-query) and clips to `in_usa` cells
  (`sql/cells_in_study_area.sql`) exactly as Deliverable 5's results will; zero touching cells is
  `outsideUsWaters()`, never a silently-added place with nothing to score. Because
  `NormalizeOptions.studyArea`'s own type is synchronous and this check is not, it runs as a
  separate async step immediately after `normalizeUpload()`/`parseCoordinateEntry()` returns
  `ok: true`, before the place is added — same user-visible refusal shape either way.

# atlas 0.9.7

`atlas-6` step 2: drawing (Deliverable 3). `terra-draw@1.35.0` +
`terra-draw-maplibre-gl-adapter@1.4.1` are new, exact-pinned dependencies, reached ONLY through
`src/places/draw.ts`'s dynamic `import()` — genuinely lazy: neither package appears in
`index.html`'s static import graph (`tests/places/lazyImports.test.ts`), and `vite.config.ts` now
renames their output chunks (`draw-vendor-*.js`) because Vite's default chunk-naming otherwise put
the literal string `"terra-draw"` into the entry's own dynamic-import specifier — a correct, lazy
reference that still tripped `scripts/size-budget.mjs`'s forbidden-marker text scan. Measured after
the fix: **405.9 KB gzip static** (budget 450) / **140.5 KB gzip runtime worker** (budget 150).

- **Polygon, rectangle and circle** (a 64-gon, `CIRCLE_SEGMENTS`), plus a select/edit mode with
  midpoints (drag a vertex, drag a midpoint to add one, drag the whole shape) — touch-capable
  (terra-draw's own adapter). On finish, the RAW drawn geometry is run through
  `analysis/place.ts`'s `analysisGeometry()` (unwrap, then decode(encode(...))) before it becomes a
  place — Deliverable 3's "what is displayed is what is analyzed" starts at creation, not at share
  time — and the displayed outline is redrawn from that decoded geometry, densified to ≤ 0.25°
  steps per edge (`src/places/densify.ts`) so a long straight analysed edge cannot visibly bow on
  the globe projection.
- **"Show analysis cells"**: for the selected drawn/uploaded place, paints every covered cell
  (`geo/coverage.ts#cellsInPolygon`, purely client-side — no engine needed) at `fill-opacity = pct /
100`. `SelectionSpec` gained one field for this (`cellOpacity`), the selection layer's only change
  (`src/lib/map/style.ts`); disabled above 20,000 cells (`MAX_ANALYSIS_CELLS`).
- **"Enter coordinates"**: the promised keyboard/screen-reader alternative — drawing is never the
  only way. A bounding box (`xmin, ymin, xmax, ymax`), a list of `lon, lat` lines (≥ 3, closed
  automatically), or pasted WKT/GeoJSON (handed to the SAME `normalizeUpload()` a file drop uses, so
  a typed shape passes through every rule Deliverable 4 already enforces — self-intersection, the
  antimeridian, the vertex cap). A refusal renders verbatim (what/why/fix), never "invalid".

# atlas 0.9.6

`atlas-6` step 1: the Places panel (Deliverable 1) and pick mode on the release's one drawable
zone unit (Deliverable 2, Tier 0 — zone places only; draw/upload/results follow in the next three
commits). `src/places/**` is new; the shell mounts it where the "Places" rail tool already
reserved a panel slot (`src/shell/Shell.svelte`), and the map only gains one new `composeStyle`
input (the pick-mode highlight, folded into the existing `selection` field).

- **The list**: kind icon, inline rename (≤ 60 chars, `geom`/`upload` places only — a `zone` place's
  identity is its keys, not a name, per the `g1` codec's own schema), area km² (a fast client-side
  estimate until Deliverable 5's results land; a zone place's is `boot.zones`' own published
  number), data coverage % and a composite chip where known, and zoom / duplicate / delete / "open
  in report" (a stub link to `report.html` carrying the same query + hash). Up to 20 places; every
  mutation writes `#pl=` through the existing `g1` codec with `history.replaceState` only — never a
  second copy of the list.
- **Pick mode**: click a zone on the map to select it; Ctrl/Cmd-click, Shift-click or a long-press
  (500 ms) adds to the selection; clicking the sole picked zone again clears it. "Add to places"
  turns the current pick into one new zone place (`z.pa.GAA,WGA`) — this is also the exact function
  (`src/places/model.ts`'s `addZonePlace`) the scores lens's zones table calls once atlas-4 builds
  it, needing no reference to this panel's UI.
- **"Recent"**: the last ten place tokens in `localStorage`, never the only copy of a live place; a
  "Clear" button, and "Add back" to restore one.
- **`SELECTION_COLOR` is now pinned** (`tests/map/colors.test.ts`): the constant itself, not just
  code that stays self-consistent with whatever value it happens to hold today.
- Footer: Share (copies the current link — the same clipboard action the top bar's Share already
  uses) and Download places (a GeoJSON `FeatureCollection` of the decoded geometries actually
  analysed; a `zone` place, which carries no geometry client-side, is a named `geometry: null`
  feature rather than being silently dropped).

# atlas 0.9.5

atlas-5 fix round 2: closes the gaps a review found in fix round 1's `map.ts` `applyStyle`-queue
fix (0.9.4) — a real fix with no regression test, and two seeded faults whose automatic diffs came
back empty.

- **`src/lib/map/styleQueue.ts`** (new): the queue pulled out of `map.ts` into a pure, testable
  function (`createStyleApplier`), so the `"idle"` vs `"style.load"` fix has a real regression test
  (`tests/map/styleQueue.test.ts`) — reverting to `"style.load"` reproducibly reds 3 of 4 cases,
  including the one modelling two separate not-loaded windows. `map.ts` now delegates to it.
- `e2e/species.smoke.spec.ts`: a new case drives the exact race through the real app (two rapid
  `selectSpecies()` calls before the map's first `"idle"`) and asserts the SECOND species' raster
  ends up in `map.getStyle().sources` — reds under the reverted fault, passes with it.
- A new case exercises the PMTiles ranges branch through real MapLibre vector-tile parsing
  (reusing atlas-map's committed `zones.pmtiles` archive under a range-style filter, since a
  fresh one-polygon archive would only re-prove tippecanoe works): "a range draws ≥ 1 rendered
  feature."
- Verified by hand (the automatic fault-seeding's diff was empty for both): a hard-coded `[1, 100]`
  rescale in `mapInputs.ts`'s COG branch reds the AquaX-Delivered unit test; a
  `["!=", ["get", "mdl_key"], "__none__"]` filter in `map/layers/ranges.ts`'s `rangeLayer` (admits
  every model) reds the ranges unit test. Both reverted after confirming red.

# atlas 0.9.4

`atlas-5` steps 1-2: the species lens UI, on top of the already-merged data layer
(`src/lens/species/data/**`) and shared map module (`src/lib/map/**`). Delivered together (skipping
an interim 0.9.3 checkpoint) because the two steps share one reactive core.

- **Shard-driven species view**: on `sp=` the taxon shard loads, draws through `composeStyle` (the
  asset's OWN colormap/rescale — AquaX delivered `[0,1000]`, everything else `[1,100]` — opacity
  0.8, nearest), a continuous legend from `ramps.ts`, the sidebar card (§7.3), and a camera fit to
  the layer's own extent. `merged.type = null` shows "No surface published for this taxon in {ver}"
  instead of a raster. Document title tracks the layer on screen.
- **The camera never calls MapLibre's own bounds-fitting method** (`tests/map/no-fitbounds.test.ts`'s
  gate covers `src/lens` too): `src/lib/map/camera.ts`'s new `boundsToCameraView()` computes the
  equivalent center+zoom by hand, in linear (never re-wrapped) Mercator space, so a frame whose
  `east` exceeds 180 fits correctly; `map.ts`'s new `flyToBounds()` is the imperative half. Refits
  ONLY when the species changes, never on a layer/representation switch.
- **Picker + search**: `app/taxa.json` loads on focus/idle, grouped by `sp_cat`, ranked
  (exact→prefix→word-start→substring, scientific before common), virtualized (reusing
  `dataTableCore.ts`'s window math). "Only species in US waters" keeps the current selection across
  the swap. `search_species` logs at ≥3 chars, 900 ms debounced, no repeats.
- **Layer bar + representation**: green `is-merged` / a distinct `is-input` state, one pill per
  input in `dataset.sort_order`; a struck-through pill for an input with no published surface is a
  plain, non-focusable `<span title="...">` (not a `<button>`) — the atlas-5 gate's exact wording.
  The Original/Interpolated ↔ Delivered/As ingested toggle switches `rep`, live.
- **The PMTiles ranges branch**: a new `map/layers/ranges.ts` builder + `ComposeStyleInput.range`
  field + `LAYER_ORDER` role, filtered to the asset's own `mdl_key`; switching from a COG layer to a
  range (or back) removes the old source AND layer together, proven by a test (the stale-surface
  bug, §11.8) — `composeStyle` always replaces the whole style.
- **Click → popup**: `cellFromLonLat` on the release's own grid (never a hard-coded 7200/3600), the
  sampled value via `/cog/point` behind `ValueSource` (plan D4), binned against the asset's OWN
  rescale (generalizing §6.5's literal `[1,100]` formula so an AquaX Delivered click still lands in
  the right bin), swatch/text-luminance rule byte-for-byte from the reference. A range click reports
  "presence only"; no value is a grey pin + "no value here". A real `maplibregl.Popup` opens on the
  first click.
- Deep-link resolution (`?mdl_key=`/`?mdl_seq=`/`sp`), the "Model not found" modal, and the ten
  analytics events are wired into `state.svelte.ts` already (step 3 lands the remaining chrome:
  welcome modal, release picker, tour, OBIS).
- **Fixed a latent bug in `src/lib/map/map.ts`'s `applyStyle` queue** (atlas-map's own code, not
  species-specific — any lens whose data arrives async and calls `applyStyle` more than once before
  the map's first style finishes loading hits it): the queue was flushed on `"style.load"`, which
  MapLibre fires exactly ONCE, ever, for the true initial style transition. A second style queued
  while the map is briefly not-loaded again (e.g. while a newly-added raster source's tiles are in
  flight) registered a SECOND `once("style.load", …)` that never fires, stranding that style in the
  queue forever — its layer never appears, silently. Now flushed on `"idle"`, which fires every time
  the map settles, for the whole life of the map. Caught by
  `e2e/species.smoke.spec.ts`'s cold-load gate; `e2e/map.spec.ts`'s existing suite still passes
  unchanged.
- `select_species` now logs on every species change EXCEPT the session's first (§10: "seeded with
  the default species so the opening taxon is not logged as a user choice").
- New: `src/lens/species/{mapInputs,popup,state.svelte,SpeciesTitle,LayerBarView,SpeciesCardView,
SpeciesLegend,SpeciesPicker,SpeciesLens,NotFoundModal}.{ts,svelte}`; `src/lib/map/layers/ranges.ts`;
  `boundsToCameraView` in `src/lib/map/camera.ts`; a `RANGE_FILL_COLOR` data color in
  `src/lib/map/colors.ts`; `vite.config.ts`'s `define: { __APP_VERSION__ }` (so `Analytics`'s
  `appVersion` never pulls the whole `package.json` — including its `pinReasons` prose — into the
  static bundle, which tripped the forbidden-lazy-chunk-marker scan on `"duckdb"`/`"shp"`/`"treemap"`
  literally appearing in that JSON).
- Size budget: 410.5 KB / 450 KB static, 140.5 KB / 150 KB worker (551.0 KB / 600 KB combined) —
  unchanged in shape from atlas-map's baseline, all species code counted since none of it is meant
  to be lazy.

# atlas 0.9.3-scores

`atlas-4` fix round 1 (of 2): two real Playwright regressions from steps 1-3, plus four seeded-fault
demonstrations.

- **Fix, `e2e/map.spec.ts`'s console-error assertion**: the scores lens mounts by default and its
  zones carry `label_pt` in every boot fixture here, so `zonesNeedGlyphs()` — false before atlas-4,
  since nothing exercised a label layer — is now true on an ordinary shell load. Verified live
  (`curl -sI` on the exact requested URL) that `layers/basemap.ts`'s `LABEL_FONT` ("Open Sans
  Regular") is correct: CARTO's glyph endpoint answers 200 for it. The actual fault was the
  hermetic fixture: `e2e/hermetic.ts` and `e2e/map-hermetic.ts` both routed
  `tiles.basemaps.cartocdn.com/**` to a 404, harmless only while unreached — Chromium logs ANY
  failed resource load as a console "error" regardless of how gracefully MapLibre recovers from
  it. Both now route to 200 with an empty body (a zero-byte protobuf is still a valid, if
  data-free, glyph message).
- **Fix, `e2e/shell.cls.spec.ts`'s skeleton-vs-hydrated geometry gate**: re-measured the real
  Layers panel at 1280px with no `boot.json` (this spec's own fixture state) and re-fit
  `index.html`'s skeleton to match — four `sk-field` rows (66px), one `sk-switch-row` (24px), the
  `sk-layers-control` section (43px) and the `sk-legend-note` fallback (36px), 12px gaps, in
  `.sk-panel-body` (now `display:flex` to lay them out the same way the real
  `.layers-panel` does). The pre-existing placeholder sentence (`TOOL_BODY.layers`,
  `tests/shell/tools.test.ts` still requires it verbatim) stays in the DOM but `hidden`, carrying
  no layout weight. Total: 524px at desktop, matching the hydrated panel exactly; phone was
  already correct (Sheet's fixed height ignores content either way).
- **Seeded faults, each shown red then restored** (four of the five requested; the D15 `?ver=`
  fault was already demonstrated in step 3):
  - a study-area key reaching a data query (`raster.ts`'s `scoreRasterSpec` appending `&area=GA`)
    — new permanent regression test added (`tests/lens/scores/raster.test.ts`, asserts
    `tileUrlLeaksStudyArea(...) === null`), then red, then reverted.
  - `fitBounds(` in `src/lens/scores` (`LayersPanel.svelte`'s `onAreaChange`) — caught by the
    existing `tests/map/no-fitbounds.test.ts` source scan (already scans `src/lens`), red, reverted.
  - the ER-rule table `EN 100 -> 99` — the rule was inline markup in `GlossaryModal.svelte` with no
    test; extracted to `src/lens/scores/glossary.ts` (CLAUDE.md: core logic in a plain module) with
    a new permanent test (`tests/lens/scores/glossary.test.ts`), then red, then reverted.
  - the 11-bin rule off by one (`raster/ramps.ts`'s `choroplethBin`) — the existing `zoneFill.test.ts`
    did not pin an exact stop colour, so it did NOT catch this; added a test asserting the exact
    low/mid/high stop colours against `boot.palettes` itself, then red (`#E5F498` vs expected
    `#FFFFBF`), then reverted.

# atlas 0.9.2

`atlas-4` step 3: chrome — the release picker (D15), the welcome modal, and the version-chip
`aria-haspopup` restore.

- **New: `src/lib/release/previewLink.ts`** (D15's pure link builder, handed over from atlas-3): a
  restricted release is offered ONLY as a link to the preview host's `/{ver}/atlas/` path,
  carrying the CURRENT query + hash verbatim, never `?ver=` on Pages.
- **New: `src/lens/scores/{VersionPickerModal,WelcomeModal}.svelte`**, mounted from Shell.svelte
  (app-wide chrome, not gated on `sel.lens` — the ported app's own modals were not lens-specific
  either). The version chip now opens a real dialog and carries `aria-haspopup="dialog"` again,
  restored in this SAME change per the subplan's own instruction (and
  `e2e/shell.a11y.spec.ts`'s matching test flipped from "carries no aria-haspopup" to "opens a
  real dialog"). A denied version (`?ver=v9` on the public host) auto-opens the SAME modal with a
  notice + the preview link, so the "why" is visible without an extra click.
- **The welcome modal** shows on first paint unless "Don't show this again" is set
  (`localStorage`); `?tour=off` hides the tour invitation. **Not built this step: the driver.js
  guided tour itself** — a new dependency plus its own lazy-chunk wiring was judged too much risk
  for the remaining budget; "Take a Tour" announces instead of starting one. The three ported
  modals (unknown/restricted/not-served) are consolidated into ONE modal varying its notice text
  by denial reason, a documented simplification over three separate dialogs.
- **Fix, test infrastructure**: the welcome modal's native `<dialog>` (`showModal()`) blocks
  pointer events across the WHOLE page while open, which broke nearly every OTHER shell e2e spec
  wholesale the moment it landed (they click `.topbar`/rail/panel controls with no reason to expect
  a blocking dialog). `e2e/hermetic.ts`'s `routeSealFixture()` — already called by every affected
  spec — now also seeds the "don't show again" key via `addInitScript`; a dedicated spec
  (`e2e/scores.welcome.spec.ts`) exercises the real, unsuppressed first-visit behaviour instead.
- New e2e: `e2e/scores.welcome.spec.ts`, `e2e/scores.versionPicker.spec.ts` (the D15 gate: the
  notice, its exact preview-host link, and zero `/v9/` requests — the "zero requests" half was
  already covered by the existing release-access gate).
- **Could not satisfy this step**: the driver.js tour (see above); the zones table landed in step
  2's commit rather than this one (built alongside the rest of the table panel; a step-boundary
  deviation, not a missing feature).

# atlas 0.9.1

`atlas-4` step 2: selection, the clicked cell's flower, the species table + CSV + composition
treemap.

- **Map click -> selection** (`ScoresLens.svelte`): `mapClick()` resolves a click on the release's
  own grid; the cell branch always selects a cell (`sel=cell:<id>`), the zone-choropleth branch
  only reacts to an actual zone hit (`sel=zone:<unit>:<key>`) — matching the ported app's separate
  `map_click`/`map_feature_click` events, never a fallback between the two.
- **The clicked cell's flower** now loads through the engine (`sql/cell_components.sql`, never
  `/cog/point`): `src/lens/scores/engine.ts` boots DuckDB-WASM lazily (dynamic `import()` only,
  memoised per release) the first time a cell is clicked or the species table opens.
- **New: `src/lens/scores/{SpeciesTable,ZonesTable,Composition,GlossaryModal,TablePanel}.svelte`,
  `{speciesLoad,composition,zonesTable}.ts`.** The species table is a bespoke grid (not
  `src/lib/ui/DataTable.svelte`, which renders every cell as plain text): real `<a>` cells for
  `taxon` (BOTW/WoRMS) and `model` (switches to the Species lens in place, keeping place and
  camera; a plain click intercepts to avoid a reload, a modifier-click/new-tab falls through to
  the browser's own default), still built on `dataTableCore.ts`'s proven sort/filter. CSV export
  writes the UNFORMATTED frame, RFC 4180-quoted. The zones table ranks every zone of the release's
  one unit by the current layer (`zone_metric`, read verbatim — the atlas-4 numbers gate holds by
  construction). The composition treemap groups by species category (not the six WoRMS ranks the
  ported app nests — `Treemap.svelte` is one level by design; see "could not satisfy").
- **`capabilities.cell_species_list = false`** (read as the closest match to the checklist's
  "`capabilities.cell_model`") and **`n_taxa == 0`** both show a header explaining why, never an
  error or an empty-looking table.
- **Fix, size budget**: `Composition.svelte` (and, inside it, `Treemap.svelte`) load through a
  DYNAMIC `import()` two hops deep from `TablePanel.svelte`, not a static one — a static import
  one hop up still failed `scripts/size-budget.mjs`'s "treemap" marker on `Treemap-<hash>.js`
  itself appearing in the entry chunk's own Vite chunk-preload bookkeeping, a case the marker scan
  is explicitly designed to catch. Static path: 410.3 KB gzip (budget 450).
- **Could not satisfy this step**: the "≤ 2 requests cold" gate's shape assumes the species table's
  CORE tables (`taxon`/`zone_taxon`/`taxonomy`) are already resident when a cell is clicked; this
  step loads them lazily on first need instead (fewer requests for a session that never opens the
  species table, more on the very first one) — not verified against the gate's literal request
  count. `analysis/queries.ts` and `release/dataBase.ts` are statically reachable (via
  `componentMetricKeys`/`dataUrl` type-adjacent usage), logged by Vite as
  `INEFFECTIVE_DYNAMIC_IMPORT`; harmless today (neither pulls in DuckDB) but not the fully-lazy
  "whole analysis layer" the plan describes — untangling it further was not done this step.

# atlas 0.9.0

`atlas-4` step 1: the Scores lens' Layers panel, legend and map wiring, from Tier 0 (`boot.json`)
only — `src/lens/scores/**`.

- **New: `src/lens/scores/{boot,raster,zoneFill,mapInputs,fallback,selection}.ts`.** Pure readers
  over `boot.json`'s scores shape (the ONE drawable unit per D17, layer groups/default — the
  release's `category: "composite"` row, never `boot.layers[0]`, which the publisher orders raw
  -> component -> composite, the opposite of the ported app's "order 1 = overall score"), the score
  raster + "cells outside Program Areas" overlay + legend (titiler tiles, `rescale` verbatim,
  `signif(…, 3)` endpoints — new `geo/round.ts` export), and the zone-choropleth 11-bin fill +
  legend (`round(range, 1)`, the `Inf/-Inf` empty-values guard).
- **`src/lens/scores/{LayersPanel,FlowerPanel,ScoresLens}.svelte`** mounted into the shell's
  existing "Layers"/"Flower" rail tools (Shell.svelte edit: a `lensMapExtra` bucket the active lens
  populates, merged into the shell's one `composeStyle`/`applyStyle` call — no lens ever touches
  MapLibre itself). The Flower tool already shows the release's default (nothing selected) or a
  clicked zone's flower from Tier 0 alone; a cell's flower needs the engine and lands in step 2.
- **An unknown `unit`/`lyr` falls back** (`fallback.ts`) to `"cell"` / the composite default, never
  a blank map — the atlas-4 gate, unit-tested.
- **A small, ADD-only map addition**: `ZoneUnitSpec.highlightKey` + `zoneHighlightLayer()`
  (`map/layers/zones.ts`) — a clicked zone's outline, filtered against its own vector source rather
  than a second geometry fetch. `docs/map.md`'s "add a composeStyle input" recipe, followed.
- **Today's real data gap, discovered, not invented**: every published release's `boot.palettes`
  carries ONLY `spectral_r` — no Viridis/Cividis/Magma stops. The palette picker still
  offers all four (the raster tile still renders correctly via titiler's own `colormap_name`), but
  the legend and the zone choropleth show a "not published" notice rather than guessing a ramp.
- Gate: `e2e/scores.firstpaint.spec.ts`, hermetic, with its own 20-feature Program-Area PMTiles
  fixture (`e2e/fixtures/scores/zones20.{geojson,pmtiles}`) — raster pixels at two ocean probes
  (correctly BLENDED at `SCORE_RASTER_OPACITY` 0.6, not full opacity), 20 outlines, the legend, the
  default flower.
- **Fix, `e2e/shell.a11y.spec.ts`**: re-triaged the pinned `color-contrast` incomplete ceiling
  (phone 5 -> 10, desktop 9 -> 16) for the Layers panel's real content — verified each new node's
  token pair against `scripts/contrast.mjs`'s 70 (now 86) resolved pairs before raising it.
- **Could not satisfy this step**: Fullscreen/navigation/scale MapLibre controls were attempted and
  reverted — they render into `#map`, which carries `role="img"`, and axe correctly flags the
  nested interactive buttons; fixing it needs a decision (drop `role="img"`? something else?) this
  step should not make alone. The Nominatim geocoder was not attempted. `e2e/shell.cls.spec.ts`'s
  skeleton-vs-hydrated exact-height gate for `panel-frame` now fails at desktop (106px skeleton vs
  ~524px real content): the gate's methodology (byte-exact skeleton height) cannot hold once a
  lens's DEFAULT view is boot-data-dependent content rather than one line of placeholder text —
  left for a follow-up that also affects the species lens, not patched here with an unverified
  guess at a new skeleton height.

# atlas 0.8.3

# atlas 0.8.1

`atlas-6` step 3, parsing half: the upload pipeline, from an untrusted file to a normalized place
geometry. No UI and no map — `src/lib/geo/upload/`, callable from a test, and nothing in `src/`
imports it yet, so the static critical path is unchanged at 108.6 KB gzip. Full write-up:
`docs/upload.md`.

- **Seven formats read, each behind its own dynamic `import()`** (spike verdict `docs/spikes/S4.md`):
  GeoJSON (no parser), zipped shapefile (`shpjs`), KML and GPX (`@tmcw/togeojson`), FlatGeobuf
  (`flatgeobuf`), pasted WKT (hand-rolled, no dependency), and GeoPackage through DuckDB `spatial` —
  prompted once with its 22.4 MB third-party download named, lazy, and falling back to "convert to
  GeoJSON" on a decline or a blocked `extensions.duckdb.org`. The format is sniffed from the magic
  bytes before any parser loads, so a wrong extension costs nothing.
- **One normalizer for all of them** (`normalize.ts`), applying Deliverable 4's rules in order:
  10 MB (a zip: 200 entries and 50 MB uncompressed, read from the central directory **before
  extraction**, so a zip bomb is refused by the sizes it declares about itself) → parse → polygons
  only, never buffered → coordinates finite, in range and **not projected** → 50 000 vertices →
  rings closed, RFC 7946 winding, holes kept → self-intersection, reported with the crossing's
  coordinates and vertex indices → the antimeridian. "Must touch the study area" is exposed as a
  hook for the caller, which needs the release's cells.
- **A projected file is refused, never scored.** A declared CRS is authoritative (`shpjs` reprojects
  from a `.prj`; FlatGeobuf and `ST_Read` report it and do not), and only a file that declares
  nothing is judged by its magnitudes — the `.prj`-less shapefile that S4 measured returning raw
  metres in silence. The committed fixture that used to land a California rectangle in the Arctic
  now fails with a sentence naming the value.
- **Both spellings of a place crossing 180° become the same place**: a wrapped ring through the
  shared `unwrapRing()` rule, and an RFC 7946 split pair through a new `seam.ts` that fires only on
  the literal cut (a vertex at +180 _and_ one at −180) and rejoins it. Identical ring, identical
  cells on `global05` and `usa05`.
- **GPX turns out to have no polygon type** — S4 never exercised it, and adding the fixture is what
  showed this. A closed track is read as a ring; an open one is refused by name rather than closed
  or buffered.
- **Refusals say what happened, why and what to do**, all in `messages.ts`; none says "invalid
  file", and a test drives every one of them to keep it that way.
- **A name from a file is plain text and is never escaped**: `<img src=x onerror=…>` comes back byte
  for byte, asserted as such, because the panel binds it as text and escaping would render visibly.
- Fixtures moved (`git mv`, not copied) from `spikes/4/fixtures/` to `tests/fixtures/upload/`, plus
  a plain GeoJSON, a closed-track GPX and an open-track GPX. Hostile inputs are generated in the
  test setup, never committed. `@xmldom/xmldom` added as a devDependency so KML and GPX are covered
  by fast node unit tests rather than only in a browser.

# atlas 0.8.0

`atlas-map`: the shared map module (`src/lib/map/`) the three lenses build on — one MapLibre
instance, one composed style, one `setStyle(diff:true)`. The shell now renders a real map.

- **New: `src/lib/map/`.** `map.ts` (`createMap()` — the whole S2 wiring: named imports,
  `?worker&url` + `setWorkerUrl`, `preserveDrawingBuffer`, `resize()` plus a `ResizeObserver` on the
  container, camera to/from the URL), `style.ts` (`composeStyle()` + `applyStyle()` and a DECLARED
  layer order, so a missing layer can never cascade), `camera.ts` (rounded, de-duplicated, 300 ms
  debounced, never on a programmatic move), `interaction.ts` (click → `{lngLat, cellId, zone}` using
  the RELEASE's grid; hover; `flyTo(studyArea)` — never `fitBounds`) and the pure builders
  `layers/{basemap,zones,raster,titiler}.ts`.
- **The basemap follows the theme**: navy → CARTO dark-matter, paper → positron, as raster tiles
  (one source, no style.json/sprite/TileJSON, zero added JS). Globe ⇄ mercator travels in the style.
- **The `zone_style` table is data, not code**: programarea/planarea white 1 px, ecoregion black
  3 px, subregion `#d9d9d9` 2 px dashed `[3,3]` 0.7, labels programarea white 12 px / ecoregion black
  16 px, subregion none.
- **The camera is in the URL**: `?map=lon,lat,zoom` is written with `history.replaceState`, debounced,
  and never while the app itself is moving the map.
- `pmtiles@^4.5.0` is now a dependency (the `pmtiles://` protocol the zones sources are read through).
- `docs/map.md`: the interface the three lenses may call, and how to add a source.
- **Fix, `scripts/size-budget.mjs`:** a forbidden lazy-chunk marker now has to start a token.
  Minified maplibre-gl contains `dashPositions`, which embeds `shp`, so the budget failed the moment
  maplibre entered the static graph. Measured after the fix: **391.2 KB gzip static** (budget 450) and
  **140.5 KB gzip runtime worker** (budget 150).
- **Fix, `src/shell/shell.css`:** the map container is `.stage > .map`, not `.map` — MapLibre's own
  stylesheet declares `.maplibregl-map { position: relative }` and won on equal specificity, which
  collapsed the container to 0 px tall and left a 300 px canvas on an 800 px viewport.
- `e2e/hermetic.ts`'s `routeBucket()` also routes the map's tile origins, so no spec reaches the live
  network now that every shell page mounts a map; the shell a11y gate's `color-contrast` incomplete
  triage is re-pinned (desktop 8 → 9 nodes, `imgNode` added) because axe cannot see through a canvas.

# atlas 0.7.6

`atlas-5` step 1, fix round 1: `camera.ts` copes with how extents are ACTUALLY published. Measured
over every published shard — v9 publishes 48,378 bboxes of which only **16** have `xmax > 180` while
**6,273 are written WRAPPED** (naive span > 180 deg; 5,053 over 300 deg) and 38,448 are `null`; **v7
publishes no bbox at all** (all 16,153 null). The contract's "already reduced to the minimal-span
frame" does not hold, so the plan's camera gate would have failed for thousands of taxa. The
upstream defect is atlas-1's; the lens compensates now.

- **`minimalFrame()`** applies plan D8's rule client-side: a bbox whose naive span exceeds 180 deg is
  read as wrapped and re-expressed as the complementary interval `[xmax, xmin + 360]` when that is
  narrower — `[-173.7, -16.05, 163.7, 20.2]` becomes `[163.7, -16.05, 186.3, 20.2]`, 22.6 deg
  centred on 175 E. An already-unwrapped box (`[160, 48, 210, 66]`) is untouched and a genuinely
  circumglobal one stays wide rather than framing a degenerate sliver. Longitudes are still never
  NORMALIZED.
- **The fallback chain ends somewhere real**: input extent -> merged extent -> the supplied
  ecoregion extent -> the release's study-area view (`boot.study_areas[FULL]`, read by
  `studyAreaView()`), so a v7 species frames US waters instead of the globe. `Camera` is therefore a
  union of a bounds camera and a centre/zoom camera.
- **The gate the plan asked for, over real data**: `tests/fixtures/species/v9/wide-bboxes.json` is 50
  real v9 extents with naive spans over 180 deg (every 125th of the 6,273, with provenance). Framed
  naively 48 of the 50 span >= 200 deg; after `minimalFrame()` the widest is 179.5 deg and all 50
  centres lie inside the model's own longitudes.
