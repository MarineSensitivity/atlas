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
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FAULTS = [
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
  // `redMatches` requires the SOLO baseline test to have passed (the engine worked) and a
  // concurrency test to have failed. `--reporter=list` pins the output those patterns read.
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
      /✓\s+\d+ \[chromium\] › e2e\/places\.concurrency\.spec\.ts:\d+:\d+ › solo baselines/u,
      /✘\s+\d+ \[chromium\] › e2e\/places\.concurrency\.spec\.ts/u,
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
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/layers.spec.ts",
      "-g",
      "a pixel probe shows the promoted basemap layer painting OVER the raster",
      "--workers=1",
    ],
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

main();
