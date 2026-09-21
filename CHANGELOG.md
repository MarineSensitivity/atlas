# atlas 0.7.6

`atlas-2` fix round 2: the three gate defects left after 0.7.5. All three are gates that could fail
for the wrong reason, or not fail at all — no app behaviour changes.

- **Perf tests no longer time out under load.** `tests/perf.ts` gains `PERF_TIMEOUT_MS` (60 s),
  passed as the vitest timeout by every perf test: sampling N times needs N times the headroom, and
  the default 5 s was never chosen with that in mind — the GAA case died with
  `Test timed out in 5000ms` while its own measurement sat inside its 2 s budget. `bestOfN` also
  stops as soon as one sample comes in under the budget, so a healthy implementation pays for one
  run rather than five; only a genuinely slow one pays for all N, which is exactly when the extra
  samples are worth it. The scaling RATIO is unchanged and still carries the weight.
- **The `createWorker(` / `coi` / `getJsDelivrBundles(` scan is app-wide.** It covered
  `src/lib/engine` only, so a rogue call in `src/lib/raster/`, `src/lens/` or `src/places/` — the
  likeliest places for one — was invisible. It now scans all of `src/**` plus the inline scripts of
  `index.html`, `report.html` and `gallery.html`; `spikes/**` (S1's harnesses exercise the helper on
  purpose) and `tests/**` stay exempt. A new test guards the GATE's own scope, so it cannot narrow
  back silently.
- **The plain-lock seeded-fault demo runs on chromium and firefox only.** Under load WebKit tears
  the browser context down around the deliberately never-resolving `evaluate`, and the spec dies
  with "Target page, context or browser has been closed". Counting that as "the hang" would be
  unsound — a closing context is also what a crash looks like — and a demonstration whose red does
  not mean one specific thing is worth nothing. The rule under test is a browser API this app does
  not implement, and `S1.md` already measured the same hang on all three engines. **The real OPFS
  specs still run on all three engines, unchanged.**
- `docs/engine.md`: a note for whoever wires the store that `openTableStoreBackend` needs
  `restrictedVersions` from `versions.json`, or the "restricted first" eviction step never fires.

# atlas 0.7.5

`atlas-2` phase review, fix round 1: the nine rulings. Two of them are user-visible bugs on the live
site; the rest close gates that could not fail.

- **The live `versions.json` was unreadable, so only `latest.txt`'s release could render.** The
  published file is `{"versions":[…]}`; both copies of the access gate accepted a bare array only,
  so the real registry fell to `registry-unreadable` — public v1–v6 were unreachable and the preview
  host could not open v7b/v8/v9. It failed closed, so nothing leaked. `normalizeRegistry()` now
  accepts **both** shapes in `src/lib/release/access.ts` and in `index.html`'s inline early-fetch
  script; anything else (`{"versions":"x"}`, `{"versions":null}`, `{}`) stays unreadable. The live
  body is in the shared case table verbatim, so both copies are driven through it.
- **In preview mode `session.ver` now wins over the path and `?ver=` in the inline script too**,
  matching `resolveVer.ts`'s `candidateVer()` (they disagreed: `/atlas/?ver=v8` with a session
  naming v9 resolved to v8 inline, v9 in the module). It still goes through the same access check —
  a session cannot name a release the registry does not list. `session.json` is now read whenever
  the PATH names a version (the preview host's URL shape); the public host's own `/atlas/` shape
  still never waits on it unless a restricted release is in play.
- **Objects with no published digest are keyed on `boot.built_at` + path**, not the release label.
  `tables/model.parquet`, every `serve/cell_model` tile and `taxonomy` (where `boot.tables` omits
  it) were cached in OPFS for the life of the release — a corrected re-publish was served stale
  indefinitely. A boot with no `built_at` fails closed and is not cached at all.
- **Eviction order corrected**: restricted other-release files first (plan D6), then the remaining
  other releases LRU, then the current release's cold tiles. The plan's literal "LRU tiles first"
  dropped a hot tile of the release on screen before a cold release nobody had opened.
- **`purgeRestricted()` keeps the registry row of a file whose delete FAILED** (a restricted file
  still open in another tab would have lingered on disk, unlisted and invisible to the next Sign
  out), purges each file independently, and its registry clear is now asserted.
- **Timing gates are load-proof.** `tests/perf.ts` adds best-of-N and a scaling RATIO; the coverage
  gates and the OPFS second-tab gate use them, and the counts stay hard assertions. The single
  wall-clock sample they replaced red-lighted on scheduler noise (125 ms idle, 2,282 ms under load
  with the code untouched) on a required check.
- New gates: `tests/engine/noCreateWorker.wiring.test.ts` (the measured "never duckdb-wasm's
  blob-worker helper, never a `coi` bundle" rule had none), and `tests/geo/rmod.test.ts` — R-sourced
  fixtures (the exact `Rscript -e` is in the file) pinning all three of `rmod()`'s claims: floor
  division, the guard pass (`-1e-17 %% 360` is 0, not 360), and `((x%y)+y)%y` being a different
  function (38.800000000000011 where R gives 38.8).
- `CLAUDE.md`: the analytics-privacy spec's path was wrong (it lives under
  `e2e/fixtures/analytics-privacy/privacy.spec.ts`).

# atlas 0.7.4

`atlas-3` closing review, fix round 1 (of 2): four small fixes on `src/lib/ui/{Panel,Sheet}.svelte`
and `src/shell/Shell.svelte`, each with a test and a seeded fault.

- **SC 1.4.1** (`Panel.svelte`, `Sheet.svelte`): `.panel-controls button[aria-pressed="true"],
.panel-controls button[aria-expanded="true"]` painted the collapse disclosure as the selected
  detent permanently -- Panel's collapse button always carries `aria-expanded="true"`, and Sheet's
  is true at both `half` and `full` (only false at `peek`), so it lit up alongside whichever detent
  was actually active. Dropped the `aria-expanded="true"]` selector from both files.
  `e2e/shell.a11y.spec.ts` ("panel/sheet size controls: visual state matches the actual detent")
  asserts, at both 1280 and 390, that with the panel at Half the collapse control and "Full" share
  the same computed background/border-color and "Half" differs from both.
- **SC 2.1.4, Level A** (`src/shell/Shell.svelte`): removed the global, no-modifier `/` keydown
  that stole focus to search from anywhere on the page -- not in spec.md or the plan, and exactly
  the kind of single-character shortcut SC 2.1.4 requires be removable/remappable/focus-scoped.
  Removed the listener, `searchInputRef`, the `aria-keyshortcuts`-free `/` hint span in both
  `Shell.svelte` and `index.html`'s skeleton, and its now-orphaned `.kbd` CSS rule.
  `e2e/shell.a11y.spec.ts` asserts pressing `/` moves focus neither from a topbar control nor from
  a rail tool; `e2e/shell.url-state.spec.ts`'s interaction walk now clicks the search field instead
  of relying on the removed shortcut.
- **`src/shell/Shell.svelte`**: the version chip carried `aria-haspopup="dialog"` but opens no
  dialog (the picker ships in atlas-4) -- a false affordance. Removed the attribute; the
  click announcement is unchanged. Asserted by a new `aria-haspopup`-absence test.
- **Gate hole, `e2e/gallery.spec.ts` (+ `e2e/shell.a11y.spec.ts`)**: added a 320x800 `phoneNarrow`
  viewport to the gallery's screenshot/axe matrix (new baseline screenshots). More importantly,
  `INCOMPLETE_ALLOWLIST` exempted axe's `color-contrast` "incomplete" findings by rule id alone, so
  any FUTURE unrelated color-contrast defect would inherit the exemption silently. Replaced with
  `e2e/hermetic.ts`'s new `assertColorContrastIncompletePinned()`: a node-count ceiling per
  viewport (measured today: gallery phone/desktop 16, phoneNarrow 20; shell phone 5, desktop 8) and
  a closed set of the axe "cannot determine" reason keys actually observed (`bgOverlap`,
  `pseudoContent`, and -- new at 320px -- `elmPartiallyObscured`; the shell only ever cites
  `pseudoContent`). `shell.a11y.spec.ts`'s own axe test previously destructured only `violations`,
  ignoring `incomplete` outright; it now uses the same pinned check.

# atlas 0.7.3

`atlas-2` step 4: the **OPFS `TableStore`** (plan D3 tier 2), behind the interface `memoryStore.ts`
already implements, plus `docs/spikes/S1.md`'s persistence spec promoted from the spike harness to
the real store. No UI and no app wiring yet — every module is importable and tested.

- **`src/lib/engine/store/opfsBackend.ts`** — one entry point, `openTableStoreBackend()`, returning
  the `createDb`/`store` callbacks `Engine` takes. File
  `opfs://atlas/{ver}.s{schema}.d{duckdb}.duckdb`; stale-suffix files for the same release deleted
  at boot; the Web Lock (`atlas-opfs-{ver}`, always `{ ifAvailable: true }`) held for the handle's
  whole lifetime and released on close — and by the browser on an abrupt tab close.
  `_meta(name, digest, bytes, last_used)` is read on a short-lived connection at session start and
  reconciled against `boot.tables[*].digest`: a table whose digest moved is dropped, so exactly
  that table re-materializes. `CHECKPOINT` after every write and on `visibilitychange → hidden`.
- **The tab without the lock runs on the memory store, transparently** — no event, no error, and it
  never opens the OPFS file at all. It takes over on a later page load once the lock is free.
- **Every OPFS failure falls back to memory for the session** and emits `opfs_fallback{reason}`
  through an **injected** sink (this tier does not import `analytics/`). A failure at open — a
  corrupted file, a revoked handle, a quota error — closes the handle, deletes the file _and its
  WAL_, releases the lock and continues on a fresh in-memory DuckDB. With storage denied nothing
  user-visible changes.
- **Budget `min(300 MB, 20 % of navigator.storage.estimate().quota)` across releases**, evicting
  least-recently-used `cell_tile`/`cell_model_tile` tables first and then whole stale versions'
  files. The small whole-object tables are never evicted. A `localStorage` registry carries other
  releases' sizes and last use so the budget can span versions without opening their files.
- **New exported functions, no UI:** `keepDataOnDevice()` / `setKeepDataOnDevice()` +
  `KEEP_DATA_KEY` ("keep data on this device", default on; off means memory only _and_ existing
  files deleted), `purgeRestricted(versions)` for the preview host's Sign out (deletes only the
  named releases' files), and `purgeAllStoredData()`.
- **`TableStore` gains `touch(name)`**, and `EngineOptions.store` gains a second `RawSql` argument
  (a store's own DDL must not re-enter `Engine`'s public promise chain).
- New gate `npm run e2e:opfs` (`tests/fixtures/opfs-e2e/`, port 4451, chromium + firefox + webkit,
  a real persistent profile, `extensions.duckdb.org` blocked throughout) and its committed seeded
  faults. `docs/engine.md` gains the measured fallback matrix, which **corrects `S1.md` on WebKit**.

Three bugs this step found and fixed, each with a named regression test:

- **`MemoryTableStore` recorded every table as 0 bytes.** `registerFileBuffer` _transfers_ the
  buffer, so reading `byteLength` after the call sees a detached array. Invisible against a stub,
  wrong in every real browser — and it would have made the new LRU budget a no-op.
- **A cache hit never counted as a use.** `Engine#load` short-circuits on `has(name, digest)`, so
  `last_used` only ever moved on a registration and the LRU would have evicted the hottest tile.
- **A failed open leaked its worker,** so the file's sync access handle was never released and the
  corrupted-file "self-heal" deleted nothing.

# atlas 0.7.2

`atlas-3` step 3 (the shell wired into `index.html`) and its fix round 1, merged into main after
`atlas-2` step 3b and `atlas-3` step 4's accessibility round (both below, at 0.7.0/0.7.1) had
already landed independently.

`atlas-3` step 3, fix round 2 (integration, after the merge above): the accessibility round changed
components under this step without either side knowing about the other, so three things needed
reconciling once both landed on the same branch.

- **`src/shell/Shell.svelte`**: the round-1 "TEMPORARY SHIM" (a local `announce()` + its own live
  region, added because `src/lib/ui/announcer.ts` didn't exist yet on this branch) is gone. The
  shell now mounts the real `<Announcer />` once and calls the real `announce()` from
  `src/lib/ui/announcer.ts`; `src/lib/ui/touch-targets.css` is imported once at the app root
  alongside `tokens.css`/`fonts.css`. `e2e/shell.a11y.spec.ts` asserts exactly one
  `[aria-live]`/`role="status"` node exists, before and after a full interaction walk (seeded
  fault: leaving the old shim's `<div>` in place alongside `<Announcer />` turns this red).
- **`src/shell/shell.css`**: the accessibility round's own component changes reopened the
  geometry-equality gate. `touch-targets.css`'s `button.chip{min-width:24px}` ties the version
  chip's own `.chip{min-width:84px}` on specificity and was winning on source order, collapsing the
  chip back to content width — requalified to `button.chip`. `Panel`/`About`'s new
  `width:100%;max-width:...` (for 320 px reflow) need a definite width from their absolutely
  positioned wrapper to resolve against; without one the shrink-to-fit algorithm was bottoming out
  on the panel/about body text's intrinsic width instead. Gave `.panel-region`/`.about-region` an
  explicit `width`.
- **320 px overflow** (the a11y round's known gap): two real bugs, both now fixed in `shell.css`
  only (no `src/lib/ui` component touched). `.app`'s single implicit grid column had no minimum
  size cap, so at 320 px its "auto-minimum" fell back to the topbar's max-content width and the
  track (and `.topbar` stretched to it) silently grew past the viewport; `.app`'s own
  `overflow: hidden` then clipped the excess without ever tripping `scrollWidth > clientWidth`, so
  a plain overflow check missed it even though the theme toggle was genuinely clipped off-screen.
  Fixed with `grid-template-columns: minmax(0, 1fr)`. Separately, even with that fixed, the
  topbar's own default gap and padding left the mark, version chip, lens switch and theme toggle
  (nothing else is hidden at this width; every one is load-bearing) no room to fit in 320 px; a new
  `@media (max-width: 380px)` rule tightens `.topbar`'s own gap/padding (never a control's content)
  to reclaim it. `scripts/verify.mjs`'s `VIEWPORTS` gains a 320×800 entry, and a new
  `e2e/shell.a11y.spec.ts` layout suite imports `assertLayout`/`VIEWPORTS` straight from
  `verify.mjs` (both themes × all three viewports) so the two can never drift.

`atlas-3` step 3, fix round 1: the CLS and "no theme flash" gates from the initial shell could not
actually fail (confirmed: an 8 px skeleton offset and the theme-setting line replaced with
`void theme;` both left every existing shell spec green). Replaced/added the real gates, which then
caught four genuine bugs the vacuous versions had let through.

- **`e2e/shell.cls.spec.ts`** is now a GEOMETRY-EQUALITY gate: with the app bundle route-aborted
  (`blockAppBundle`, new in `e2e/hermetic.ts`), it captures the bounding box of every keyed
  skeleton element and compares it, within 0.5 px, to the same element once real hydration
  completes — the actual claim this step makes, which the Layout Instability API cannot observe
  (it only scores nodes that persist across frames; `src/main.ts`'s `replaceChildren()` + `mount()`
  removes and recreates every one of them). The old PerformanceObserver check is kept as a
  secondary assertion (it still catches a font-swap shift on nodes that DO persist post-hydration).
  Found and fixed by writing this gate:
  - `src/shell/shell.css`'s bare `.icon{width:20px;height:20px}` collided with
    `src/lib/ui/Icon.svelte`'s own literal `class="icon"` and silently forced EVERY hydrated icon
    to 20×20 regardless of its `size` prop (14/16/18) — a real visual bug, not just a test gap.
    Renamed to `.sk-icon-16`/`.sk-icon-tool`, sized per real icon.
  - The skeleton's Share/Report/Help/theme buttons were wrapped in an extra `<span>` not present
    in `Shell.svelte`, changing how `.topbar`'s own `gap` distributed and shifting everything
    after it by 8 px.
  - A bare `<p>` (the panel/sheet body text) carries a UA `margin-block: 1em` the skeleton's
    placeholder never had; added a global `p { margin: 0 }` reset.
  - The skeleton's phone panel header kept the desktop `Panel`'s 116px absolute-control
    reservation; `Sheet.svelte`'s real header uses plain flex + `margin-left: auto` instead and
    needs none of it.
  - The skeleton's phone panel had a full 1px border; `Sheet.svelte`'s real `.sheet` has only
    `border-top`.
- **`e2e/shell.theme-flash.spec.ts`** (new): with the app bundle blocked, asserts `data-theme` and
  the painted background for every `?theme=`/`prefers-color-scheme` combination — the only way to
  observe the pre-paint script before `Shell.svelte`'s own `$effect` could paper over a broken one.
- **Budget relaxed** (plan D13, owner: "we don't need to be so tight on the 350 KB budget"): the
  static critical path budget is now **450 KB gzip** (`CRITICAL_BUDGET_BYTES`,
  `scripts/size-budget-core.mjs`), up from 350; runtime workers stay at 150 KB gzip. The
  self-hosted brand fonts stay wired exactly as first shipped.

`atlas-3` step 3 (initial): the shell wired into `index.html`. A static skeleton (top bar, five-tool rail,
one floating panel frame, the phone bottom bar/sheet) paints as inlined critical CSS before any
bundle loads or parses, then `src/main.ts` hydrates it with the real components — geometrically
IDENTICAL to the skeleton, measured at CLS = 0 (desktop 1280×800 and phone 390×844, both themes).

- **`index.html`**: the inlined `<style>` block is now `@import "./src/shell/shell.css"` (which
  itself `@import`s `tokens.css` and `fonts.css`) — Vite's own CSS pipeline resolves and inlines the
  real, byte-verified token values at build/dev time, so no token value is ever hand-typed into the
  page (`scripts/check-inlined-tokens.mjs` proves the two stay equal after every build). A pre-paint
  script sets `data-theme` from `?theme=`/`prefers-color-scheme` through the exact rule
  `src/lib/state/types.ts`'s `resolveTheme` uses (falling back to `navy`), reading and writing
  nothing else — there is no theme flash on first paint.
- **`src/shell/Shell.svelte`** (new): hydrates the skeleton with the real `Rail`, `Panel`/`Sheet`,
  `Segmented`, `About` and `VersionBadge` components. The lens switch, the theme toggle and the `/`
  search shortcut all read/write view state ONLY through `src/lib/state` (`history.replaceState`,
  never `pushState`); the Flower rail tool fades in place (`aria-disabled`, never removed) in the
  Species lens; the on-map About card carries the seal behind `VITE_SEAL`/`VITE_AGENCY`
  (`.env.example` documents both, plus `VITE_SEAL_URL`; CI's build step sets `VITE_SEAL=1`,
  `VITE_AGENCY=MMA` per the owner's approval).
- **`src/shell/tools.ts`** (new): the rail's five-tool data (order, labels, per-lens body text),
  extracted so "Flower fades only in the Species lens, in its own third slot" is a plain unit test,
  not something only provable by reading the component.
- Preloads the one display-face weight (Jost Bold) the first frame needs, plus both Carlito
  (body-face) weights — a measured CLS regression (a font swap on a platform whose `sans-serif`
  fallback isn't metrically Arial-identical) is what the second preload actually fixes.
- New gates: `scripts/check-inlined-tokens.mjs` (+ core/test) proves the inlined critical CSS never
  drifts from `tokens.css`; `scripts/check-hex-literals.mjs` now also scans `index.html` and
  `src/shell/shell.css`; `scripts/verify.mjs`'s state matrix covers the real shell (default, both
  explicit themes, the Species lens) at both viewports; new Playwright specs
  (`e2e/shell.cls.spec.ts`, `e2e/shell.a11y.spec.ts`, `e2e/shell.url-state.spec.ts`) and
  `tests/shell/*` cover CLS, axe, keyboard reach, roving tabindex, the URL-is-the-view contract and
  a `pushState` source-scan guard.

# atlas 0.7.1

`atlas-3` step 4, fix round 1: a manual (Opus) accessibility walk of the gallery by keyboard and
accessibility tree found 13 defects axe's serious/critical filter missed (Section 508 requires
fixing these before the lenses build on these components). All 13 are fixed:

- **`HexButton`/`Pill`/`Modal`/`Accordion`/`Popover`/`About`**: tooltip/panel ids are per-instance
  (`uid()`), never derived from a label/prop that can repeat — fixes duplicate ids across multiple
  same-labelled instances (SC 4.1.2). `HexButton`/`Pill` tooltips are hoverable and Esc-dismissible
  without moving focus (SC 1.4.13). `Accordion`'s body and `Popover`'s floating content are now
  always rendered (toggled via `hidden`) instead of removed from the DOM, so their
  `aria-controls`/`aria-describedby` targets always exist.
- **`HexButton`/`Switch`/`Segmented`/`Chip`/`Legend`**: a `forced-colors: active` fallback keeps
  idle/pressed/inactive and selected/unselected states visually distinct under Windows High
  Contrast (SC 1.4.1/1.4.11); `Legend`'s gradient itself is preserved (`forced-color-adjust: none`).
- **`Flower`/`Treemap`**: the SVG root is `role="group"` (never `role="img"`, which hid every
  child); each petal/cell keeps its own `role="img"` + computed name (SC 1.1.1/4.1.2). `Flower`'s
  text summary is now built from the petals actually drawn, not the raw component count (fixes a
  summary/chart count mismatch); `computeFlowerGeometry()` now refuses two components that resolve
  to the same category.
- **`DataTable`**: takes a required `label` (the grid's accessible name); `aria-rowcount`/
  `aria-rowindex` now account for both header rows (SC 1.3.1/4.1.2). A clipped cell's full value is
  reachable via a hover/focus overlay (SC 1.4.4/1.4.12), and the roving-tabindex "active" cell is
  now visually distinct from a real `:focus-visible` ring.
- **`Sheet`**: Esc-to-peek moves focus to its own collapse control, never `<body>` (SC 2.4.3).
- **`Panel`/`About`**: no longer force a fixed width past 320px viewports (SC 1.4.10); `Panel`'s
  Escape handler now defers to a nested open layer (a `Popover`, a `Select`) that already handled
  the same keydown.
- **`Toast`**: auto-dismiss pauses on hover/focus and resumes with the time actually left (SC
  2.2.1).
- **`src/lib/ui/announcer.ts` + `Announcer.svelte`**: the ONE shared polite live region — every
  component calls `announce(text)` instead of rendering its own `role="status"` (SC 4.1.3); six
  concurrent regions collapse to one.
- **`src/lib/ui/touch-targets.css`**: a shared 24px (any pointer) / 44px (coarse pointer) floor for
  every previously-undersized control (SC 2.5.8).
- Fixed a real WCAG contrast failure found while triaging axe's `incomplete` findings: paper
  theme's `--cat-bird` measured 4.4:1 against white label text (below 4.5:1 AA); darkened to
  `#166a99`.
- `e2e/gallery.spec.ts`'s axe check now also fails on any untriaged `incomplete` finding, not just
  serious/critical violations.

# atlas 0.7.0

`atlas-2` step 3b (Opus half): the `sql/*.sql` twins of msens's scoring and species functions, the
thin TypeScript layer that runs them for a place in bounded memory, and the R-vs-SQL parity harness
that keeps the two from drifting. Nothing here is reachable from `index.html`'s static graph (the
size budget is unchanged at 11.5 KB gzip); the lenses reach it through a dynamic `import()`.

- **`sql/` — nine verbatim ports, each header naming its R twin (`file:line`) and the fixture that
  pins it.** `species_for_zone.sql` (the precomputed `app/zone_taxon.parquet` read),
  `species_for_cells.sql` (`.species_sql()`), `species_shares.sql` (`.species_shares()`, the ONE
  rule both species paths come through), `scores_for_cells.sql` (the **blended** zone method),
  `cells_in_study_area.sql` (D7b's clip), `cell_components.sql` (the click popup),
  `composition.sql` (the treemap's taxonomy join), and `cell_model_key.sql` / `cell_model_seq.sql`
  — the `cell_model` join chosen by `boot.id_field`, two files rather than a hard-coded column,
  because assuming v8's `mdl_id` on v7 is a `Binder Error`, not a wrong number. Metrics are
  addressed by `metric_key` throughout (the wide cell tile carries one DOUBLE column per key);
  `value` appears in no file, and `tests/analysis/sqlTwins.test.ts` scans for it, allowing only
  `zone_value` and DuckDB's `UNPIVOT ... VALUE` keyword.
- **The blend is in the DENOMINATOR, and that is the whole gate.** `sum(coalesce(v,0)*pct)` and
  `sum(v*pct)` are the same number, so the published zone method differs from the old one only in
  dividing by the weight of every touched study-area cell (`w_all`) instead of the weight of the
  cells that have the metric (`w_present`). Both are returned — `score` and `mean_where_present` —
  so the panel gets "17.7, over 1.4 % of the place", and the parity harness's RED side reads the
  old formula off the same row.
- **`src/lib/analysis/`**: `place.ts` (`analysisGeometry()` = `normalizeForAnalysis()` then
  `decode(encode(...))` — that order, since the encoder REFUSES a wrapped ring; `placeCells()`,
  `tilesForCells()`, `batchTiles()`), `combine.ts` (the bounded-memory fold), `queries.ts` (the
  engine-agnostic orchestration the browser AND the parity harness both run), `sources.ts` (the
  browser's `Engine` plumbing), `templates.ts` (the `?raw` imports).
- **Bounded memory for big places**: `species_for_cells.sql` answers ONE batch of ≤ 8 `cell_model`
  tiles with partial sums (`Σ area·pct/100`, `Σ val·pct`, `Σ pct`), the batch's buffers are dropped,
  and `combineSpeciesPartials()` folds them — a sum and a ratio of sums, both exact under partition.
  `tests/analysis/batching.test.ts` proves batch sizes 1…64 agree with one big batch to 1e-12 over a
  37-tile, 120-model fixture, and that the answer is NOT the mean of the batches' means.
- **`TableStore.ref(name)`** (new on the interface, implemented by `MemoryTableStore`): the
  FROM-clause source of an already-registered table, so a view can span many tiles without any
  caller knowing whether MEMORY or OPFS is live. The OPFS store (Step 4) implements the same method.
- **Parity harness** (`scripts/parity/`): `fixtures.R` calls msens through `devtools::load_all()` on
  the `atlas-contract` worktree, read-only, and writes `tests/fixtures/parity/{v7,v9}/*.json`;
  `run.mjs` executes the SAME `sql/*.sql` files under Node and diffs. `--base` takes a directory or
  a URL (`mirror.mjs` assembles the local stand-in for the bucket, `serve.mjs` serves it), so the
  same harness runs against S3 after the push; `--sql-dir` points it at a mutated copy, which is how
  each seeded fault is demonstrated. Gates, green on v7 AND v9: row counts equal and max|Δ| < 1e-9
  on `area_km2`, `avg_suit`, `pct_cat`, `score`; GAA traced from its outline reproduces its
  published composite within 0.5 on v9 (0.0972); and the RED side — the OLD formula must still miss
  **GEO** by ≥ 49.1448 (v9) / 58.9534 (v7) on turtle, so a silently-lost blend cannot pass.
- **`tests/fixtures/parity-e2e/`** (`npm run e2e:parity`): one of each query through the real
  DuckDB-WASM engine, chromium/firefox/webkit, with `extensions.duckdb.org` blocked, asserted
  against the same R fixtures.
- **`tests/fixtures/place_codec.json`** gains the `encode_reject` list with the
  `reject_wrapped_ring` vector msens is owed (its commit `4d99721`): the byte-level encoder refuses
  a ring that still steps 340° (code `wrapped`), while the high-level path normalizes first and
  yields the already-committed `bering` token. New sha256
  `50ad541afff2c2cd2c0d005d89f8ba230e2d19f9595ffcf1b03c233899d2897f` — msens re-copies the file.

# atlas 0.6.0

`atlas-3` step 2b: the "data half" — the three data-driven components spec.md and the parity docs
call for (`Flower`, `DataTable`, `Treemap`) and the shared category table they all read colors from.

- **`src/lib/ui/categories.ts`**: ONE table (key, label, icon, color TOKEN) for the eight species
  categories, consumed by `Flower`, `Treemap` and (later) the legend/report — colors are `--cat-*`
  custom-property NAMES from `tokens.css`, never resolved literals. `categoryFor()`/`categoryKeyFor()`
  normalize the real data's several spellings of the same category to one token — in particular the
  v8/v9 flower's "primary producer" component (`str_replace("_"," ")` of `extrisk_primary_producer`)
  and `msens::sp_cat_from_taxonomy()`'s `"primary_producer"` both resolve to the SAME `--cat-primprod`
  token as `"primprod"` itself, fixing the grey/NA petal `parity scores app.md:826-830` documents in
  the old app. An unrecognized category falls back to a distinct `NO_DATA_CATEGORY` (`--cat-nodata`),
  never silently to a real category.
- **`src/lib/ui/Flower.svelte`** (SVG polar plot of component scores), with its geometry in
  `src/lib/ui/flowerGeometry.ts` (`computeFlowerGeometry`, pure and unit-tested): EQUAL angular
  width per component regardless of score or count (7 on v7, 8 on v8/v9); centre = the mean of the
  NON-null components only (`msens::ggplot_flower()`'s `weighted.mean(..., na.rm = TRUE)` with all
  weights 1); a component with no value draws NO petal and keeps its angular slot ("absent is not
  zero" — a real score of 0 still draws a degenerate petal and stays reachable). Per-petal keyboard
  focus + tooltip, a data-table toggle whose `<table>` reads off the SAME `components`/`geometry`
  data as the SVG (so they cannot drift), and an always-available text summary. Colors come from
  `categories.ts`; no color literal anywhere in the component.
- **`src/lib/ui/DataTable.svelte`**, a virtualized/sortable/filterable grid (species/zone tables),
  with its sort/filter/window/navigation math in `src/lib/ui/dataTableCore.ts` (pure, unit-tested).
  Virtualizes: only the rows inside the scrolled viewport (plus overscan) are ever in the DOM, so
  10,000 rows scroll smoothly. Sorting is stable, numeric columns compare numerically (never as
  strings — "10" sorts after "9"), and nulls always sort last regardless of direction; per-column
  filtering matches the FORMATTED display value, not the raw one (documented and regression-tested).
  `aria-sort` on each header follows a click; keyboard cell navigation (arrow keys, Home/End,
  PageUp/PageDown) moves a roving-tabindex active cell with a visible focus ring and scrolls it into
  view. A CSV export hook (`onExport`) emits the current filtered+sorted rows; the component never
  writes a file. One polite live-region announcement on load and on filter ("1,234 rows").
- **`src/lib/ui/Treemap.svelte`** (replaces plotly's `spp_comp`, parity scores app.md §7.6), with
  its rectangle math in `src/lib/ui/treemapLayout.ts` (`squarify`, pure, unit-tested, no dependency
  on d3 at all). `d3-hierarchy` (a new EXACT-pinned dependency, `3.1.2`) builds the tree and rolls up
  values (`hierarchy(data).sum(...)`) but is reached ONLY through a dynamic `import()` inside
  `Treemap.svelte` — `tests/treemap-lazy-import.wiring.test.ts` is a SOURCE-level scan (not a
  build-output one) proving no file statically imports it: measured against a real build, that
  narrow usage (only `hierarchy()`/`.sum()`) compiles to code containing neither `"d3-hierarchy"`
  nor `"treemap"` as literal text, and Rollup inlines a static import of a module this small
  directly into the entry chunk with no separate manifest entry either — so
  `scripts/size-budget-core.mjs`'s existing content-marker scan cannot be the gate for this one
  dependency (documented in its own header). `npm run build && node scripts/size-budget.mjs`
  confirms `index.html`'s static graph is unchanged (11.5 KB gzip). Keyboard-reachable, named cells;
  category colors from `categories.ts`; a table equivalent, a text summary, and an empty state.
- **Gallery + `e2e/gallery.spec.ts` extended** for all three: one section file each
  (`Categories`, `Flower`, `DataTable`, `Treemap`), axe zero serious/critical in both themes at
  both widths (already covered by the existing full-page scan), and new keyboard/behavior
  specs — a header click sets `aria-sort` and it toggles asc → desc → none; arrow keys move the
  DataTable's roving-tabindex active cell; a numeric column sorts numerically over 10,000 rows;
  only a bounded row window is ever in the DOM; every Flower petal and Treemap cell is
  keyboard-reachable and individually named; the Flower table toggle reads off the same numbers
  as the petals. Screenshots regenerated for both themes at 390 and 1280 px.

`atlas-3` step 2a: the design-system component foundation (Svelte 5 runes, `src/lib/ui/`), the icon
map generator folded in from the stopped Haiku attempt, self-hosted fallback fonts, and
`gallery.html` as a third Vite entry. `DataTable`, `Flower` and `Treemap` are step 2b, after this
merges. Still not wired into `index.html` — the shell is step 3.

- **The icon map is generated, not typed by hand** (`scripts/build-icon-paths.mjs` ->
  `src/lib/ui/icon-paths.ts`): every MDI-backed name in `docs/design/spec.md` §6 comes from
  `@mdi/js` by export name (a wrong name throws instead of drawing a wrong picture), and the
  bespoke `flower` glyph is read from `src/lib/brand/glyphs/flower.svg`, never retyped. The
  generator is a pure function (`generateIconPathsSource`) that formats its own output with
  prettier's API, so `tests/icon-paths.test.ts` compares it to the committed file in memory —
  no shell-out, so the test can never rewrite the tracked file the way the stopped attempt's did.
  `@mdi/js` is an exact-pinned devDependency and never enters the app bundle.
- **`src/lib/brand/tokens.json`**, a deterministic export of `tokens.css`
  (`scripts/export-tokens.mjs`), resolved per theme with every `var()` reference expanded. Same
  pure-function/no-shell-out shape as the icon generator; `check-hex-literals` gets a narrow,
  named exemption for exactly this one generated file, and now also scans `src/lib/ui` and
  `src/gallery`.
- **Fonts** (`src/lib/brand/fonts.css`): Century Gothic and Calibri are `local()`-only — no font
  file for either is redistributed. Self-hosted open fallbacks: Jost for display (TeX Gyre
  Adventor's GUST renaming clause was ambiguous enough to skip; Jost's OFL reserves no name) and
  Carlito for body, both Latin-basic subset WOFF2 via fonttools/pyftsubset, `font-display: swap`
  with `size-adjust`/`ascent-override`/`descent-override`/`line-gap-override` so the swap does
  not reflow. Carlito's OFL reserves that name, so the subset file's own name table was renamed to
  "Carlito MMA Subset" (the CSS still declares `font-family: "Carlito"`). Each license kept beside
  its font. Not wired into `index.html`'s critical path yet.
- **`gallery.html`**, a third page, added as its OWN independent Vite build
  (`vite.gallery.config.ts`) rather than a third entry in `vite.config.ts` -- doing the latter first
  made Rollup share the Svelte runtime chunk between `index.html` and the gallery, growing
  `index.html`'s static graph from the committed ~11.5 KB gzip baseline to ~14.9 KB even though
  nothing in `index.html` changed. `src/gallery/App.svelte` discovers one section per component
  under `src/gallery/sections/*.svelte` with `import.meta.glob`, so later commits never edit a
  shared file to add one.
- **`src/lib/ui/Icon.svelte`**: the one component that renders `ICON_PATHS[name]`. An unknown name
  renders nothing rather than throwing (a caller typo cannot blank the page); an optional `title`
  gives the icon its own accessible name, otherwise it stays `aria-hidden` for a control that
  already has one.
- **`src/lib/ui/HexButton.svelte`**: the rail's hexagon button, all of spec.md §5.1/§5.2/§5.4's
  states -- idle, `aria-pressed` active (Gold fill on `navy`, Steel on `paper`, via
  `--fill-accent`), and inactive (`aria-disabled="true"`, NOT the `disabled` attribute, so it
  stays focusable; glyph fades to `--icon-inactive`; a tooltip explains why; clicking it
  re-announces that reason through an `onAnnounce` callback instead of doing anything else).
- **`src/lib/ui/Rail.svelte`**: hosts the tool rail's five controls with roving tabindex
  (`src/lib/ui/roving.ts`, unit-tested), `role="toolbar"` + `aria-orientation` so the SAME
  component serves the desktop vertical rail and the phone horizontal bottom bar (spec.md §5.1).
- **`src/lib/ui/Pill.svelte`**: one small control for three shapes spec.md §5.3/§5.4 both need --
  a selectable toggle (`pressed`), a disclosure (`expanded` + `controls`, what a collapsed Panel
  becomes), or disabled-with-a-reason (dashed border, strike-through, a tooltip).
- **`src/lib/ui/Panel.svelte`**: the floating panel with collapse · half · full in its upper right
  (spec.md §5.3). Collapsing swaps the panel for a `Pill` disclosure and moves focus to it;
  restoring moves focus back to control 1; `Esc` anywhere inside collapses (wired imperatively,
  not a template handler on a non-interactive element). Geometry persists per viewport size in
  `localStorage` via `src/lib/ui/panelGeometry.ts` (pure, unit-tested, storage-injectable). Its
  collapse control also carries a static `aria-pressed="false"` (matching the mockups exactly --
  it is a disclosure, not a detent, but the group's three buttons render the attribute uniformly).
- **`src/lib/ui/Sheet.svelte`**: the phone bottom sheet, three real detents (peek / half / full --
  unlike Panel, peek keeps the sheet's own header visible, so it never swaps to a Pill), a wave top
  edge, a grab handle, the same three header controls sized for touch. The scroll body carries
  `tabindex="0"` + `role="region"` (axe's `scrollable-region-focusable`, seeded and fixed in the
  mockups too). `src/lib/ui/sheetGeometry.ts` mirrors panelGeometry.ts's persistence shape.
- **`src/lib/ui/Modal.svelte`**: focus trap, Esc-closes, and focus return all come from the native
  `<dialog>` element's `showModal()`/`close()` rather than hand-rolled JS -- the platform already
  guarantees top-layer focus containment and restoring focus to whatever had it before the dialog
  opened.
- **`src/lib/ui/Accordion.svelte`**: `aria-expanded` disclosure, one chevron icon that rotates
  180deg (never swapped for a second icon).
- **`src/lib/ui/Popover.svelte`**: the `ⓘ` trigger + floating content spec.md's "Panels" section
  describes ("a two-sentence popover whose 'More' opens a modal") -- dismiss on outside click or
  Esc, focus returns to the trigger. Composing its content with a "More" button that opens a
  `Modal` is the caller's job.
- **`src/lib/ui/Segmented.svelte`**: the top bar's lens switch (`Scores | Species`), plain Tab
  order rather than roving tabindex -- spec.md §5.3 makes the same call for the panel-size group:
  two or three targets do not justify it.
- **`src/lib/ui/Select.svelte`**: a native `<select>` (full keyboard/AT support for free) with a
  decorative chevron overlay -- spec.md §6's `version` icon, named for the `v7 ▾` chip but shared
  by every select-like control.
- **`src/lib/ui/Switch.svelte`**: a generic on/off control, `role="switch"`.
- **`src/lib/ui/Chip.svelte`**: plain or interactive (a `version` chip like `v7 ▾`), optionally
  dismissible. The protection chips (spec.md §5.5) are plain instances of it --
  `src/lib/ui/protectionChip.ts` already computes the exact "MMPA · floor 20" / "MMPA · not
  applicable" text (unit-tested per statute/category, including the Leatherback regression case).
- **`src/lib/ui/Toast.svelte`**: the ONE polite live region (`role="status" aria-live="polite"`),
  queued (`src/lib/ui/toastQueue.ts`, pure, unit-tested), auto-dismissing, individually dismissible.
- **`src/lib/ui/Honeycomb.svelte`**: the loader, seven hexagons pulsing in sequence; the keyframe
  animation turns off under `prefers-reduced-motion` and the status text is always present either
  way.
- **`src/lib/ui/Legend.svelte`**: takes `LegendStop[]` (from `raster/ramps.ts`, type-only import)
  as props and renders a gradient bar + tick VALUES -- it defines no ramp of its own; a continuous
  ramp cannot meet 3:1 stop-to-stop (spec.md §8), which is why the ticks label values, not color.
- **`src/lib/ui/About.svelte`**: the collapsible, opaque on-map card (spec.md §9): the seal renders
  only when `shouldShowSeal(VITE_SEAL, VITE_AGENCY)` is true (`src/lib/ui/sealVisibility.ts`,
  unit-tested -- unset/`"0"`/any other `VITE_SEAL` value fails closed), at `--size-seal-min` (72
  CSS px) with its clear space, `loading="lazy"`, unmodified. The seal's own source URL is NOT
  published anywhere yet (see this step's report).
- **A new gallery Playwright spec** (`e2e/gallery.spec.ts`, its own `playwright.gallery.config.ts`,
  port 4401): screenshots of every section in both themes at phone (390) and desktop widths,
  committed as the baseline; axe with zero serious/critical findings across all four combinations;
  keyboard coverage (every current tab stop reachable, the rail's roving tabindex, a modal's focus
  trap and return, Esc collapsing a panel, every panel-size control's accessible name, the seal's
  visibility/size rule). Found and fixed along the way: a real Chromium `<dialog>` quirk where a
  Tab cycle briefly lands on `<body>` when the dialog has only a couple of focusable children --
  `Modal.svelte` now traps Tab explicitly at its own first/last focusable element as a
  belt-and-suspenders on top of the platform's own containment.

`atlas-3` step 1, revised after Ben's mockup review (2026-09-21). Still design-only: nothing is wired
into the app, `index.html` is untouched and `dist/` is unchanged.

- **The tool rail is five controls on every viewport** — Layers · Places · Flower · Table · Report,
  same order on the desktop rail and the phone bottom bar. Help moved out of the rail (top bar only)
  and the fish/species button is gone: the lens switch and search choose a species.
- **Layers opens the layers control**, and the flower plot has its **own bespoke glyph**
  (`src/lib/brand/glyphs/flower.svg`: a centre circle with eight petals of clearly different
  lengths). Its path is quoted in `docs/design/spec.md` for the icon-map generator, and
  `tests/glyphs.test.ts` proves the SVG, the spec and the mockups' sprites cannot drift and that the
  path is real path data.
- **Every floating panel and the phone sheet has collapse · half · full controls in its upper right**,
  with the collapse button as the `aria-expanded`/`aria-controls` disclosure, 44 px targets on touch,
  and specified focus behaviour on collapse and restore.
- **An inactive control fades in place instead of disappearing**: in the Species lens the Flower
  button greys to the new `--icon-inactive` token (≥ 3:1, gated), keeps focus, and says "Scores only".
- **The species card's protection chips** now show both statutes with "not applicable" where one does
  not apply (MMPA is for marine mammals, MBTA for birds) — a Leatherback no longer reads "MMPA · floor 20".
- **The seal is on screen**: About, the report header, and one on-map placement — a collapsible,
  opaque About/attribution card — at ≥ 72 px with clear space on a plain plate, unmodified, lazy and
  behind `VITE_SEAL`. New `--surface-seal-plate` token.
- `docs/design/spec.md` gains the exact icon map (app name → `@mdi/js` export name) the component
  build is generated from, and `tests/mockup-shell.test.ts` holds the shell's shape.

# atlas 0.3.1

Plan `atlas-2` Step 1 close-out: the master plan's **D8 addendum** (orchestrator ruling,
2026-09-21) implemented on the TypeScript side — both coverage twins read coordinates LITERALLY and
unwrapping is one explicit shared rule with its own fixtures.

- **`src/lib/geo/unwrap.ts`** (new, plain module, no svelte): `unwrapRing()` / `unwrapPolygon()`,
  the twin of `msens::unwrap_ring()` / `unwrap_polygon()`. Walking a ring, an edge stepping more
  than 180 deg of longitude carries -/+360 ONWARD; the first vertex never moves, so a ring keeps the
  frame it arrived in. Every ring is unwrapped independently — that is what keeps a hole with its
  outer ring and stops one multipolygon part dragging its neighbour across the line.
  `normalizeForAnalysis()` is the one entry point callers at an input boundary use; atlas-6's
  remaining normalizer steps (reject projected coordinates, RFC 7946 rewind, dateline-aware bbox)
  compose into it rather than into each caller. It is deliberately NOT called inside `coverage.ts`.
- **`encodeGeometry()` now REFUSES a ring that still has a > 180 deg longitude step**
  (`PlaceCodecError` code `wrapped`, message naming the vertices and `normalizeForAnalysis()`):
  `g1` only ever stores unwrapped rings, so a wrapped one must be normalized, never silently
  carried into a link as the sender's 359.8 deg complement.
- **`coverage.ts` frames a `lon360` grid's coordinates PER VERTEX**, the twin of msens
  `.frame_ring()` — `xmin + ((lon - xmin) %% 360)`, with R's floor-division modulus rather than
  `fmod` — instead of shifting the whole polygon by the turns its westernmost vertex needed. The
  two rules agree on every unwrapped fixture and differ everywhere else: on a WRAPPED box read
  literally, usa05 now answers 4 cells as R does (the whole-polygon shift answered 2,323), and a
  ring crossing usa05's own 141.10 E seam is torn open identically on both sides (3,085 cells)
  instead of vanishing. `global05` coordinates are still left alone and its COLUMNS fold modulo
  `nc`. Framing and the conversion to index space are now one loop: composing them as closures cost
  the 63,417-vertex Program Area 4.5 s against 125 ms.
- **Ten shared `normalize-*` coverage fixtures**, each carrying the wrapped ring, the unwrapped
  ring, the cells and `cells_if_read_literally`; the two antimeridian fixtures were re-adopted
  rewritten unwrapped. The loader asserts all three things per fixture, so unwrapping moving inside
  coverage cannot pass. `tests/geo/disputed.ts` and its mechanism are **deleted**: there is no
  disagreement with msens left.
- **Three of those fixtures were written here and are owed to msens** (listed under
  `owed_to_msens` in `tests/fixtures/places.sha256.json`):
  `normalize-threshold-wide-segment-global05` (a genuine 120 deg segment that must NOT unwrap) and
  `normalize-threshold-200-jump-global05` (a 200 deg raw step that MUST) pin the number 180, which
  until now no fixture in either language pinned — msens stays green with its threshold set to 90
  and to 270 — and `normalize-seam-141-usa05` pins the per-vertex frame shift.
- **`raster/ramps.ts`** imports `roundHalfEven` from `geo/round.ts`; its private copy and the TODO
  are gone. `geo/round.ts` is now the one copy of R's `round()` in this repo.

# atlas 0.3.0

Plan `atlas-2` Step 3 (Sonnet half): the DuckDB-WASM engine wrapper, the MEMORY `TableStore`, and SQL
templating. No UI wiring — `src/lib/engine/**` is reachable only via dynamic `import()`, never from
`index.html`'s static graph (the size-budget forbidden-marker scan stays green). The SQL twins
(`sql/*.sql` ports of `msens` functions), the OPFS `TableStore`, and the parity harness are the Opus
half of this step, once the R side lands; `sql/smoke_count.sql` is the one trivial, non-twin template
this half ships, to prove the templating wiring end to end.

- **`src/lib/engine/bundles.ts`**: self-hosted `mvp`/`eh` DuckDB-WASM bundles via `?url` imports
  (the measured wiring from `spikes/1/src/bundles.js`/`spikes/3/src/duckdb-setup.ts`), the worker
  constructed by hand (`new Worker(bundle.mainWorker)`, same-origin — never `duckdb.createWorker()`),
  and `DUCKDB_ENGINE_VERSION` (`v1.4.3`, the C++ engine baked into the pinned `1.32.0`, keying the
  extension mirror).
- **`src/lib/engine/engine.ts`**: the `Engine` wrapper — lazy boot (`scheduleIdleBoot()` via
  `requestIdleCallback`, or on first `load()`/`exec()`), one connection, EVERY `load()`/`exec()`
  serialized on one promise chain (`atlas-refs/"calcofi explore review.md"` lesson 2), whole-object
  `fetch` + `registerFileBuffer` with a 25 MB materialize guard (throws, never silently range-reads),
  `SET custom_extension_repository` (an absolute, `document.baseURI`-relative URL — a relative string
  resolves against the DuckDB _worker's_ own location, not the page's, and fails silently) before the
  first query, and `window.__marks` timing marks. Every failure (a boot crash, a blocked-CDN
  extension-autoload WASM `RuntimeError`, an HTTP error) normalizes to one `EngineUnavailableError`.
  Fully dependency-injectable (`createDb`/`fetchImpl`/`store`/`marksSink`) so the chain-ordering and
  the materialize guard are provable under plain Node/Vitest; the real self-hosted boot is exercised
  only by `tests/fixtures/engine-e2e`'s Playwright specs (a real `Worker`+WASM needs a real browser).
- **`src/lib/engine/store/`**: the `TableStore` interface (register by name+digest, idempotent, drop,
  list, bytes accounting) and its `MemoryTableStore` implementation, left ready for an OPFS second
  implementation (atlas-2 Step 4, Opus).
- **`src/lib/engine/sql.ts`**: `{{name}}` template substitution; every value through `lit()` (string,
  number, null, boolean, arrays) except a fixed `RAW_ALLOWLIST` (`from`, `cols`, `predicate`) that can
  only hold app-built fragments; `ident()` for the separate, strict-pattern identifier path (e.g. a
  runtime `manifest.id_field`); an unknown or unfilled placeholder throws; an unlisted RAW key throws
  immediately, whether or not the template references it.
- **`scripts/fetch-duckdb-extensions.mjs`** (`npm run duckdb:fetch-ext`): mirrors the `parquet`
  extension for both platforms (`wasm_mvp`, `wasm_eh`) into gitignored `public/duckdb-ext/`, keyed by
  the DuckDB engine version — the documented build step a real deploy must run before `vite build` so
  the mirror ships in `dist/`.
- **`docs/engine.md`**: measures what atlas-0 didn't — the `mvp` bundle flavour (2,867,304 B, vs `eh`'s
  3,045,039 B, both self-hosted and working, verified with `extensions.duckdb.org` blocked on
  chromium/firefox/webkit) and whether a cross-origin `custom_extension_repository` works (yes, subject
  to ordinary CORS — measured against a local stand-in for the bucket, since the real bucket is
  read-only for this task), plus the exact user-visible failure text per browser when the mirror is
  unset and the CDN is blocked.
- **`tests/fixtures/engine-e2e/`**: a standalone Vite+Playwright fixture booting the real engine
  against a real browser (port 4391/4392, `npm run e2e:engine`) — the required extension-mirror gate
  (both platforms × three engines, 37,067-row public parquet, CDN blocked) plus the seeded-fault specs
  (chain ordering, injection round-trip, unset mirror, cross-origin).

Fix round 1 (review):

- **The 25 MB materialize guard now refuses BEFORE the download, not after.** New
  `src/lib/engine/materialize.ts`'s `fetchWithSizeGuard()`: an over-guard `Content-Length` aborts
  the request without ever reading the body; otherwise the body is streamed and capped, aborted the
  moment the running total crosses the guard (never more than the guard plus one chunk) — catching a
  LYING `Content-Length` too, not just a missing one. Verified against a real cross-origin `fetch()`
  in a real browser that the bucket exposes `Content-Length` under CORS (`docs/engine.md`).
- **The DuckDB-WASM extension mirror is now pinned and CI-verified**, not just downloaded and
  trusted. New `scripts/duckdb-extensions.manifest.json` commits the exact byte size and sha256 of
  every mirrored file; `scripts/fetch-duckdb-extensions.mjs` verifies each download against it and
  refuses to write a mismatch; new `scripts/check-duckdb-ext.mjs` (`npm run check:duckdb-ext`)
  re-verifies the same manifest against a real `dist/duckdb-ext/` and confirms neither file is
  reachable from `index.html`'s static import graph. `.github/workflows/pages.yml`'s `checks` job
  now fetches the mirror before `vite build` and re-checks it after — a published site no longer
  ships with no mirror at all (previously an omission: CI never ran the fetch step).
- `docs/engine.md`: the published size the mirror adds (5,912,343 B, both platforms), confirmed
  outside the size budget by construction (no manifest entry for a `publicDir` copy) and by test.

# atlas 0.2.0

Plan `atlas-2` Step 2: `release/`'s production resolution pipeline and `state/`, the `Sel` object
that is the whole view (master plan D8). No UI in this phase — everything below is data and pure
functions, importable by the lenses later.

- **`src/lib/release/resolveVer.ts`**: the production version-resolution pipeline — `previewVer()`/
  `previewUser()` read `session.raw.{ver,user}` (Caddy writes `ver` from the preview host's path);
  `candidateVer()` makes `session.ver` authoritative in preview mode, ignoring the path AND `?ver=`
  outright; `resolveVer()` gates the result through the existing `decideAccess()` (access.ts,
  unchanged) so a label must both match `VERSION_RE` and exist in `versions.json`.
- **`src/lib/release/preview.ts`**: `previewSwitchUrl()` builds the `/{v}/atlas/...` preview-host URL
  (path segment replaced, query + hash kept) used both for switching release on the preview host and
  for `underReviewInfo()`'s "under review" modal data (ver, reason, preview link) on the public host;
  `sessionExpiryLatch()` raises one "session expired" signal per page load for a same-origin 401 or
  opaque redirect, never one per request.
- **`src/lib/release/manifest.ts`** / **`boot.ts`**: `manifest()`/`boot()` consume `window.__early`
  when present, falling back to a fresh fetch otherwise (`report.html` has no early-fetch script);
  validated through an injectable validator (`minimalManifestCheck`/`minimalBootCheck` structural
  checks stand in until msens ships the real JSON Schema — TODO atlas-1, skipped tests name it).
  `manifestCapability()` defaults every capability to FALSE, including when the whole block is
  missing (mirrors msens `manifest_can()` exactly; deliberately more lenient than msens's own
  publish-time `validate_manifest()`, which throws instead).
- **`src/lib/state/`** (new): one `Sel` object ⇄ URL, exactly per the atlas-2 key table. Query holds
  short scalars; the hash holds only `#pl` (the place codec, opaque here) and `#t` (report title) —
  a fragment never reaches a server or analytics. `history.replaceState` only, never `pushState`;
  every field is written only when it differs from its default (`lens`'s default depends on `sp`,
  `out`'s on `lens`); `,`/`:` are un-escaped for a readable link; unknown keys are ignored, unknown
  values clamp to the default, and parsing never throws. Legacy `mdl_key`/`mdl_seq` (→ `sp`, +`in`
  via an injectable `alias/{xx}.json`-backed lookup, not yet published), `splash=false` (→
  `tour=off`) and `er_clr` (kept, untouched) are rewritten/tolerated on read. `sel.svelte.ts` is the
  only file under `src/lib` that uses a Svelte rune — everything else in `state/` is a plain,
  Node-testable module (guarded by `tests/state/invariants.test.ts`'s repo-wide scan).
- A seeded-fault URL round-trip property test (`tests/state/roundtrip.property.test.ts`, fixed-seed
  PRNG, N=300, no new dependency) and source-scan invariant tests cover the gates that have no other
  executable form under Node (no `pushState`, the hash/query split, the svelte-import boundary,
  "preview mode has exactly one door" — no `localStorage`, no `location.host` compare anywhere under
  `src/lib/release`).

Fix round 1 (review):

- **`Sel.theme` is now tri-state** (`"light" | "dark" | "auto"`, plan atlas-3): `"auto"` is the
  default — never written to the URL — and follows `prefers-color-scheme` at render time via the new
  `resolveTheme(theme, prefersDark)` (`"navy" | "paper"`, `null`/unavailable resolves to `"navy"`).
  `theme=light` and `theme=dark` are both explicit overrides and now BOTH round-trip: previously
  `"light"` was (wrongly) treated as the constant default and silently dropped on format.
- `defaultOut`'s scores/species mapping now reads a single exported `DEFAULT_OUT_BY_LENS` table
  (`src/lib/state/types.ts`) that `parseSel` and `formatSel` both read, pinned by a test that checks
  parse and format against the same table for every `Lens`.
- Added a named, skipped test (`tests/release/inline-early-fetch.test.ts`) documenting that
  `index.html`'s inline early-fetch script does not yet prefer `session.ver` in preview mode the way
  `src/lib/release/resolveVer.ts`'s `candidateVer()` does — harmless today (the preview host's path
  always carries the same version), deliberately not wired up yet.

Design system, step 1 of phase `atlas-3` (the MMA visual language). Nothing is wired into the app
yet — `index.html` is untouched, so `dist/` and the size budget are unchanged; this is the review
surface for Ben's mockup checkpoint.

- **`src/lib/brand/tokens.css`**: the brand tokens and the only file in the repo allowed to contain a
  color literal. MMA palette (Gold, Steel Blue, Navy Blue, Crimson Red), a semantic layer for both
  themes — **`navy`** (dark, the default) and **`paper`** (light) — the 12/13/14/16/20/28 type scale,
  4 px spacing, radius, elevation, motion (zeroed under `prefers-reduced-motion`), and the data
  colors: eight CVD-safe category hues and the Spectral legend stops.
- **Contrast is a gate, not a review note.** `node scripts/contrast.mjs` reads the pairs from an
  `@contrast` block inside `tokens.css` and fails if a text pair is under 4.5:1, a non-text pair is
  under 3:1, a paired token is not opaque, or **any color token is unclassified**. 66 pairs pass in
  both themes. Gold assigned to text on `paper` turns it red (1.71:1) — asserted in
  `tests/contrast.test.ts`.
- **`node scripts/check-hex-literals.mjs`**: no hex literal outside `tokens.css` across
  `src/lib/brand` and the mockups; vendored brand marks are allowed only while they carry a
  provenance line. Motif opacity is capped at the guide's 10 %. Both have planted-fault tests.
- **Motifs** `src/lib/brand/motifs/{hex,wave}.svg` (tileable, one `currentColor` each, used as CSS
  masks so the tint is always a token) and the vendored MST mark for the top bar — the MMA seal is
  never in the top bar (it may not be shown below 0.75 in).
- **`docs/design/spec.md`** and three token-only mockups under `docs/design/mockups/`
  (desktop Scores with a Program Area selected, desktop Species with a drawn place, phone with the
  sheet at half), screenshotted in both themes into `docs/design/mockups/screenshots/`.
- **axe (WCAG 2.0/2.1 A + AA) over all six screens: 0 critical, 0 serious, 0 moderate, 0 minor.**
  New dev dependency `@axe-core/playwright` pinned at exactly `4.13.0`.

Core geometry runtime (plan phase `atlas-2`, Step 1). Plain TypeScript under `src/lib`, no Svelte
import anywhere in it, so every rule below is callable from a test — and from `scripts/parity/`
later — under plain Node.

- **`src/lib/geo/placeCodec.ts` — the `g1` place codec** (plan D8): places live in the URL hash as
  `g1.<name>.<base64url>` (delta + zigzag varints, 0x10 magic, precision 3, or 4 for a place under
  half a degree), `z.<set>.<keys>` for a published zone, or `u.<name>.<sha256_8>` when a geometry is
  too large to carry. Longitudes are stored **unwrapped**, so a Bering place runs 170...190 and no
  decoder has to guess at the antimeridian. **Every analysis runs on `decode(encode(geometry))`**
  (`roundTrip()`), so a shared link reproduces the sender's numbers exactly. `fitPlacesToUrl()`
  applies the budget ladder: silent to 2,000 characters, a "long link" note to 8,000, then
  Douglas-Peucker from 0.001 deg doubling to 0.02 deg — each rung taken only while the area moves by
  <= 1 % and every ring stays simple — and finally the `u.` form. A 30-vertex place costs 104
  characters. The shared vectors are `tests/fixtures/place_codec.json`, which msens carries
  byte-identically as `inst/fixtures/place_codec.json`.
- **`src/lib/grid/grid.ts` — both cell grids**, ported from `msens/R/grid.R`
  (`cellFromLonLat`, `cellLonLat`, `lonSpan`, `lonSpanAgg`, `bboxSpansGlobe`) plus `tileOf()` from
  `msens/R/cell_model.R`. The geometry always comes from a `boot.grid`-shaped object and the module
  contains no grid constants at all: `usa05` (3103 x 2006 from 141.10 E on a 0-360 frame) and
  `global05` (7200 x 3600 from -180) disagree about what a `cell_id` means, and a hardcoded `nc`
  is how v7 ids get painted on v8's grid.
- **`src/lib/geo/coverage.ts` — `cellsInPolygon()`**, the twin of `msens::cells_in_polygon_grid()`:
  planar in degrees, interior cells by scanline, boundary cells by clipping the polygon (outer minus
  holes) to the cell square, multipolygon parts summed and capped at 1, `pct` rounded R's way (half
  to **even**, after a 1e-9 snap so a 0.5 % sliver is not decided by float noise) and cells at 0
  dropped. Columns wrap modulo `nc` on `global05` and shift into the 141.10 frame on `usa05`.
  Measured: a 74,024-cell place in 45 ms (target: 150 ms). `cellFractions()` exposes the same cells
  with their unrounded fraction.
- **The msens fixtures are adopted, byte for byte.** Nine files written by the R twin — including
  `programarea_gaa.json`, the traced GAA Program Area (63,417 vertices, 14,238 cells) — now live in
  `tests/fixtures/places/`, and `tests/fixtures/places.sha256.json` pins each one's sha256 so a
  fixture edited in either repo is visible here. Seven reproduce exactly. The two antimeridian
  fixtures write their ring **wrapped** (`179.9 -> -179.9`), which read literally (RFC 7946, and
  plan D8's unwrapped storage) is the 359.8-degree complement of the intended box; the very same box
  written unwrapped (`179.9 -> 180.1`) reproduces the msens answer cell for cell on both grids, so
  the difference is one of input convention and neither side has been changed to hide it.
- **The 1e-9 snap in front of that rounding is now proven, not asserted.** A sweep over exact-half
  rectangles across the Gulf finds that **4,522 of 8,640 on `global05` and 4,002 of 8,640 on
  `usa05`** round the wrong way if the raw `frac * 100` is rounded as it arrives — so
  `tests/fixtures/places/knife-edge-{0p5,2p5,3p5}-global05.json` and `knife-edge-2p5-usa05.json`
  pin four of them (each records its raw value to 17 digits and the pct with and against the snap),
  and removing the snap turns all four red. The error runs both ways: the 3.5 % case rounds _down_
  to 3 unsnapped where the rule says 4.

Plan `atlas-2` Step 5: `raster/` and `analytics/`. Both are plain TypeScript modules under `src/lib`
(no svelte import, Node-testable); nothing is wired into `index.html`/`report.html` yet, so the
static graph and size budget are unchanged.

- **`src/lib/raster/tiles.ts`**: `titilerTileUrl()` builds the stock titiler `/cog/tiles` URL
  byte-for-byte (`?url=<enc>&colormap_name=<c>&rescale=<min>,<max>`), behind a `RasterSource`
  interface for a future client-side COG renderer (plan D4, spike S3, deferred). The titiler host is
  `TitilerConfig.host`, one named constant, never a literal repeated at call sites.
- **`src/lib/raster/point.ts`**: a `ValueSource` interface with a `/cog/point` implementation for
  species values ONLY — `assertSpeciesValueRequest()` throws at runtime if ever asked for a
  `"scores"`-domain value (scores/cell/zonal numbers come from Parquet, never a tile pixel).
- **`src/lib/raster/urlEncode.ts`**: `encodeUrlReserved()`, a byte-exact twin of R's
  `URLencode(x, reserved = TRUE)` (escapes `! * ' ( )`, which a bare `encodeURIComponent` leaves bare).
- **`src/lib/raster/ramps.ts`**: THE ONLY place a color ramp is defined. Reads the 11 stops per
  palette from `boot.palettes` at runtime (never hardcoded); exposes `legendStops()`, the continuous
  `colorForValue()` blend and the choropleth `choroplethBin()`
  (`clamp(roundHalfEven((v-min)/max(max-min,1e-6)*10)+1, 1, 11)`, a local half-even helper with a
  TODO to import `geo/round.ts` once merged). `tests/raster/ramps.wiring.test.ts` scans `src/` and
  fails if a second ramp/palette array is ever planted outside this file.
- **`src/lib/analytics/`**: port of `msens::ga_js` — GA4 `G-9HW6L751XG`, `content_group`
  `atlas`/`atlas-preview`, a batched Sheet beacon (`logUrl`/`VITE_LOG_URL`; unset = no-op),
  `navigator.webdriver` sessions excluded entirely from both legs. `page_location` (and the Sheet
  log's `page` column) is REBUILT from origin + path + `state/`'s own `QUERY_KEYS` allow-list —
  `location.hash` is never read, so a place's geometry and the report title can never reach
  analytics. `sanitizeParams()` additionally strips any `pl`/`t` param key at the event-payload level
  as defense in depth. Events: the union of the scores and species apps' names plus `place_draw`,
  `place_upload`, `place_share`, `report_open`, `report_export{format}`, `opfs_fallback`. Every
  browser global (navigator, document, window, storage, gtag) is injected with a guarded default via
  `env.ts`'s `hasBrowserGlobals()` — gated on `window`/`document`, not `navigator`/`fetch` alone,
  since Node itself now ships working globals for those two — so no test in this repo ever makes a
  real network call.

Fix round 1 (review, real defect): a privacy leak in `analytics/`.

- **`gtag("config", ...)` alone was not enough to keep a place's geometry / the report title out of
  GA4.** With no `send_page_view: false`, gtag.js fires its OWN automatic `page_view` whose
  `page_location` it fills in internally from the live page location — fragment included — no
  matter what this app's own events did. Fixed: every `config` call now sets
  `send_page_view: false` and carries an explicit, sanitized `page_location`/`page_title`; the app
  fires its own `page_view` event immediately after with the same sanitized fields; every
  `track()`-driven event carries them too, so nothing ever falls back to a gtag.js default.
  `page_title` is a fixed label (`"Atlas"` / `"Atlas (preview)"`, `pageLocation.ts`'s
  `buildPageTitle()`) — never the live document title.
- **New `Analytics.updateLocation(loc)`**: the state layer (owns `history.replaceState`) calls this
  after every URL change so the sanitized fields stay current across an SPA navigation without
  `analytics/` ever reading a live location itself.
- **`tests/analytics/noRawLocation.wiring.test.ts`** (new): source-scans `src/lib/analytics/**` —
  code AND comments — for the live page location's `href`/fragment fields or the document's own
  URL/location globals; zero occurrences allowed anywhere in the directory.
- **`docs/analytics.md`** (new) documents the one thing no code here can enforce: GA4's Enhanced
  Measurement "page changes based on browser history events" property setting must stay OFF for
  `G-9HW6L751XG`, plus how to verify it in the network panel.
- **`e2e/fixtures/analytics-privacy/`** (new, own scoped Playwright config, `npm run
e2e:analytics-privacy`, port 4382): a real browser, real DOM, real `location` (navigated with
  `#pl=g1.test.AAAA&t=secret` already in the URL) exercising this module's guarded defaults for the
  first time outside an injected fake — asserts no request or `gtag()` call ever carries the
  fragment's data. Root `playwright.config.ts` gained a `testIgnore: ["fixtures/**"]` so `npm run
e2e` doesn't also try (and fail) to run this fixture's spec against the main app's server.

# atlas 0.1.1

- **Restricted releases can no longer render on the public host** (plan D6). `versions.json`'s
  `access` column is now enforced: v7b, v8 and v9 are restricted, and
  `marinesensitivity.org/atlas/?ver=v9` makes **zero** requests for that release — it shows
  `latest.txt`'s public release instead and records why on `window.__early.denied`. A restricted
  release renders only where the same-origin `session.json` says `preview: true` (the preview host).
  Unknown versions, a row with no `access`, and an unreadable `versions.json` all fail closed.
- **The registry and release files are read from the bucket, absolutely**, not from the page's own
  origin: `latest.txt`, `versions.json` and `{ver}/manifest.json` now come from
  `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/`. This fixes the
  doubled-path 404 (`/v9/atlas/v9/manifest.json`) that made the preview host's version path fetch
  nothing at all. `session.json` remains the only same-origin request, and the public path no longer
  waits on it.
- New `src/lib/release/dataBase.ts` (the one place a data origin is formed; honours a validated,
  https-only `session.data` prefix on a preview session) and `src/lib/release/access.ts` (the gate),
  both unit-tested through the same case table as `index.html`'s inline early-fetch copy.

# atlas 0.1.0

Initial scaffold (plan phase `atlas-0`, Deliverables 1-5; the four de-risking spikes are a separate,
later change).

- **Project scaffold**: Svelte 5 (runes) + Vite 8 + TypeScript strict, no SvelteKit, no client
  router. Two build entries, `index.html` (map) and `report.html` (print-first report); `base: "./"`
  so the same `dist/` can run under both `/atlas/` and a version-prefixed preview path.
  ESLint (flat config) + Prettier, Vitest, Playwright (chromium/webkit/firefox) all wired up.
  `@duckdb/duckdb-wasm` and a `maplibre-gl` version are intentionally **not** added yet — those pins
  belong to spikes S1/S2.
- **`index.html` shell** that paints from static HTML + inlined critical CSS alone (brand top bar,
  tool rail, an empty panel skeleton, the four MMA hex colors as CSS variables) before any
  JavaScript runs, plus the inline early-fetch script that starts `latest.txt`, `versions.json` and
  `session.json`, then chains `{ver}/manifest.json` and `{ver}/app/boot.json`, all stashed on
  `window.__early`.
- **`src/lib/release/version.ts`** — version resolution (path beats `?ver=` beats `latest.txt`,
  `^v[0-9]+[a-z]?$`, matching `msens::atlas_resolve_ver()`) and **`src/lib/release/session.ts`** —
  preview-mode detection (a same-origin `session.json`; 404 or a network error is public, only a
  `200` with `preview: true` is preview). Both unit-tested; the inline early-fetch script mirrors
  the same logic by hand since it must run before any module import is possible.
- **CI** (`.github/workflows/pages.yml`): `npm ci`, `tsc --noEmit`, `vitest run`, `vite build`, the
  size budget and two build-time invariant checks (below) on every push and pull request; a
  separate, elevated job publishes the checked `dist/` to the `gh-pages` branch, only on push to
  `main`.
- **`scripts/size-budget.mjs`**: fails when the critical path exceeds 350 KB gzip, or when a
  lazy-only chunk (`duckdb*`, `terra-draw*`, `docx*`, `shp*`, the treemap) is reachable by a static
  import. `tests/fixtures/size-budget-static-duckdb/` is the committed fixture that proves the
  check can fail (a stub module statically imported on purpose).
- **`scripts/check-dist-session.mjs`**: fails the build if `dist/` ever contains `session.json`
  (that file must only be served by the preview host).
- **`scripts/check-relative-assets.mjs`**: fails the build on any absolute `/assets/...` URL in an
  emitted file.
- **Playwright smoke spec** (`e2e/shell.smoke.spec.ts`): the shell paints and logs zero unexpected
  console errors, on chromium, webkit and firefox. **`scripts/verify.mjs`**: skeleton state-matrix
  runner (desktop 1280×800 / phone 390×844, `assertLayout()` = no horizontal overflow, every
  `[data-control]` on screen) for later phases to grow into.
- **`CLAUDE.md`**, **`README.md`**, **`LICENSE`** (MIT, mirroring `apps`).
