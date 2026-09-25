#!/usr/bin/env node
// atlas-8 step 1: `npm run test:faults` -- the SOURCE-EDIT seeded faults, proven against a real
// throwaway checkout rather than a parallel copy inside a test file.
//
// Most of this repo's seeded faults (tests/GATES.md tallies them) already prove themselves on
// every ordinary `npm test`: a wrong implementation kept beside the right one in the SAME test
// file (tests/geo/rmod.test.ts's `noGuard`/`naive`), or a permanent fixture tree a scanner is
// pointed at (tests/fixtures/map/fitbounds-fault/). Neither needs this script.
//
// This script is for the other kind: a fault that has to be applied to the REAL exported
// function `src/` ships, not a copy, because the property under test ("the ratio gate catches an
// O(n^2) rewrite of cellsInPolygon itself", "the eviction order gate catches the literal order
// the plan's wording describes") is about that exact file. Applying it to the working tree even
// briefly would be a lie the moment two things happen at once in this shared repo, so each fault
// runs in its own `git worktree add --detach` copy under $TMPDIR, patched, tested, and discarded
// -- the working tree here never changes.
//
// Manifest: FAULTS below. Each entry names a small unified diff under tests/faults/ (generated
// once with `git diff` against a real edit, then the edit reverted -- see the patch files' own
// header comments) and the vitest invocation that must go from GREEN (unpatched HEAD) to RED
// (patched). A fault whose gate stays green with the patch applied fails this script -- "a check
// that cannot fail is not a check" (CLAUDE.md).
//
// Usage: npm run test:faults  (needs $TMPDIR exported, and a clean `git status` for HEAD to be
// meaningful -- it worktrees off HEAD, not the working tree, on purpose: see each patch's header).
// `node scripts/test-faults.mjs --only <id>` runs a single entry by its `id` field.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// R3-D2: exported so scripts/check-faults-apply.mjs can read every patch path this manifest names
// without running a single gate -- the manifest itself stays the one place a fault's patch path is
// written (never duplicated into a second list that could drift).
export const FAULTS = [
  {
    id: "coverage-quadratic-scan",
    patch: "tests/faults/coverage-quadratic-scan.patch",
    describe: "an O(n^2) all-pairs edge scan planted in cellsInPolygon's accumulate()",
    gate: ["npx", "vitest", "run", "tests/geo/coverage.test.ts", "-t", "WIDENED spread"],
  },
  {
    id: "rmod-guard-drop",
    patch: "tests/faults/rmod-guard-drop.patch",
    describe:
      "rmod()'s second (guard) pass dropped -- a tiny negative operand full-turns instead of 0",
    gate: ["npx", "vitest", "run", "tests/geo/rmod.test.ts"],
  },
  {
    id: "opfs-eviction-order",
    patch: "tests/faults/opfs-eviction-order.patch",
    describe:
      "planEviction() restored to the plan's literal 'tiles first' order (overruled by ruling 5)",
    gate: ["npx", "vitest", "run", "tests/engine/opfsPolicy.test.ts"],
  },
  {
    id: "feedback-location-href",
    patch: "tests/faults/feedback-location-href.patch",
    describe:
      "pageUrlFromLocation() ignores its argument and reads the live location.href instead " +
      "(atlas-8 Deliverable 4: leaks the hash into the 'Report a problem' link). This entry drives " +
      "the mechanical (vitest) leg; `e2e/feedback.spec.ts` goes red under the same patch too " +
      "(verified by hand -- see docs/feedback.md). It could now be a Playwright entry like the two " +
      "below, which landed after it; the vitest leg is kept because it is a second or two rather " +
      "than a minute, and the property under test is a pure function.",
    gate: ["npx", "vitest", "run", "tests/feedback/noHash.test.ts"],
  },
  {
    id: "docsurl-always-root",
    patch: "tests/faults/docsurl-always-root.patch",
    describe:
      "atlasDocsUrl() reverts to unconditionally returning DOCS_ROOT (P10: Help > Docs used to " +
      "open the book's Preface instead of the release's Atlas chapter) -- a pure function, so " +
      "this is a plain vitest gate like rmod-guard-drop above; the real-browser property (the " +
      "rendered Shell.svelte href) is covered separately by e2e/shell.chrome.spec.ts's " +
      "'P10: Help > Docs' block, proven red-first by hand against the pre-fix Shell.svelte.",
    gate: ["npx", "vitest", "run", "tests/release/docsUrl.test.ts"],
  },
  // --- atlas-8 step 3: the two accessibility faults the plan's pyramid row names ------------------
  // These are the first PLAYWRIGHT gates in this manifest. They need a real browser against a real
  // build of the PATCHED tree, so each runs on its own `PW_PORT` (playwright.config.ts honours it
  // and, when it is set, never reuses a server it did not start -- otherwise a `vite preview`
  // already answering 4331 from the UNPATCHED checkout would serve the wrong bytes and the fault
  // would "pass"). One `npm run build` per fault, ~1 minute each.
  {
    // R4 (docs/usability.md §7): renamed from "hexbutton-unnamed" -- the rail stopped using
    // HexButton.svelte as its own button shape (RailButton.svelte replaced it; HexButton stays,
    // shown only in the gallery), so the old patch (dropping HexButton's aria-label) no longer
    // touched anything the rail's own axe scan could see and would have stayed silently GREEN
    // with the fault applied -- exactly "a check that cannot fail is not a check".
    //
    // First replacement attempt (dropping ONLY `aria-label`) measured the SAME failure mode this
    // rewrite documents: RailButton now carries its label as VISIBLE TEXT (R4's whole point --
    // "meaning only in tooltips"), so the browser's own accessible-name computation falls back to
    // that text content the moment `aria-label` is absent -- the button never actually lost its
    // name, and `npm run test:faults` caught its own fault staying green. This version also hides
    // the label's text from the accessibility tree (`aria-hidden="true"` on the label span, on
    // top of the dropped `aria-label`), so the button is truly nameless, the way an icon-only
    // control with no fallback text used to be.
    id: "railbutton-unnamed",
    patch: "tests/faults/railbutton-unnamed.patch",
    describe:
      "the tool rail's RailButton loses its aria-label AND its visible label is hidden from the " +
      "accessibility tree -- an icon+label button with no accessible name at all",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/matrix.a11y.spec.ts",
      "-g",
      "shell \\(default\\) @ desktop",
      "--workers=1",
    ],
    env: { PW_PORT: "4391" },
  },
  // R4/R5 (docs/usability.md §7): the active tool's marker (`aria-current`) is the mechanical
  // proof "the active tool is marked" -- this patch drops it and must turn the new
  // e2e/shell.rail.spec.ts red on exactly the assertion that checks it, not on some unrelated
  // part of that file.
  {
    id: "railbutton-active-marker-lost",
    patch: "tests/faults/railbutton-active-marker-lost.patch",
    describe:
      "RailButton.svelte drops aria-current -- the active tool is no longer exposed to assistive tech",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.rail.spec.ts",
      "-g",
      "the active tool's marker follows the clicked tool",
      "--workers=1",
    ],
    env: { PW_PORT: "4383" },
  },
  {
    id: "modal-focus-restore",
    patch: "tests/faults/modal-focus-restore.patch",
    describe:
      "a modal opened by setting the `open` attribute instead of showModal() -- closing it restores focus to nothing",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/keyboard-walk.spec.ts",
      "-g",
      "returns focus to the version chip",
      "--workers=1",
    ],
    env: { PW_PORT: "4392" },
  },
  // atlas-8 step 3's fix round, fix list #1 (docs/accessibility-fixes.md): Modal.svelte's Esc
  // handler used to be attached via a template `onkeydown` -- Svelte 5 DELEGATES that to the app
  // root, which only runs once the native keydown has already finished bubbling through every
  // REAL (imperatively-attached) ancestor listener, including an enclosing Panel's own
  // Esc-collapses-it handler. This patch reintroduces exactly that (moves the listener back onto
  // the template's `onkeydown`, off the `onMount` `addEventListener` the fix uses instead) and
  // must turn the keyboard walk's own A11Y-1 regression test red: Esc in the coordinate dialog
  // collapses the enclosing Places panel instead of returning focus to the opener.
  {
    id: "modal-esc-delegated",
    patch: "tests/faults/modal-esc-delegated.patch",
    describe:
      "Modal's Esc handler moved back to a delegated template onkeydown -- Esc in a panel-hosted " +
      "dialog collapses the panel underneath it again (fix list #1)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/keyboard-walk.spec.ts",
      "-g",
      "A11Y-1: Esc in the coordinate dialog",
      "--workers=1",
    ],
    env: { PW_PORT: "4394" },
  },
  // the `verify` CI job's own fault (atlas-8 step 3, the A11Y-0 post-mortem). `scripts/verify.mjs`
  // imported `routeBasemapTiles` after the basemap round deleted that export; a missing NAMED
  // import from a `.ts` module resolved through this repo's bundler hook is `undefined`, not a
  // load error, so every scores state threw at its first call instead of at load -- and with
  // verify.mjs in no CI job, nothing said so for a day. This patch reintroduces exactly that
  // import and must turn `node scripts/verify.mjs` red.
  //
  // `--limit=2 --engines=chromium` is six runs (2 states x 3 viewports): enough for every one of
  // them to hit `gotoScores()` and throw, and ~40 s including the patched tree's own build, rather
  // than the 8.5 min the full chromium matrix costs. `VERIFY_BASE_URL` moves it off 4331 so it
  // starts its OWN `vite preview` instead of reusing whatever is already there (verify.mjs reuses
  // a server it finds, by design).
  {
    id: "verify-missing-export",
    patch: "tests/faults/verify-missing-export.patch",
    describe:
      "scripts/verify.mjs imports a name e2e/map-hermetic.ts no longer exports -- every scores " +
      "state throws before its first assertion (the real A11Y-0 defect, replayed)",
    gate: ["node", "scripts/verify.mjs", "--engines=chromium", "--limit=2"],
    env: { VERIFY_BASE_URL: "http://localhost:4393" },
  },
  // G-25 (docs/parity.html, atlas-8): `Sel.out` used to round-trip in the URL with nothing
  // reading it. This patch reintroduces exactly that -- `zoneUnitsWithOutline()` accepts `out`
  // but no longer consults it -- and must turn tests/map/style.test.ts's own G-25 cases red.
  // 0.10.20: the basemap that silently never painted. `composeStyle()` reads the resolved CARTO
  // style SYNCHRONOUSLY; before this round nothing told the app when that style had landed, so a
  // style.json arriving after the last reactive recompose was never read again -- the map showed
  // the data over the flat `--surface-map` colour, forever. This patch reinstates exactly that
  // (drops `basemapStyle` from Shell.svelte's own composeStyle input, back onto the non-reactive
  // cache read) and must turn the new slow-style.json gate red. Chromium only: the defect is
  // reactive-wiring, not engine timing -- it reproduces on every engine, and one is enough to
  // prove the gate can fail.
  {
    id: "basemap-not-reactive",
    patch: "tests/faults/basemap-not-reactive.patch",
    describe:
      "Shell.svelte stops passing the resolved CARTO style into composeStyle -- a slow " +
      "style.json means the basemap NEVER paints (0.10.20's real defect, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.firstpaint.spec.ts",
      "-g",
      "paints OVER the basemap even when style.json answers late",
      "--workers=1",
    ],
    env: { PW_PORT: "4395" },
  },
  {
    id: "out-outline-ignored",
    patch: "tests/faults/out-outline-ignored.patch",
    describe:
      "zoneUnitsWithOutline() stops reading `out` -- G-25's exact regression (out=none no " +
      "longer hides the zone outline), replayed against the real function",
    gate: ["npx", "vitest", "run", "tests/map/style.test.ts", "-t", "G-25"],
  },
  // 0.10.21 fix 1's own defect, replayed: the scores lens' composeStyle contribution
  // (mapExtra: raster/zones/overlays/selection/legend) used to be computed ONLY inside
  // ScoresLens.svelte's own `$effect`, written back to Shell.svelte through a `bind:mapExtra`
  // prop -- so it existed only while that PANEL body was actually mounted. `Panel.svelte` renders
  // its children only while `!geometry.collapsed` (desktop, remembered per viewport in
  // localStorage), so a collapsed desktop panel meant the score raster and its floating legend
  // never painted at all, even with the map fully visible (the owner's live 0.10.17 report). This
  // patch reintroduces exactly that shape -- Shell.svelte reads a `scoresPanelMapExtra` bucket
  // only `ScoresLens.svelte` ever writes, instead of `scoresLens.mapExtra` (the lens-level store)
  // directly -- and must turn e2e/scores.collapsed-panel.spec.ts red.
  {
    id: "scores-state-panel-bound",
    patch: "tests/faults/scores-state-panel-bound.patch",
    describe:
      "the scores lens' map inputs move back onto a bucket only the PANEL body writes -- a " +
      "collapsed desktop panel never paints the raster/legend again (0.10.17's real defect, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.collapsed-panel.spec.ts",
      "--workers=1",
    ],
    env: { PW_PORT: "4396" },
  },
  // atlas-8 review round 2 (M4): `.map-print img` used to be proven only by "is an <img> visible"
  // (report.spec.ts), which passes on the basemap alone. This patch makes `scoreColorExpression()`
  // always return `REPORT_NODATA_COLOR` -- every place, scored or not, draws the SAME flat grey --
  // and must turn the new pixel-proof (`e2e/report-hermetic.ts#mapPrintRampPixelCount`, driven from
  // `e2e/report.spec.ts`'s "map image not blank" test) red.
  {
    id: "report-map-no-score-color",
    patch: "tests/faults/report-map-no-score-color.patch",
    describe:
      "scoreColorExpression() always returns REPORT_NODATA_COLOR -- the report map's places " +
      "layer never actually colours by score (M4's real gap, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/report.spec.ts",
      "-g",
      "map image not blank",
      "--workers=1",
    ],
    env: { PW_PORT: "4397" },
  },
  // atlas-8 review round 2 (M5): both fixture themes used to route to the SAME `BASEMAP_RGB`, so a
  // theme switch could be proven only by the DECLARED style JSON's `sprite` string, never a painted
  // pixel. This patch collapses `BASEMAP_RGB_NAVY` back onto `BASEMAP_RGB` and must turn
  // `e2e/map.spec.ts`'s own theme-switch test red.
  {
    id: "map-hermetic-same-theme-color",
    patch: "tests/faults/map-hermetic-same-theme-color.patch",
    describe:
      "the navy fixture basemap colour collapses back to the paper one -- a theme switch can no " +
      "longer be told apart by a painted pixel (M5's real gap, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/map.spec.ts",
      "-g",
      "theme switch",
      "--workers=1",
    ],
    env: { PW_PORT: "4398" },
  },
  // atlas-8 review round 2 (M6): `sel=zone:*` states used to assert only the BASE zone outline
  // (`programarea_ln`, every zone's line at once), never that the ONE selected zone's own
  // highlight (`${unit}_highlight_ln`, `zoneHighlightLayer()`) actually rendered. This patch makes
  // `zoneHighlightLayer()` always return `null` and must turn `scripts/verify.mjs`'s own
  // `zoneSelectionProbe` red on a real `sel=zone:*` state, while the base outline (a DIFFERENT
  // layer, still fed by all four zones) stays green -- exactly the blind spot the review named.
  {
    id: "zone-highlight-lost",
    patch: "tests/faults/zone-highlight-lost.patch",
    describe:
      "zoneHighlightLayer() always returns null -- a selected zone's own highlight never " +
      "renders, while the base outline (every zone's line) still does (M6's real gap, replayed)",
    gate: ["node", "scripts/verify.mjs", "--engines=chromium", "--states=sel=zone:GAA proj=globe"],
    env: { VERIFY_BASE_URL: "http://localhost:4399" },
  },
  // B3 (docs/usability.md, R2-P2): pick mode could resolve a click on a Program Area's 1-px
  // BORDER but never its interior -- `zoneQueryLayerIds()` only includes a unit's `{unit}_fill`
  // layer id in a pick/click query when the unit carries a `fill` spec, and outline-only units
  // (`zoneUnitsFromBoot()`) carried none, in every spatial-unit mode. This patch reintroduces
  // exactly that (drops `queryFillFor(unit)` from every unit `zoneUnitsFromBoot()` returns) and
  // must turn e2e/places.pick.spec.ts red -- a REAL Playwright click at a polygon's centre,
  // nowhere near its border, times out the same way the assessment's own report did ("Add to
  // places" stays disabled).
  {
    id: "pick-no-query-fill",
    patch: "tests/faults/pick-no-query-fill.patch",
    describe:
      "zoneUnitsFromBoot() stops attaching an invisible query fill -- pick mode can only " +
      "resolve a click on a Program Area's 1-px border again (B3's real defect, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/places.pick.spec.ts",
      "--workers=1",
    ],
    env: { PW_PORT: "4397" },
  },
  // usability B1 (0.10.25): two place analyses on one DuckDB engine interleaved on the shared
  // `cell`/`place_cell`/`place_cell_sa` objects -- the live 0.10.21 read "200.0 % ... (1,344 of 672
  // cells)" and showed one place's scores under another's name. This patch turns
  // `src/lib/analysis/exclusive.ts` back into a pass-through (every analysis runs the moment it is
  // called, exactly the 0.10.21 shape) and must turn e2e/places.concurrency.spec.ts red.
  //
  // That spec boots a REAL DuckDB-WASM, so the patched tree needs the parquet extension mirror
  // (`duckdbExt`: copied from this checkout's `public/duckdb-ext/`, else fetched + sha-verified by
  // `scripts/fetch-duckdb-extensions.mjs` -- the CI job has no fetch step of its own). And a
  // missing mirror, or any other boot failure, would ALSO turn it red, for the wrong reason: so
  // `redMatches` requires ONE test to have passed (the engine/harness genuinely ran, not a crashed
  // webServer/build) and named concurrency tests to have failed. `--reporter=list` pins the output
  // those patterns read.
  //
  // P8b (CI run 35982505817): the ORIGINAL canary here was "solo baselines" passing -- valid when
  // this entry was written (0.10.25), but P7 (0.10.46) added `Places.svelte`'s own list-level
  // effect that auto-analyses EVERY geom place the moment it exists, alongside
  // `ResultsPanel.svelte`'s own per-selection effect for whichever place is currently selected.
  // Adding a place by coordinates auto-selects it, so BOTH effects call `computeScoreResults` for
  // the SAME just-added place -- a second, independent `exclusive()` caller that "solo baselines"
  // itself now exercises even with no deliberately forced overlap, no upload, nothing "back to
  // back" at all. Under this fault that pair genuinely races and "solo baselines" reads a doubled
  // coverage (measured: "137.5 % ... (308 of 224 cells)" against the correct "68.8 % ... (154 of
  // 224 cells)") -- so it is NO LONGER a valid "the fault broke nothing outside what it's supposed
  // to" canary; it now fails for the SAME real reason the fault exists to catch, just via a path
  // (auto-select's own double effect) this file's design never anticipated. Re-verified 3/3 runs:
  // "scores and Show analysis cells for the SAME place at once" reliably PASSES under this fault
  // (P8's own rewrite of that test resolves place A's engine round trip in full before ever
  // clicking the toggle, so by the time it clicks there is nothing left in flight to race) while
  // still requiring a real browser + a real DuckDB boot to reach that assertion at all -- so it
  // takes over "solo baselines"'s role as the crash-vs-corruption canary. "two places back to
  // back" and "an upload refused mid-analysis" both failed 3/3 runs for the genuine reason (wrong
  // numbers / a missing refusal caused by corrupted shared state), so both are required directly.
  {
    id: "places-analysis-shared-tables",
    patch: "tests/faults/places-analysis-shared-tables.patch",
    describe:
      "exclusive() becomes a pass-through -- two place analyses on one engine interleave on the " +
      "shared place_cell/cell objects again (usability B1's 200 % and swapped scores, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/places.concurrency.spec.ts",
      "--workers=1",
      "--reporter=list",
    ],
    env: { PW_PORT: "4397" },
    duckdbExt: true,
    redMatches: [
      /✓\s+\d+ \[chromium\] › e2e\/places\.concurrency\.spec\.ts:\d+:\d+ › scores and Show analysis cells for the SAME place at once/u,
      /✘\s+\d+ \[chromium\] › e2e\/places\.concurrency\.spec\.ts:\d+:\d+ › two places back to back/u,
      /✘\s+\d+ \[chromium\] › e2e\/places\.concurrency\.spec\.ts:\d+:\d+ › an upload refused mid-analysis/u,
    ],
  },
  // 0.10.22's own defect, replayed: `styleQueue.ts` settled an issued style only on `"idle"` (or
  // its 4 s fallback), which MapLibre withholds while any tile loads or the camera moves -- so the
  // species raster's style, composed a few ms after the basemap-arrival recompose, was parked
  // behind it for the whole species camera flight (the bimodal ~1 s first-paint regression in
  // e2e/species.timing.spec.ts). This patch drops the in-flight style's own `"style.load"` settle
  // and must turn the deterministic gate in e2e/species.smoke.spec.ts red (basemap tiles hung, so
  // the map never goes idle: the raster can only be released by the 4 s fallback).
  {
    id: "style-settle-on-idle",
    patch: "tests/faults/style-settle-on-idle.patch",
    describe:
      "an issued style settles only on idle/the 4 s fallback again, never on its own style.load " +
      "-- the species raster is parked behind the basemap's setStyle (0.10.20's settle cycle, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/species.smoke.spec.ts",
      "-g",
      "before the basemap's 4 s fallback could release it",
      "--workers=1",
    ],
    env: { PW_PORT: "4397" },
  },
  // M4 fix round 2 (orchestrator's own seeded fault): the FIRST report-map-no-score-color fault
  // above proved the "places layer colours by score" branch can fail; it never proved the OPACITY
  // itself can go to zero without the gate noticing -- because, before this fix, the gate's own
  // "expected" blend was computed from `PLACE_CIRCLE_OPACITY` imported from the SAME file this
  // patch edits. With opacity 0 the "expected" colour collapsed onto the pure background too (an
  // invisible circle IS the background), so the pixel count passed trivially -- proven directly:
  // this exact patch stayed GREEN against `e2e/report.spec.ts`'s "map image not blank" test before
  // `e2e/report-hermetic.ts` was changed to blend against a fixed literal
  // (`EXPECTED_PLACE_CIRCLE_OPACITY`) instead of that import. This patch (opacity 0.85 -> 0) must
  // now turn the SAME gate red.
  {
    id: "report-map-circle-invisible",
    patch: "tests/faults/report-map-circle-invisible.patch",
    describe:
      "PLACE_CIRCLE_OPACITY drops to 0 -- every place circle is fully transparent, painting " +
      "nothing over the basemap (the fault the gate's OWN expectation used to derive from, " +
      "replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/report.spec.ts",
      "-g",
      "map image not blank",
      "--workers=1",
    ],
    env: { PW_PORT: "4386" },
  },
  // atlas-8 review round 2, item M1: the click -> selection -> popup path used to live ONLY inside
  // ScoresLens.svelte (the panel body), so a click did nothing with the desktop panel collapsed or
  // the Places tool open -- the SAME class of bug 0.10.21 fixed for map inputs, one layer down.
  // This patch reinstates exactly that shape (a mount-only `$effect` in ScoresLens.svelte wiring
  // the click, and drops Shell.svelte's own dispatch to `scoresLens.handleMapClick`) and must turn
  // the new "panel collapsed" case in e2e/scores.collapsed-panel.spec.ts red.
  {
    id: "scores-click-panel-bound",
    patch: "tests/faults/scores-click-panel-bound.patch",
    describe:
      "the scores lens' click handler moves back onto a bucket only the PANEL body wires -- a " +
      "collapsed desktop panel (or the Places tool open) makes a scores click do nothing again " +
      "(review M1's real defect, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.collapsed-panel.spec.ts",
      "-g",
      "review M1",
      "--workers=1",
    ],
    env: { PW_PORT: "4400" },
  },
  // U1 (docs/usability.md §7, R1): the panel's dock/resize/maximize model. "Layout is chrome,
  // never the URL" is the load-bearing rule the round's own e2e/shell.panel.spec.ts asserts on
  // every dock/resize/maximize action (`location.search`/`hash` unchanged) -- this fault reinstates
  // exactly the regression that rule exists to catch.
  {
    id: "panel-geometry-in-url",
    patch: "tests/faults/panel-geometry-in-url.patch",
    describe:
      "Panel.svelte's persist() also writes the chosen dock into the URL (?panelDock=) -- R1's " +
      "'layout is chrome, never the URL' rule, broken",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.panel.spec.ts",
      "-g",
      "dock left: the button is pressed, and #panel-region reports it",
      "--workers=1",
    ],
    env: { PW_PORT: "4373" },
  },
  // atlas-4 fix round 2 (owner-reported defect, 2026-09-24, "Flower plot, nothing selected"): the
  // flower drew only ~3-4 of 8 real petals, root-caused to a hub disc drawn on top of full
  // pie-slice petals silently covering any component scoring <= the hub's own radius (24) --
  // NEVER a color/category mapping gap (every real category already had a defined `--cat-*`
  // token, `flowerGeometry.ts`'s header). This patch drops exactly one such mapping (categories.ts's
  // `other: "other"` SYNONYMS row), which makes `categoryFor("other")` fall back to
  // `NO_DATA_CATEGORY` (the grey "not reportable" token, label "No data") -- a DIFFERENT, adjacent
  // failure mode from the geometry bug this round actually fixed, but one `e2e/scores.flower.spec.ts`
  // is positioned to catch directly (its own "no petal's accessible name reads 'No data'" case) and
  // one this fix's real v7 fixture (which has an "Other" component) makes newly reachable.
  {
    id: "flower-petal-colour-dropped",
    patch: "tests/faults/flower-petal-colour-dropped.patch",
    describe:
      "categories.ts loses the 'other' SYNONYMS row -- the flower's real 'Other' component " +
      "silently falls back to the grey NO_DATA_CATEGORY token instead of its own color " +
      "(atlas-4 fix round 2's real v7 flower_default.FULL fixture has an Other component)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.flower.spec.ts",
      "-g",
      "no petal's accessible name reads 'No data'",
      "--workers=1",
    ],
    env: { PW_PORT: "4393" },
  },
  // U6/U2a (round 2): the load-bearing rule behind U2a's default-theme change -- DEFAULT_SEL.theme
  // reverting from "dark" to "auto" would silently undo the whole feature (a first-time visitor on
  // a light-OS system would see the paper theme again, docs/usability.md's original finding). This
  // patch is exactly that one-line revert and must turn tests/state/codec.test.ts's own "theme:
  // tri-state, default 'dark'" describe block red (5 assertions: the bare default, the garbage
  // fallback, and the now-flipped formatSel omit/write rules for "dark" vs "auto"). Proven RED
  // against this exact patch (vitest -- 5 failed, 75 passed) before being committed.
  {
    id: "theme-default-reverts-to-auto",
    patch: "tests/faults/theme-default-reverts-to-auto.patch",
    describe:
      'DEFAULT_SEL.theme reverts from "dark" to "auto" -- a first-time visitor on a light-OS ' +
      "system sees the paper theme again, undoing U2a's default-theme change",
    gate: ["npx", "vitest", "run", "tests/state/codec.test.ts"],
  },
  // S-01 (owner report, 2026-09-24, live v7): `?area=AK` rendered the DEFAULT camera. The old
  // evidence for this rule (`flyToStudyArea` unit tests) spied on `flyTo` in isolation and could
  // not fail -- `flyToStudyArea` has no caller anywhere in `src/` (an Opus 5.5 audit finding). This
  // patch reproduces the ORIGINAL defect's effect directly at the decision point
  // (`shouldFlyToArea` always answers "don't fly") and must turn the real end-to-end spec red.
  {
    id: "study-area-camera-ignored",
    patch: "tests/faults/study-area-camera-ignored.patch",
    describe:
      "camera.ts#shouldFlyToArea always returns fly:false -- sel.area never reaches the camera " +
      "again, on load or on change (the owner's original live defect, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.studyarea.spec.ts",
      "-g",
      "flies to Alaska on LOAD",
      "--workers=1",
    ],
    env: { PW_PORT: "4398" },
  },
  // R3 (round-2 plan §5 U4): `composeStyle`'s own `input.layerStack` — the Layers panel's
  // reorder/opacity/visibility choices — used to be read on arrival. This patch reinstates exactly
  // the regression the deliverable names ("the stack ignored by composeStyle"): the input is
  // accepted but never consulted, so every Layers-panel change silently does nothing and the map
  // always renders the default stack. Must turn e2e/layers.spec.ts's own reorder case red (moving
  // `basemap-land` above `data-raster` no longer changes `map.getStyle()`'s order or the probed
  // pixel).
  //
  // M4 (Opus 5.5 review): retargeted from the ORDER-only test (which used to also assert the
  // vacuous `queryRenderedFeatures >= 0` -- never able to fail, deleted) to the "promoted basemap
  // layer painting OVER the raster" pixel-probe test right after it. Verified empirically (round 2
  // ride-along), not assumed: planting this exact patch turns BOTH tests red today -- the pixel
  // probe is targeted not because the order test fails to catch the fault, but because it is the
  // stronger, harder-to-satisfy-by-coincidence proof (a viewer moving a layer up expects to SEE it
  // painted on top, not merely find its id at a different array index).
  {
    id: "layerstack-order-ignored",
    patch: "tests/faults/layerstack-order-ignored.patch",
    describe:
      "composeStyle() stops reading input.layerStack -- every Layers-panel reorder/opacity/" +
      "visibility change silently does nothing, and the map always renders the default stack " +
      "(R3's own regression, replayed)",
    // gate = the WHOLE layers spec, not one pixel-probe test: CI run 36081182035 (2026-09-25) saw
    // that single probe stay GREEN under this fault -- a pixel that reads the basemap colour also
    // when the raster never painted (software GL under xvfb), so it could not tell "promoted over
    // the raster" from "no raster". The file's reorder/opacity/visibility tests cannot all pass
    // with input.layerStack ignored, whatever painted.
    gate: ["npx", "playwright", "test", "--project=chromium", "e2e/layers.spec.ts", "--workers=1"],
    env: { PW_PORT: "4377" },
  },
  // U3 (round 2): the privacy rule behind "Send feedback"'s own checkbox -- `buildFeedbackPayload()`
  // must place the hash on `payload.url` ONLY when the reporter ticks "include my current view
  // link" (off by default). This patch makes it unconditional (see the patch's own comment) and
  // must turn e2e/feedback.spec.ts's dedicated "unticked (the default)" test red: it starts
  // finding a `#` fragment (and a `url` field at all) in the posted body it must never carry
  // (tests/feedback/payload.test.ts's own pure-function assertions go red on the same patch too --
  // this entry drives the real, built, end-to-end leg, which is what a modified/replayed request
  // would actually exploit). NOTE: an earlier version of this entry's `-g` matched the WRONG test
  // (one named "...unticked never does" that only ever exercised the TICKED case) and stayed green
  // under this exact patch -- proven by running it for real, not assumed; the spec was split into
  // two single-purpose tests specifically so this gate has a fast, focused target.
  {
    id: "feedback-hash-leak",
    patch: "tests/faults/feedback-hash-leak.patch",
    describe:
      "buildFeedbackPayload() places the hash on payload.url unconditionally -- a drawn place's " +
      "geometry rides on every submission, ticked or not (the privacy checkbox becomes a no-op)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/feedback.spec.ts",
      "-g",
      "unticked \\(the default\\)",
      "--workers=1",
    ],
    env: { PW_PORT: "4388" },
  },
  // atlas-4 fix round 3 (owner, phone/dark/Scores/Flower, cell 3092526, 2026-09-24): three faults
  // for the three bugs the round fixed, each a one-line mutation reverting exactly one piece of
  // Flower.svelte's fix (see that file's own header). All three share PW_PORT 4373 (the round's
  // assigned port) -- test-faults.mjs runs the FAULTS array sequentially (`runOne` is spawnSync,
  // never parallel), so reusing a port across entries here is the same safe pattern several
  // earlier entries already use (e.g. 4397 above, three times).
  {
    id: "flower-not-centred",
    patch: "tests/faults/flower-not-centred.patch",
    describe:
      "Flower.svelte's `.flower` loses its `margin: 0 auto` -- the figure sits flush left in a " +
      "panel wider than its 320px cap again (owner: 'Flower plot should be centered')",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.flower.spec.ts",
      "-g",
      "the flower SVG's bounding-box centre is within 2px",
      "--workers=1",
    ],
    env: { PW_PORT: "4373" },
  },
  {
    id: "flower-ua-outline-restored",
    patch: "tests/faults/flower-ua-outline-restored.patch",
    describe:
      "Flower.svelte's `.petal` loses its unconditional `outline: none` -- the browser's default " +
      "focus outline (a rectangle around the petal's BOUNDING BOX, never its annular-sector shape) " +
      "reappears on the last-tapped petal",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.flower.spec.ts",
      "-g",
      "after clicking a petal: every element in the flower computes outline-style",
      "--workers=1",
    ],
    env: { PW_PORT: "4373" },
  },
  {
    id: "flower-tap-handler-dropped",
    patch: "tests/faults/flower-tap-handler-dropped.patch",
    describe:
      "Flower.svelte's petal `<path>` loses its `onclick` handler -- a second tap/click on the " +
      "already-active petal no longer dismisses it (native focus-on-click still shows the value " +
      "the first time, so only the dismiss half of 'tapping ... again dismisses' breaks)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.flower.spec.ts",
      "-g",
      "tap shows a label with the SAME text",
      "--workers=1",
    ],
    env: { PW_PORT: "4373" },
  },
  {
    id: "legend-chip-modal-blank",
    patch: "tests/faults/legend-chip-modal-blank.patch",
    describe:
      "ScoresLegend.svelte's viewport display:none (desktop-only 'no room beside the sheet') " +
      "reinstated -- LegendChip.svelte's phone modal reuses the SAME component, so tapping the " +
      "chip opens a dialog titled 'Legend' with nothing under it",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.legend-chip.spec.ts",
      "-g",
      "scores lens.*non-blank legend",
      "--workers=1",
    ],
    env: { PW_PORT: "4371" },
  },
  {
    id: "legend-chip-fixed-offset",
    patch: "tests/faults/legend-chip-fixed-offset.patch",
    describe:
      "shell.css's .legend-chip-region drops the sheet-anchored --legend-chip-sheet-height term " +
      "-- the chip is back to a FIXED offset from the bottom regardless of the sheet's detent, " +
      "landing on the sheet's own collapse/half/full buttons when collapsed",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.legend-chip.spec.ts",
      "-g",
      "scores lens.*collapsed.*chip clears the sheet",
      "--workers=1",
    ],
    env: { PW_PORT: "4371" },
  },
  {
    id: "report-map-duplicated",
    patch: "tests/faults/report-map-duplicated.patch",
    describe:
      "report.css's screen-only `.map-print { display: none }` rule dropped -- the static " +
      "print/export snapshot sits visible right below the live interactive map again, reading " +
      "as two stacked map figures",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/report.map.spec.ts",
      "--workers=1",
    ],
    env: { PW_PORT: "4377" },
  },
  {
    id: "report-map-fitbounds-skipped",
    patch: "tests/faults/report-map-fitbounds-skipped.patch",
    describe:
      "Report.svelte#mountMap's final flyToBounds(finalBounds, ...) call is skipped -- the camera " +
      "stays at the provisional full-study-area view it flew to first (to load the zone's pmtiles " +
      "tiles) and never actually reaches the place, even though the correct target box was computed",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/report.map.spec.ts",
      "--workers=1",
    ],
    env: { PW_PORT: "4377" },
  },
  {
    id: "scores-footnote-floor-reverted",
    patch: "tests/faults/scores-footnote-floor-reverted.patch",
    describe:
      "scores.ts#COVERAGE_FOOTNOTE_FLOOR_PCT reverted from 99 to 100 -- a component at 99.9% " +
      "coverage footnotes again, and a fully-covered place with one component at 99.9% gets a " +
      "footnote it should not (the original 'footnotes almost every cell' bug, replayed)",
    gate: ["npx", "vitest", "run", "tests/lib/report/scores.test.ts"],
  },
  {
    id: "datatable-min-width-drop",
    patch: "tests/faults/datatable-min-width-drop.patch",
    describe:
      "columnWidthPx() always returns the narrow (numeric/boolean) width -- the text-column " +
      "minimum is gone, so the Zone column squeezes down to the same ~60px every numeric column gets",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.table.spec.ts",
      "-g",
      "every column's rendered width honours dataTableCore.ts's own minimum",
      "--workers=1",
    ],
    env: { PW_PORT: "4375" },
  },
  {
    id: "legend-fixed-corner",
    patch: "tests/faults/legend-fixed-corner.patch",
    describe:
      "ScoresLegend.svelte drops its dock=right override -- the legend sits back under the " +
      "default right-docked panel (D1's real defect, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.legend-position.spec.ts",
      "-g",
      "dock=right \\(the default\\)",
      "--workers=1",
    ],
    env: { PW_PORT: "4379" },
  },
  {
    id: "select-width-removed",
    patch: "tests/faults/select-width-removed.patch",
    describe:
      "Select.svelte's .select loses width:100% -- the box shrinks to its text again while the " +
      "chevron floats past its right edge (D2's real defect, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/layers.select-style.spec.ts",
      "-g",
      "the box spans to the chevron",
      "--workers=1",
    ],
    env: { PW_PORT: "4379" },
  },
  {
    id: "phone-search-button-removed",
    patch: "tests/faults/phone-search-button-removed.patch",
    describe:
      "Shell.svelte drops the phone-only search button -- no search or species picker is reachable " +
      "on the phone again (P1's real defect, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.phone-search.spec.ts",
      "-g",
      "the button exists",
      "--workers=1",
    ],
    env: { PW_PORT: "4379" },
  },
  {
    id: "places-draw-style-drops-td-layers",
    patch: "tests/faults/places-draw-style-drops-td-layers.patch",
    describe:
      "applyStyle() stops preserving terra-draw's own td-* sources/layers across a recompose -- " +
      "MapLibre's diff silently deletes them again, the same uncaught crash P7 live-reproduced",
    gate: ["npx", "vitest", "run", "tests/map/style.test.ts", "-t", "preserves a live td-"],
  },
  {
    id: "places-circle-mode-dropped",
    patch: "tests/faults/places-circle-mode-dropped.patch",
    describe:
      "draw.ts's terra-draw instance is constructed with no TerraDrawCircleMode -- the circle " +
      "tool can never finish a shape, so it never reaches writePlaces() at all",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/places.spec.ts",
      "-g",
      "the circle tool's completion path writes through the same writePlaces",
      "--workers=1",
    ],
    env: { PW_PORT: "4397" },
  },
  {
    id: "popup-no-value-cellid-title",
    patch: "tests/faults/popup-no-value-cellid-title.patch",
    describe:
      "cellPopupText() drops its no-value branch -- a click outside the scored area is back to " +
      "'Cell {id} ... {long layer title}: 0' instead of 'No scored cell here' (D3, the owner's " +
      "original Utah-click defect)",
    gate: ["npx", "vitest", "run", "tests/lens/scores/popup.test.ts"],
  },
  {
    id: "species-camera-sibling-skipped",
    patch: "tests/faults/species-camera-sibling-skipped.patch",
    describe:
      "cameraFor()'s D8 'sibling' fallback step never runs -- selecting a model whose own input " +
      "and the merged surface both publish no bbox (the walrus am|ITS-Mam-180639 case) skips the " +
      "fly-to and stays on the whole study area",
    gate: ["npx", "vitest", "run", "tests/lens/species/camera.test.ts", "-t", "D8"],
  },
  {
    id: "species-wide-range-threshold-inverted",
    patch: "tests/faults/species-wide-range-threshold-inverted.patch",
    describe:
      "R3-A1's wide-range span check flips to `span < WIDE_RANGE_SPAN_DEG` -- a COMPACT model " +
      "(under the threshold) gets wrongly narrowed to a US intersection it was never supposed to " +
      "have, while a genuinely WIDE model (over the threshold, e.g. the leatherback-shaped " +
      "130-deg fixture) keeps its whole, un-narrowed range and the 'Zoom to' toggle never appears",
    gate: ["npx", "vitest", "run", "tests/lens/species/camera.test.ts", "-t", "R3-A1"],
  },
  {
    id: "species-cogbounds-widerange-skipped",
    patch: "tests/faults/species-cogbounds-widerange-skipped.patch",
    describe:
      "D1 (Opus 5.5 eyes-on review round 2, 2026-09-25): refineCameraFromCogBounds() (the " +
      "COG-bounds last resort every v7 species reaches, since v7 publishes no bbox anywhere) " +
      "stops calling wideRangeAware()/recordWideRangeCamera() -- the leatherback (v7's default " +
      "landing species) frames its whole Pacific-spanning range again, with no 'Zoom to' toggle",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/species.camera.spec.ts",
      "-g",
      "bbox-LESS",
      "--workers=1",
    ],
    env: { PW_PORT: "4443" },
  },
  // RETIRED (P9, 0.10.49): "phone-zoom-boost-neutered" patched `PHONE_STUDY_AREA_ZOOM_BOOST` to 0,
  // proving the phone's initial camera stayed zoomed in. P9 found the deeper bug that mechanism
  // never caught: the boosted camera was still centred on `FALLBACK_FULL_STUDY_AREA`'s own
  // centroid (central North Dakota), so the "correctly zoomed-in" frame showed Canada/the Great
  // Lakes -- 0% scored cells -- with every P2 test green. `PHONE_STUDY_AREA_ZOOM_BOOST` is no
  // longer wired into Shell.svelte's phone default-view path at all (superseded by
  // `phoneDefaultCamera`/`PHONE_DEFAULT_BOUNDS`, a real bbox fit), so this fault's own patch would
  // now apply to dead code and the gate it names would stay green regardless -- "a check that
  // cannot fail is not a check" (CLAUDE.md). Replaced by "phone-default-camera-reverted" below,
  // which targets the actual mechanism and the actual bug (the WRONG ANCHOR, not merely the zoom).
  {
    id: "phone-default-camera-reverted",
    patch: "tests/faults/phone-default-camera-reverted.patch",
    describe:
      "PHONE_DEFAULT_BOUNDS reverted to a tiny box around the OLD broken FALLBACK centroid " +
      "(central North Dakota) -- the phone's default view frames Canada/the Great Lakes again, " +
      "0% scored cells (P9's own live-measured defect, reproduced)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.firstview.phone.spec.ts",
      "--workers=1",
    ],
    env: { PW_PORT: "4412" },
  },
  {
    id: "phone-default-chip-padding-dropped",
    patch: "tests/faults/phone-default-chip-padding-dropped.patch",
    describe:
      "D5 (Opus 5.5 eyes-on review round 2, 2026-09-25): the phone default fit's measured-sheet " +
      "refit drops the legend chip's own height from its padding again -- the Gulf of " +
      "Mexico/Florida Program Areas sit back under the chip at the default 'half' detent",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.firstview.phone.spec.ts",
      "-g",
      "legend chip",
      "--workers=1",
    ],
    env: { PW_PORT: "4444" },
  },
  {
    id: "bounds-narrow-longitude-skipped",
    patch: "tests/faults/bounds-narrow-longitude-skipped.patch",
    describe:
      "createTitilerBoundsSource()'s narrowLongitude() call is skipped -- a degenerate " +
      "whole-360-degree-longitude /cog/info bbox (the real walrus v7 case) is handed straight to " +
      "the camera instead of narrowed by point-probe (D8 round 2's real-build defect: /cog/bounds " +
      "404s live, /cog/info's own bounds are honest but globe-wide)",
    gate: ["npx", "vitest", "run", "tests/raster/bounds.test.ts"],
  },
  {
    id: "zoom-to-layer-bounds-fallback-skipped",
    patch: "tests/faults/zoom-to-layer-bounds-fallback-skipped.patch",
    describe:
      "zoomToLayer()'s own COG-bounds follow-up never runs -- the manual re-fit action stops at " +
      "the loose study-area view for a taxon with no published bbox anywhere, even though the " +
      "automatic species-change effect still reaches the same fallback",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/species.camera.spec.ts",
      "-g",
      "zoomToLayer",
      "--workers=1",
    ],
    env: { PW_PORT: "4391" },
  },
  {
    id: "species-popup-no-value-cellid",
    patch: "tests/faults/species-popup-no-value-cellid.patch",
    describe:
      "the species lens' popupHtml() shows 'Cell ID: ...' again for kind 'no-value' -- the D3 " +
      "fold-in regression (an internal id beside 'No scored cell here' reads as a lookup bug, not " +
      "'no data here')",
    gate: ["npx", "vitest", "run", "tests/lens/species/popup.test.ts"],
  },
  {
    id: "places-missing-tile-treated-as-error",
    patch: "tests/faults/places-missing-tile-treated-as-error.patch",
    describe:
      "isMissingTileStatus() always returns false -- a release-side gap (a tile the release " +
      "never generated, 403/404) is treated as a real failure again, so a place spanning a " +
      "missing tile rejects instead of showing a composite from the tiles that DID exist",
    gate: ["npx", "vitest", "run", "tests/analysis/missingTile.test.ts"],
  },
  {
    id: "places-zonestats-flat-composite",
    patch: "tests/faults/places-zonestats-flat-composite.patch",
    describe:
      "compositeOf() stops reading metrics[compositeMetricKey] -- a Program-Area row falls back " +
      "to the flat composite/score fields no real release publishes, so it reads 'not published' " +
      "forever even when the release DID publish a composite",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/places/zoneStats.test.ts",
      "-t",
      "REAL v7 boot.json shape",
    ],
  },
  {
    id: "places-shareurl-substring-replace",
    patch: "tests/faults/places-shareurl-substring-replace.patch",
    describe:
      "shareUrl() reverts to a plain string substring-replace of pl=<oldPl> against href -- " +
      "silently no-ops against a REAL percent-encoded address bar (several places, or a name " +
      "with a space), so 'Copy link anyway' copies the full unsimplified original link",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/places/share.test.ts",
      "-t",
      "address-bar href -- P8 item 5",
    ],
  },
  {
    id: "places-stopdraw-noop",
    patch: "tests/faults/places-stopdraw-noop.patch",
    describe:
      'stopDraw() reverts to `drawMode = drawMode ? "select" : null` -- a no-op at its own ' +
      "call site (Done only renders while drawMode is truthy), so Done never actually ends " +
      "draw mode and never disappears",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/places.spec.ts",
      "-g",
      "clicking Done actually ends draw mode",
      "--workers=1",
    ],
    env: { PW_PORT: "4402" },
  },
  // gallery axe ceilings round follow-up (CI run 35982505817): this gate originally drove
  // e2e/gallery.spec.ts's real Playwright/axe render at 320 CSS px -- but "does the min-width:0
  // fix keep .col from overflowing" bottoms out in FONT METRICS (whether `.cat-table-scroll`'s
  // unbreakable `<code>` tokens are wide enough to push `.col` past 288px), and linux Chromium's
  // `<code>` glyphs render narrower than macOS's. The fault stayed GREEN on the linux CI runner:
  // dropping `min-width: 0` there never actually pushed `.col` past its section, so axe's
  // color-contrast incomplete count never moved and the gate saw nothing wrong. `min-width: 0` is
  // a CSS DECLARATION, not a pixel measurement, so the platform-independent form of this rule is
  // a source-scan of it -- retargeted at tests/ui/categoriesOverflow.test.ts's own assertion
  // (plain regex over the `.col` rule, comments stripped first so its OWN prose describing the
  // fix can't false-match), which is deterministic on every platform because it never renders
  // anything.
  {
    id: "places-drag-duplicates",
    patch: "tests/faults/places-drag-duplicates.patch",
    describe:
      "onDrawFinish() reverts to treating every terra-draw finish as a new shape (editIndex " +
      "forced to undefined) -- dragging a just-drawn rectangle's corner appends a SECOND place " +
      "instead of updating the first (P9's own live-verified defect, reproduced)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/places.spec.ts",
      "-g",
      "dragging a drawn shape's corner",
      "--workers=1",
    ],
    env: { PW_PORT: "4412" },
  },
  {
    id: "gallery-categories-min-width-dropped",
    patch: "tests/faults/gallery-categories-min-width-dropped.patch",
    describe:
      "Categories.svelte's `.col` loses `min-width: 0` -- the flex item's default auto floor " +
      "widens it past the section again, clipping the 'primary spelling' paragraph at 320 CSS " +
      "px with no per-section way to reach it (the gallery axe ceilings round's real bug, replayed)",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/ui/categoriesOverflow.test.ts",
      "-t",
      "carries min-width: 0",
    ],
  },
  // round 2, Q4 (P8 item 8, deferred): two faults for the two things this round wired --
  // VITE_FEEDBACK_URL actually reaching the published build's `vite build` step, and the
  // preview-host Atlas link actually honouring VITE_PREVIEW_ATLAS_ROUTE rather than always
  // linking a route atlas-9 has not deployed yet.
  {
    id: "pages-feedback-url-dropped",
    patch: "tests/faults/pages-feedback-url-dropped.patch",
    describe:
      "pages.yml's `checks` job vite build step loses its `VITE_FEEDBACK_URL` line -- the " +
      "published build never picks up the Apps Script endpoint no matter what Ben sets the " +
      "repository variable to, and 'Send feedback' can never actually send",
    gate: ["npx", "vitest", "run", "tests/release/pagesEnvVars.wiring.test.ts"],
  },
  {
    id: "preview-atlas-route-gate-ignored",
    patch: "tests/faults/preview-atlas-route-gate-ignored.patch",
    describe:
      "previewAtlasRouteEnabled() ignores its flag and always returns true -- the version " +
      "picker links the preview host's `/{ver}/atlas/` route on every build, unset included, " +
      "sending a reviewer into a 404 before atlas-9 has deployed it",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.versionPicker.spec.ts",
      "-g",
      "no /atlas/ preview link renders",
      "--workers=1",
    ],
    env: { PW_PORT: "4433" },
  },
  {
    id: "scores-search-matcher-empty",
    patch: "tests/faults/scores-search-matcher-empty.patch",
    describe:
      "matchZones() reads zoneRows(boot, '') instead of the real unit -- the top-bar Scores " +
      "search matcher against Program Areas/subregions/ecoregions always finds nothing, for " +
      "any query (Q1 round, owner-reported: the search box did nothing at all)",
    gate: ["npx", "vitest", "run", "tests/lens/scores/search.test.ts"],
  },
  {
    id: "scores-search-enter-noop",
    patch: "tests/faults/scores-search-enter-noop.patch",
    describe:
      "ScoresSearch.svelte's onKeydown() Enter branch no longer calls pick(activeIndex) -- the " +
      "results list opens and highlights a match, but pressing Enter selects nothing (no sel= " +
      "write, no camera move, no popup)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.search.spec.ts",
      "-g",
      "typing 'ALA' lists the Aleutian Arc",
      "--workers=1",
    ],
    env: { PW_PORT: "4421" },
  },
  {
    id: "places-zone-results-panel-gated",
    patch: "tests/faults/places-zone-results-panel-gated.patch",
    describe:
      'Places.svelte\'s results-panel gate reverts to `kind === "geom"` only -- selecting a ' +
      "Program Area place opens no ResultsPanel again (Q3 item 1's own live-verified defect: the " +
      "row shows a real composite, but no coverage note or flower)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/places.spec.ts",
      "-g",
      "choosing a Program Area shows its results panel",
      "--workers=1",
    ],
    env: { PW_PORT: "4429" },
  },
  {
    id: "places-cells-token-guard-dropped",
    patch: "tests/faults/places-cells-token-guard-dropped.patch",
    describe:
      "toggleAnalysisCells()'s `if (token !== cellsToken) return;` guard removed -- a late " +
      "'show analysis cells' result is applied unconditionally again, painting the PREVIOUS " +
      "place's cells once the selection has moved on (item 3b, atlas-8 review round 2)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/places.spec.ts",
      "-g",
      "item 3b",
      "--workers=1",
    ],
    env: { PW_PORT: "4429" },
    duckdbExt: true,
  },
  {
    id: "geopackage-no-feature-table-check-dropped",
    patch: "tests/faults/geopackage-no-feature-table-check-dropped.patch",
    describe:
      "parseGeoPackage()'s feature-table existence check ('if (Number(...) === 0)') is neutered " +
      "to 'if (false)' -- a raster-tile/attribute-only .gpkg (no vector layer at all) falls " +
      "through to ST_Read's raw SQL error instead of the honest geopackageNoFeatureTable refusal " +
      "(Q2's own reader-returns-no-features fault)",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/geo/upload/parsers.test.ts",
      "-t",
      "refused by name, not with ST_Read's raw SQL error",
    ],
  },
  {
    id: "naming-option-ignored",
    patch: "tests/faults/naming-option-ignored.patch",
    describe:
      "normalizeParsed()'s nameProperty auto-detection (detectNameProperty()) is dropped -- " +
      "leaving nameProperty out again silently never uses a feature's own name/title/label, the " +
      "exact regression docs/upload.md's documented naming option was in since it was written " +
      "(Opus finding, Q2 fix)",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/geo/upload/rules.test.ts",
      "-t",
      "picks up a 'name' property with no nameProperty option at all",
    ],
  },
  {
    id: "analytics-logurl-unwired",
    patch: "tests/faults/analytics-logurl-unwired.patch",
    describe:
      "Shell.svelte's createAnalytics({...}) call drops its `logUrl: analyticsLogUrl()` line -- " +
      "the Sheet-log beacon goes back to a silent no-op no matter what VITE_LOG_URL is set to",
    gate: ["npx", "vitest", "run", "tests/analytics/logUrl.wiring.test.ts"],
  },
  // --- V1 (P round, 2026-09-24, Opus eyes-on review on the real 0.10.55 build): five owner-facing ---
  // UI defects every automated gate had passed. Each fault below reverts exactly the one piece of
  // its fix (see the patch's own header for the mechanism), and each shares this round's own
  // PW_PORT (4431-4436, the range this round was assigned) with the e2e spec its own fix landed in.
  {
    id: "programarea-names-fallback-dropped",
    patch: "tests/faults/programarea-names-fallback-dropped.patch",
    describe:
      "paLabel() reverts to its pre-V1 shape -- no PROGRAM_AREA_NAMES fallback, no `unit` " +
      "scoping -- so a Program Area key with no bundle-published `name` (every real release " +
      "through v9) falls straight back to the bare acronym, exactly Ben's live complaint",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/places/zoneStats.test.ts",
      "-t",
      "PROGRAM_AREA_NAMES fallback",
    ],
  },
  {
    id: "panel-maximize-cap-restored",
    patch: "tests/faults/panel-maximize-cap-restored.patch",
    describe:
      "Panel.svelte's `.panel--maximized { max-width: none }` rule is dropped -- the maximized " +
      "panel's own content box reverts to R1's 720px docked-width ceiling even though " +
      "`#panel-region` itself already spans the whole stage",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.panel.spec.ts",
      "-g",
      "drops its 720px cap when maximized",
      "--workers=1",
    ],
    env: { PW_PORT: "4431" },
  },
  {
    id: "report-table-scroll-dropped",
    patch: "tests/faults/report-table-scroll-dropped.patch",
    describe:
      "report.css's `.table-scroll` reverts to `overflow-x: visible` -- a wide Table of Scores " +
      "(many score components) blows out the whole document's width on a 390px phone again, " +
      "instead of scrolling within its own box",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/report.spec.ts",
      "-g",
      "a place with many score components does not widen the page",
      "--workers=1",
    ],
    env: { PW_PORT: "4432" },
  },
  {
    id: "species-camera-flat-padding-restored",
    patch: "tests/faults/species-camera-flat-padding-restored.patch",
    describe:
      "applyCamera() (state.svelte.ts) stops reading deps.chromePadding() -- the species " +
      "camera's model-bounds fit reverts to a flat DEFAULT_CAMERA_PADDING (40px, every edge), " +
      "blind to the phone sheet/legend chip (or a desktop docked panel) covering the map",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/species.camera.spec.ts",
      "-g",
      "the fitted model's own centre projects INSIDE the free area",
      "--workers=1",
    ],
    env: { PW_PORT: "4433" },
  },
  {
    id: "pill-reason-hidden-always",
    patch: "tests/faults/pill-reason-hidden-always.patch",
    describe:
      "Pill.svelte's always-visible `.pill-reason` span reverts to `hidden` unconditionally -- " +
      "the disabled 'Show analysis cells' pill's reason is invisible again, on a hover, a tap, " +
      "or at rest, on every platform",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/places.spec.ts",
      "-g",
      "AT REST",
      "--workers=1",
    ],
    env: { PW_PORT: "4436" },
  },
  {
    id: "eyes-shots-petal-selector-reverted",
    patch: "tests/faults/eyes-shots-petal-selector-reverted.patch",
    describe:
      "scripts/eyes-shots.mjs's flower-petal locator reverts to the pre-fix 'svg path' nth(3), " +
      "which never hits a real petal (petals are path.petal) -- a SOURCE-SCAN gate, since the " +
      "harness itself drives a real browser against a real build, out of scope for vitest",
    gate: ["npx", "vitest", "run", "tests/scripts/eyesShots.test.ts", "-t", "targets a real petal"],
  },
  {
    id: "report-flower-petal-opacity-reverted",
    patch: "tests/faults/report-flower-petal-opacity-reverted.patch",
    describe:
      "Report.svelte's flower petal regains opacity=\"0.5\" -- the report's own petals render " +
      'paler than their SAME-token .flower-legend swatch again (Opus eyes-on: "petals are pale ' +
      'while the legend swatches are dark")',
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/report.spec.ts",
      "-g",
      "opacity and resolved color",
      "--workers=1",
    ],
    env: { PW_PORT: "4442" },
  },
  {
    id: "category-label-raw-key-reverted",
    patch: "tests/faults/category-label-raw-key-reverted.patch",
    describe:
      "categoryLabel()'s known-category branch reverts to returning the raw string verbatim -- " +
      '"primprod"/"bird" show in the report\'s tables and the app\'s component/species tables ' +
      'again instead of "Primary producer"/"Bird"',
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/ui/categories.test.ts",
      "-t",
      "resolves to its local table label",
    ],
  },
  {
    id: "health-5xx-treated-as-empty",
    patch: "tests/faults/health-5xx-treated-as-empty.patch",
    describe:
      "classifyMapTileError folds any status >= 500 into the 403/404 'empty' (missing-tile) " +
      "branch -- a real titiler-v8 outage would be silently ignored the same way a normal " +
      "release-side gap already is, instead of raising the health banner",
    gate: ["npx", "vitest", "run", "tests/health/mapError.test.ts"],
  },
  {
    id: "health-banner-never-shown",
    patch: "tests/faults/health-banner-never-shown.patch",
    describe:
      "HealthBanner.svelte's own `visible` derived is forced to `false` unconditionally -- the " +
      "health store correctly knows the tiler is down, but nothing ever appears on screen",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.health-banner.spec.ts",
      "-g",
      "boot-time probe",
      "--workers=1",
    ],
    env: { PW_PORT: "4451" },
  },
  // V4 round (owner phone report, 2026-09-24): the phone/desktop species camera used to bunch a
  // wide model's range into one corner of the free area under GLOBE projection at low zoom
  // (`boundsToCameraView`'s flat-Mercator shift math does not land on the same screen pixels once
  // MapLibre renders a true sphere) -- `map.ts#flyToBounds` now asks MapLibre's own
  // projection-aware `cameraForBounds()` for the fit instead. This patch forces the OLD fallback
  // path always (as if `cameraForBounds` never existed), which must turn the new free-area-coverage
  // grid check red for BOTH the leatherback (a wide, directly-published bbox) and the walrus (a
  // COG-bounds-narrowed one).
  {
    id: "species-camera-globe-projection-reverted",
    patch: "tests/faults/species-camera-globe-projection-reverted.patch",
    describe:
      "flyToBounds() never calls MapLibre's own cameraForBounds() -- always falls back to the old " +
      "flat-Mercator hand math, which bunches a wide model's range into one corner of the free " +
      "area under globe projection at low zoom",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/species.camera.spec.ts",
      "-g",
      "V4 fix: the species camera fills the free area",
      "--workers=1",
    ],
    env: { PW_PORT: "4466" },
  },
  // --- P round V5 (Opus eyes-on follow-up on 0.10.59) --------------------------------------------
  {
    id: "eyes-shots-desktop-projection-reverted",
    patch: "tests/faults/eyes-shots-desktop-projection-reverted.patch",
    describe:
      "eyes-shots.mjs's screenPointFor() stops projecting a known lon/lat with map.project() and " +
      "returns a hand-picked pixel again -- the exact bug that made desktop states 06/07/09/10 " +
      "silently shoot the full study area once the globe camera moved",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/scripts/eyesShots.test.ts",
      "-t",
      "projects with the live map",
    ],
  },
  {
    id: "report-counts-scroll-hint-dropped",
    patch: "tests/faults/report-counts-scroll-hint-dropped.patch",
    describe:
      "report.css's narrow-screen scroll-hint rule reverts to display: none -- the species counts " +
      "table's cut-column edge (Opus eyes-on phone-15/desktop-14) looks complete again, with no " +
      "cue that 6 of 8 extinction-risk columns are still off-screen",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/report.spec.ts",
      "-g",
      "shows the scroll hint",
      "--workers=1",
    ],
    env: { PW_PORT: "4472" },
  },
  {
    id: "report-map-summary-coloured-reverted",
    patch: "tests/faults/report-map-summary-coloured-reverted.patch",
    describe:
      "describeMap()'s summary sentence reverts to \"coloured\" -- the same report's map caption " +
      "and desktop map intro spell the word two different ways again (Opus eyes-on)",
    gate: ["npx", "vitest", "run", "tests/lib/report/model.test.ts", "-t", "spells 'colored'"],
  },
  {
    id: "report-common-name-casing-dropped",
    patch: "tests/faults/report-common-name-casing-dropped.patch",
    describe:
      "formatCommonName() stops sentence-casing and prints a source common name verbatim again -- " +
      '"great hammerhead shark" reappears lowercase in the Top-20 table (Opus eyes-on desktop-15)',
    gate: ["npx", "vitest", "run", "tests/lib/report/format.test.ts", "-t", "formatCommonName"],
  },
  {
    id: "report-species-counts-category-raw-reverted",
    patch: "tests/faults/report-species-counts-category-raw-reverted.patch",
    describe:
      "describeCounts()'s largest-category clause reverts to the raw sp_cat string -- the report's " +
      'species summary sentence reads "largest turtle 1" again instead of "largest Turtle 1"',
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/lib/report/model.test.ts",
      "-t",
      "names the largest category through categoryLabel",
    ],
  },
  {
    id: "species-card-category-raw-reverted",
    patch: "tests/faults/species-card-category-raw-reverted.patch",
    describe:
      "speciesCard()'s Category fact reverts to the raw sp_cat string -- the species lens sidebar " +
      'reads "Category: turtle"/"mammal" lowercase again (Opus eyes-on desktop-17/18)',
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/lens/species/card.test.ts",
      "-t",
      "title-cases the Category fact",
    ],
  },
  {
    id: "scores-search-name-fallback-lost",
    patch: "tests/faults/scores-search-name-fallback-lost.patch",
    describe:
      "matchZones()'s rank call reverts to the bundle's raw z.name, dropping resolvedZoneName()'s " +
      "PROGRAM_AREA_NAMES fallback -- on a real release (no published zones.programarea[*].name), " +
      'typing a Program Area\'s full name ("Aleutian", "Gulf of Alaska") finds nothing again, ' +
      'even though the dropdown\'s own option still reads "Aleutian Arc (ALA)" (V6 round, ' +
      "owner-reported: found while shooting the Program Area harness state)",
    gate: ["npx", "vitest", "run", "tests/lens/scores/search.test.ts"],
  },
  // V7 round (P round 2, CI run 36070452831): the V3 health banner's `position: fixed` overlay
  // covered the top bar (see HealthBanner.svelte's own header for the placement fix), AND the
  // data-origin probe's `!res.ok` gate misread every hermetic fixture's ordinary app/boot.json 404
  // as the release data being "down" (see probe.ts's own header) -- together, this raised the
  // banner (and blocked every topbar click underneath it) on nearly every shell spec, which is what
  // actually produced the CI run's 97 failures across chromium/webkit/firefox. Two faults, one per
  // half of the fix.
  {
    id: "health-banner-fixed-overlay-restored",
    patch: "tests/faults/health-banner-fixed-overlay-restored.patch",
    describe:
      "HealthBanner.svelte's `.health-banner` reverts to `position: fixed` (the pre-fix, viewport- " +
      "covering overlay) -- with the tiler routed down, the banner sits back on top of `.topbar` and " +
      "a click on Feedback/the lens switch is intercepted by it again",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.health-banner.spec.ts",
      "-g",
      "with the tiler down, a click on Feedback and on the lens switch still work",
      "--workers=1",
    ],
    env: { PW_PORT: "4491" },
  },
  {
    id: "health-probe-404-treated-as-down",
    patch: "tests/faults/health-probe-404-treated-as-down.patch",
    describe:
      "probeUrl() reverts to the pre-fix `!res.ok` gate -- any non-2xx (including the 403/404 a " +
      "hermetic fixture's own app/boot.json legitimately answers) is misclassified as `down` again, " +
      "not just a real 5xx/network-error/timeout",
    gate: ["npx", "vitest", "run", "tests/health/probe.test.ts"],
  },
  // --- P round, W2 (Ben's live-review of 0.10.62, 2026-09-24): the Layers panel's spatial-unit
  // toggle and the flower plot's reference ring. Two faults, one per deliverable.
  {
    id: "layers-unit-toggle-write-dropped",
    patch: "tests/faults/layers-unit-toggle-write-dropped.patch",
    describe:
      "src/lib/ui/LayersPanel.svelte's onUnitToggleChange() no longer calls unitToggle.onChange -- " +
      "pressing 'Program areas' moves the pressed segment visually but never writes unit= to the URL",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/layers.spec.ts",
      "-g",
      "switching Raster cells -> Program areas writes unit=",
      "--workers=1",
    ],
    env: { PW_PORT: "4521" },
  },
  {
    id: "flower-ring-fixed-at-100",
    patch: "tests/faults/flower-ring-fixed-at-100.patch",
    describe:
      "flowerGeometry.ts's computeFlowerReferenceRing() ignores maxScore and always returns the " +
      "FLOWER_MAX_FALLBACK (100) ring -- a release with a real, smaller published maximum still " +
      "draws its reference ring at the fixed outer edge",
    gate: ["npx", "vitest", "run", "tests/ui/flowerGeometry.test.ts", "-t", "a real maxScore"],
  },
  {
    id: "zonebbox-rings-dropped",
    patch: "tests/faults/zonebbox-rings-dropped.patch",
    describe:
      "zoneBboxFromFeatures() (zoneStats.ts, item 1: the Scores search field never flew the camera " +
      "to a chosen Program Area) hardcodes `polygons: Ring[][] = []` instead of calling " +
      "ringsFromFeatures() -- always returns null, so a zone search pick falls straight through to " +
      "the (currently unpublished) label_pt fallback again",
    gate: ["npx", "vitest", "run", "tests/places/zoneStats.test.ts"],
  },
  {
    id: "places-geojson-name-fallback-reverted",
    patch: "tests/faults/places-geojson-name-fallback-reverted.patch",
    describe:
      "download.ts's zoneFeature() reverts to the bare `p.keys.join(\", \")` for a zone place's " +
      "name (item 2: 'Download places' wrote the bare acronym instead of the release's full 'Name " +
      "(KEY)' label) instead of zoneDisplayName(zoneStatsFor(...))",
    gate: ["npx", "vitest", "run", "tests/places/download.test.ts"],
  },
  {
    id: "species-inputs-table-emptied",
    patch: "tests/faults/species-inputs-table-emptied.patch",
    describe:
      "inputsTableRows() (item 7: the species Table tool showed a permanent placeholder) returns " +
      "`[]` unconditionally instead of reshaping the LayerBar's own pills -- the Table tool goes " +
      "back to 'no inputs' for every species, real or not",
    gate: ["npx", "vitest", "run", "tests/lens/species/inputsTable.test.ts"],
  },
  {
    id: "flower-category-label-reverted",
    patch: "tests/faults/flower-category-label-reverted.patch",
    describe:
      "computeFlowerGeometry() (flowerGeometry.ts, item 9: v1's real 'reptile' component rendered " +
      "as a flower petal literally labelled 'No data') drops the categoryLabel() override and goes " +
      "back to bare categoryFor(c.key) -- any unrecognized-but-real category is 'No data' again",
    gate: ["npx", "vitest", "run", "tests/lens/scores/flower.test.ts"],
  },
  {
    id: "scores-zone-flat-padding-restored",
    patch: "tests/faults/scores-zone-flat-padding-restored.patch",
    describe:
      "selectZone() (state.svelte.ts, W3 item 1: a Scores search pick of a Program Area landed " +
      "under the phone sheet / desktop docked panel) stops reading deps.chromePadding() -- the " +
      "bounds fit reverts to a flat 40px padding on every edge, blind to the chrome covering the map",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.search.spec.ts",
      "-g",
      "GAA's fitted area lands mostly",
      "--workers=1",
    ],
    env: { PW_PORT: "4531" },
  },
  {
    id: "flower-hub-text-not-hidden",
    patch: "tests/faults/flower-hub-text-not-hidden.patch",
    describe:
      "Flower.svelte (W3 item 2: the hub number's own glyph feet poked out below the petal-label " +
      "chip as two white stubs) draws `.hub-text` unconditionally again, instead of hiding it while " +
      "`shownPetal` covers it",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.flower.spec.ts",
      "-g",
      "hovering a petal hides the hub number",
      "--workers=1",
    ],
    env: { PW_PORT: "4532" },
  },
  {
    id: "segmented-flex-fill-dropped",
    patch: "tests/faults/segmented-flex-fill-dropped.patch",
    describe:
      "Segmented.svelte's `.seg button` (W3 item 3: the segments filled only part of the pill, " +
      "~283 of 1245px on desktop) drops `flex: 1 1 0%` -- a caller whose own layout stretches " +
      "`.seg` (the Layers unit toggle, the Table Species|Zones|Composition switch) leaves dead " +
      "space past the last segment again",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/layers.spec.ts",
      "-g",
      "the two segments fill the pill's own width",
      "--workers=1",
    ],
    env: { PW_PORT: "4533" },
  },
  {
    id: "flower-half-detent-cap-dropped",
    patch: "tests/faults/flower-half-detent-cap-dropped.patch",
    describe:
      "Shell.svelte (W3 item 4: the bigger flower pushed the Component | Score table below the " +
      "fold at the phone's half detent) passes `compactFlower={false}` unconditionally instead of " +
      'the live `isPhone && sheetGeom.detent === "half"` -- the flower is never capped at half ' +
      "detent again",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.flower.spec.ts",
      "-g",
      "Half height caps the flower",
      "--workers=1",
    ],
    env: { PW_PORT: "4534" },
  },
  {
    id: "modeled-spelling-reverted",
    patch: "tests/faults/modeled-spelling-reverted.patch",
    describe:
      "model.ts's SOURCES_TEXT (W3 item 6) reverts 'modeled' back to the UK spelling 'modelled', " +
      "the one holdout in this app's otherwise-US-spelling report copy",
    gate: ["npx", "vitest", "run", "tests/lib/report/model.test.ts", "-t", "US spelling"],
  },
  {
    id: "aquamaps-citation-spacing-not-fixed",
    patch: "tests/faults/aquamaps-citation-spacing-not-fixed.patch",
    describe:
      "fixKnownCitationTypos() (cite.ts, W3 item 6) becomes a no-op -- the AquaMaps dataset's own " +
      "published citation runs 'UnportedLicense' together again in the report's Sources list",
    gate: ["npx", "vitest", "run", "tests/release/cite.test.ts"],
  },
  {
    id: "report-map-color-stale-mount",
    patch: "tests/faults/report-map-color-stale-mount.patch",
    describe:
      "Report.svelte's map-mount effect drops the `mapDataReady` gate (stubs.length === 0 || " +
      "progressDone >= stubs.length) and reverts to firing the instant `model` turns non-null -- " +
      "every place's score is still null at that point, so the map's one-shot colour build reads " +
      "REPORT_NODATA_COLOR for every place and never repaints once the real scores land",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/report.map.zonecolor.spec.ts",
      "-g",
      "two Program Areas",
      "--workers=1",
    ],
    env: { PW_PORT: "4541" },
  },
  {
    id: "report-map-single-place-degenerate-ramp",
    patch: "tests/faults/report-map-single-place-degenerate-ramp.patch",
    describe:
      "model.ts's describeMap() drops its one-place branch -- a lone scored place goes back to " +
      "the generic 'ramp X to Y (red = high); highest NAME V, lowest NAME V' caption, the same " +
      "value stated twice around a fabricated ±0.5-wide range",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/report.map.zonecolor.spec.ts",
      "-g",
      "one place",
      "--workers=1",
    ],
    env: { PW_PORT: "4541" },
  },
  // --- P round W5 (Opus 5.5 eyes-on review 5 of 0.10.66) ------------------------------------------
  {
    id: "desktop-panel-inset-gutter-dropped",
    patch: "tests/faults/desktop-panel-inset-gutter-dropped.patch",
    describe:
      "chromePadding.ts's desktopPanelPadding() reverts panelReserve to the bare geometry.size -- " +
      "the docked panel's own outer CSS inset (--space-3) and the fit's breathing gutter both drop " +
      "out, so the reserve no longer clears the panel's real DOM footprint (desktop-19). A plain " +
      "vitest gate (exact, deterministic) rather than the e2e pixel-margin check: GAA's own bbox " +
      "still lands with enough natural slack under either reserve in the hermetic fixture's " +
      "geometry for a fuzzy 5x5-grid/margin check to stay green either way, but the exact returned " +
      "`right` value cannot -- see tests/map/chromePadding.test.ts's own 'W5 regression' case.",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/map/chromePadding.test.ts",
      "-t",
      "W5 regression: the right reserve clears the panel's real outer edge",
    ],
  },
  {
    id: "phone-fit-gutter-dropped",
    patch: "tests/faults/phone-fit-gutter-dropped.patch",
    describe:
      "chromePadding.ts's phonePaddingFromMeasured() drops its left/right FIT_GUTTER_PX -- the " +
      "LIVE phone zone/species-model fit has no side gutter again, so a fitted outline can land " +
      "flush against the viewport's own edge (phone-19: GAA's east outline touching x 779 of 780). " +
      "A plain vitest gate (exact, deterministic): like the desktop entry above, GAA's own bbox in " +
      "the hermetic e2e fixture happens to clear 16px either way (a narrower/differently-placed " +
      "bbox would not), so the exact returned left/right values are the reliable catch.",
    gate: ["npx", "vitest", "run", "tests/map/chromePadding.test.ts", "-t", "a side gutter"],
  },
  {
    id: "eyes-shots-report-map-scroll-dropped",
    patch: "tests/faults/eyes-shots-report-map-scroll-dropped.patch",
    describe:
      "eyes-shots.mjs's 'report' state loses its map-figure scroll step entirely (back to the two " +
      "blind mouse.wheel(0,1400) scrolls alone) -- the report's map figure (legend + caption) is " +
      "never framed in any shot again, on either viewport, a SOURCE-SCAN gate (the harness drives a " +
      "real browser against a real build, out of scope for vitest)",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/scripts/eyesShots.test.ts",
      "-t",
      "scrolls the map figure into view with a real scrollIntoView call",
    ],
  },
  {
    id: "metric-key-label-reverted",
    patch: "tests/faults/metric-key-label-reverted.patch",
    describe:
      "R3-W1 (round-3 plan, R3-B1, fix round): boot.ts's metricKeyLabel() drops its `label` " +
      "argument entirely (back to a bare 'title-case the key' pass-through) -- a REAL, curated " +
      "label (e.g. primprod's real manifest.metrics text) is no longer returned verbatim, " +
      "overwritten by the title-cased key instead; the degenerate-label case ('score' curated as " +
      "'score') keeps working by coincidence (title-casing the key either way), so this exercises " +
      "the OTHER half of the same function -- a real label must win over the key, not just an " +
      "absent one must fall back to it.",
    gate: ["npx", "vitest", "run", "tests/lens/scores/boot.test.ts", "-t", "metricKeyLabel"],
  },
  {
    id: "svgwrapper-footer-text-dropped",
    patch: "tests/faults/svgwrapper-footer-text-dropped.patch",
    describe:
      "R3-W2: buildMapSvg() (src/lib/download/svgWrapper.ts) drops the two footer <text> elements " +
      "-- the Download menu's 'Map view · SVG' export keeps its background band but loses the " +
      "title/unit/app/version/share-URL line entirely, silently",
    gate: ["npx", "vitest", "run", "tests/download/svgWrapper.test.ts"],
  },
  // R3-B14/C3 (round-3 W5-tooling round): `selectZone`'s newly-added preference for a PUBLISHED
  // `boot.zones[unit][*].bbox` over `zoneBoundsFromMap`'s live-tile query, reverted -- a search
  // pick with BOTH a bbox and an already-loaded polygon tile falls back to the polygon's own box
  // instead of the (deliberately different, in the fixture) bbox. Must turn
  // e2e/scores.search.spec.ts's own "Enter prefers a PUBLISHED bbox..." test red: the camera
  // settles inside ALA's real fixture polygon (lon [-170,-168] lat [20,22]) instead of its
  // published bbox (lon/lat [40,42]).
  {
    id: "scores-search-bbox-preference-dropped",
    patch: "tests/faults/scores-search-bbox-preference-dropped.patch",
    describe:
      "state.svelte.ts's selectZone bounds resolution drops the zoneBboxFromBoot() preference, " +
      "falling back to zoneBoundsFromMap alone -- a published zone bbox is no longer preferred " +
      "over a currently-loaded map tile",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.search.spec.ts",
      "-g",
      "prefers a PUBLISHED bbox",
      "--workers=1",
    ],
    env: { PW_PORT: "4451" },
  },
  // --- round 3, W3 (app nits with a known fix) ----------------------------------------------------
  {
    id: "popup-cellcentre-click-point",
    patch: "tests/faults/popup-cellcentre-click-point.patch",
    describe:
      "state.svelte.ts's showCellPopup() goes back to printing the raw click point (lngLat) " +
      "instead of the cell centre (cellRing()) -- the SAME cell then reads two different " +
      "coordinate pairs depending on whether you look at the popup or the flower panel's own title",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.popup.spec.ts",
      "-g",
      "CELL CENTRE",
      "--workers=1",
    ],
    env: { PW_PORT: "4437" },
    duckdbExt: true,
  },
  // --- round 3, W6 (consistency slice A: shell + shared UI) ---------------------------------------
  {
    id: "notify-toast-dropped",
    patch: "tests/faults/notify-toast-dropped.patch",
    describe:
      "announcer.ts's notify() drops its pushToast() call -- a user-initiated action's result/" +
      "error goes back to reaching only a screen reader, with no visible toast at all (UI-1)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/shell.toast.spec.ts",
      "--workers=1",
    ],
    env: { PW_PORT: "4471" },
  },
];

/** usability B1: a fault whose gate boots a real DuckDB-WASM needs the gitignored extension mirror
 * in its throwaway worktree, or the gate fails for a reason that has nothing to do with the fault. */
function provisionDuckdbExt(worktreeDir) {
  const mirror = join(ROOT, "public", "duckdb-ext");
  if (existsSync(mirror)) {
    cpSync(mirror, join(worktreeDir, "public", "duckdb-ext"), { recursive: true });
    return null;
  }
  const fetched = run("node", ["scripts/fetch-duckdb-extensions.mjs"], worktreeDir);
  return fetched.status === 0 ? null : `fetch-duckdb-extensions failed: ${fetched.stderr}`;
}

function run(cmd, args, cwd, env) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    // a Playwright gate's own `webServer` build+preview can take a minute; the default 1 MB stdout
    // cap is also far too small for its output, and an exceeded cap kills the child (status null),
    // which would read as "went red" for the wrong reason.
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
}

function runOne(fault) {
  const patchPath = join(ROOT, fault.patch);
  if (!existsSync(patchPath)) {
    return { ok: false, fault, reason: `missing patch file ${fault.patch}` };
  }

  const tmpBase = process.env.TMPDIR ?? tmpdir();
  const worktreeDir = mkdtempSync(join(tmpBase, `test-faults-${fault.id}-`));
  // mkdtempSync already created worktreeDir as an empty directory; `git worktree add` refuses a
  // non-empty target but is fine with an EMPTY one that already exists, so remove it first and
  // let git create it fresh at the same path.
  rmSync(worktreeDir, { recursive: true, force: true });

  try {
    const add = run("git", ["worktree", "add", "--detach", "--quiet", worktreeDir, "HEAD"], ROOT);
    if (add.status !== 0) {
      return { ok: false, fault, reason: `git worktree add failed: ${add.stderr || add.stdout}` };
    }

    // node_modules is not tracked by git, so the fresh worktree has none; symlinking the one this
    // checkout already has avoids an `npm ci` per fault (this script may run several times a day).
    symlinkSync(join(ROOT, "node_modules"), join(worktreeDir, "node_modules"));

    const apply = run("git", ["apply", patchPath], worktreeDir);
    if (apply.status !== 0) {
      return {
        ok: false,
        fault,
        reason: `git apply failed (patch does not apply to HEAD -- rebuild it): ${apply.stderr || apply.stdout}`,
      };
    }

    if (fault.duckdbExt) {
      const missing = provisionDuckdbExt(worktreeDir);
      if (missing) return { ok: false, fault, reason: missing };
    }

    const gate = run(fault.gate[0], fault.gate.slice(1), worktreeDir, fault.env);
    // status null = killed (timeout/signal), which is NOT the same thing as "the gate failed" --
    // report it as a fault that could not be judged rather than silently counting it as red.
    if (gate.status === null) {
      return {
        ok: false,
        fault,
        reason: `the gate was killed before it could report (${gate.error?.message ?? "signal"})`,
        output: (gate.stdout ?? "") + (gate.stderr ?? ""),
      };
    }
    const wentRed = gate.status !== 0;
    const output = gate.stdout + gate.stderr;
    // red for the RIGHT reason: every `redMatches` pattern must appear in the gate's output
    const wrongReason = wentRed ? (fault.redMatches ?? []).find((re) => !re.test(output)) : null;
    return {
      ok: wentRed && !wrongReason,
      fault,
      reason: !wentRed
        ? `the gate stayed GREEN with the fault applied -- it cannot fail, so it is not a check`
        : wrongReason
          ? `the gate went red, but not for this fault's reason (no match for ${wrongReason})`
          : undefined,
      output,
    };
  } finally {
    // --force: the worktree holds an applied-but-uncommitted patch, which a plain `remove` refuses.
    run("git", ["worktree", "remove", "--force", worktreeDir], ROOT);
    rmSync(worktreeDir, { recursive: true, force: true });
  }
}

// atlas-4 fix round 3: `--only <id>` runs a single named entry (its `id` field) instead of the
// whole manifest -- a fix round that adds one or two faults should be able to prove just those
// without paying for the other ~25 (a real browser build each), the same way a fresh round would
// want to verify its own work in isolation. `<id>` must be an exact match against a real entry;
// an unknown one fails loudly rather than silently running everything (a typo here would
// otherwise "pass" by running the wrong thing).
function faultsToRun() {
  const onlyIdx = process.argv.indexOf("--only");
  if (onlyIdx === -1) return FAULTS;
  const id = process.argv[onlyIdx + 1];
  const match = FAULTS.filter((f) => f.id === id);
  if (match.length === 0) {
    process.stderr.write(
      `test-faults: --only ${id ?? "<missing>"} matches no entry in FAULTS (known ids: ` +
        `${FAULTS.map((f) => f.id).join(", ")})\n`,
    );
    process.exit(1);
  }
  return match;
}

function main() {
  if (!process.env.TMPDIR) {
    process.stderr.write(
      "test-faults: TMPDIR is not set -- export it first (see CLAUDE.md/the dispatch instructions); " +
        "refusing to fall back to the system /tmp for a throwaway git worktree.\n",
    );
    process.exit(1);
  }

  const faults = faultsToRun();
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  process.stdout.write(`test-faults: ${faults.length} fault(s), worktreed off HEAD (${head})\n\n`);

  const rows = [];
  let failed = false;
  for (const fault of faults) {
    const result = runOne(fault);
    rows.push(result);
    if (result.ok) {
      process.stdout.write(`✓ RED as expected — ${fault.id}: ${fault.describe}\n`);
    } else {
      failed = true;
      process.stderr.write(`✗ ${fault.id}: ${fault.describe}\n`);
      process.stderr.write(`    ${result.reason}\n`);
      if (result.output) {
        process.stderr.write(
          result.output
            .split("\n")
            .slice(-15)
            .map((l) => `    | ${l}`)
            .join("\n") + "\n",
        );
      }
    }
  }

  process.stdout.write(
    `\ntest-faults: ${rows.filter((r) => r.ok).length}/${rows.length} faults turned their gate red\n`,
  );
  if (failed) {
    process.stderr.write("\nA seeded fault did NOT turn its gate red: the gate is not a gate.\n");
  }
  process.exit(failed ? 1 : 0);
}

// R3-D2: only run the (expensive, gate-running) main() when this file is executed directly --
// `import { FAULTS } from "./test-faults.mjs"` (scripts/check-faults-apply.mjs) must be a plain,
// side-effect-free read of the manifest.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
