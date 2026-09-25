// atlas-8 step 5 / Deliverable 2: the per-line verdict behind `docs/parity.html`.
//
// One entry per parsed checklist row. `match` is a distinctive substring of the row's own text: the
// build re-checks it against what `checklist-core.mjs` parsed, so an inserted or reworded line in a
// plan file fails the build rather than silently re-pointing an id at a different rule.
//
// `status`:
//   done                   — the rule is implemented AND something asserts it
//   partial                — part of the rule is implemented/asserted; `note` says which part is not
//   deferred               — not built this phase (every one of these is in the known-gaps list)
//   intentional-difference — the atlas deliberately does NOT do what the line says; `diffs` names
//                            the numbered entry of the intentional-differences list that explains it
//
// `evidence` names real test titles; `verifyEvidence()` (test-index-core.mjs) re-reads each file and
// fails the build if the title is not there. `{ file: "no test" }` is the honest answer where
// nothing asserts the line — never a test that does not exist.

/**
 * @typedef {"done" | "partial" | "deferred" | "intentional-difference"} Status
 *
 * @typedef {object} Evidence
 * @property {string} file a repo-relative test file, or the literal `"no test"`
 * @property {string} name the test's title, verified against the file by `verifyEvidence()`
 *
 * @typedef {object} StatusEntry
 * @property {string} match a distinctive substring of the checklist line (the drift guard)
 * @property {Status} status
 * @property {Evidence[]} evidence
 * @property {string} [note]
 * @property {string[]} [diffs] ids of intentional-difference entries that explain this line
 *
 * @typedef {import("./checklist-core.mjs").ChecklistRow & {status: Status, evidence: Evidence[],
 *   note: string, diffs: string[]}} MergedRow
 */

/** @type {Evidence[]} */
const NO_TEST = [{ file: "no test", name: "" }];

/**
 * The verdict table. Typed as an INDEX (`Record<string, StatusEntry>`) rather than left to its own
 * 72-key literal, so `mergeStatus()` accepts any table of the same shape — a fixture with four
 * rows is not "missing 68 properties" (the tsc error this annotation fixes, CI on `b9d1c0c`).
 *
 * @type {Record<string, StatusEntry>}
 */
export const STATUS = {
  // ---------------------------------------------------------------- atlas-4 · scores lens
  "S-01": {
    match: "Study area: FULL / AK / AT / GA / PA presets",
    status: "done",
    evidence: [
      // e2e/scores.studyarea.spec.ts drives the REAL, BUILT app end-to-end — an Opus 5.5 audit
      // found the evidence below (before this fix) could not have caught the owner's 2026-09-24
      // live defect (`?area=AK` rendering the default camera): it spied on `flyTo` in isolation,
      // and `flyToStudyArea` (`tests/map/interaction.test.ts`) has NO caller anywhere in `src/`.
      {
        file: "e2e/scores.studyarea.spec.ts",
        name: "?area=AK flies to Alaska on LOAD, not the default camera",
      },
      {
        file: "e2e/scores.studyarea.spec.ts",
        name: "picking Alaska from the Search bar's Regions group flies there (real moveend) and writes area=AK to the URL",
      },
      {
        file: "e2e/scores.studyarea.spec.ts",
        name: "area=FULL (selected after another area) fits the whole study area again",
      },
      {
        file: "e2e/scores.studyarea.spec.ts",
        name: "a user pan after the fly is kept — not fought back to the study area",
      },
      {
        file: "e2e/scores.studyarea.spec.ts",
        name: "?area=AK still flies to Alaska with the Layers panel COLLAPSED at load",
      },
      {
        file: "tests/map/camera.test.ts",
        name: "shouldFlyToArea — sel.area drives the camera on load AND on change",
      },
      // the NEGATIVE half, kept alongside the positive one above, never a replacement for it.
      {
        file: "tests/map/titiler.test.ts",
        name: "tileUrlLeaksStudyArea — no study-area key ever reaches a URL",
      },
    ],
    note:
      "fixed 2026-09-24 (owner report, live v7: `?area=AK` rendered the default camera). Root cause: " +
      "the initial camera resolved `sel.area` against a literal `null` boot, and the ONLY `flyTo` " +
      "call lived in LayersPanel.svelte's `onchange` — the panel BODY, which never runs for a URL- " +
      "driven `sel.area` on load. Fixed in Shell.svelte's own `$effect` (`camera.ts#shouldFlyToArea`), " +
      "a shell/lens-level store per docs/map.md's 0.10.21 rule — runs whether or not the Layers panel " +
      "is mounted (see the COLLAPSED-panel case above). `tileUrlLeaksStudyArea` remains the negative " +
      "half: the study area still moves the camera only, never a data or tile URL (apps#13/#14). " +
      "Seeded fault: tests/faults/study-area-camera-ignored.patch.",
  },
  "S-02": {
    match: "Spatial units: Raster cells",
    status: "done",
    diffs: ["ID-03"],
    evidence: [
      { file: "tests/lens/scores/boot.test.ts", name: "cell first, then the release's one unit" },
      {
        file: "tests/lens/scores/boot.test.ts",
        name: "v1 predates Program Areas: the note names the release and the label",
      },
      {
        file: "tests/lens/scores/boot.test.ts",
        name: "v7 already reports on programarea: no note",
      },
    ],
    note: "derived from `boot.units`, never hardcoded — and under D17 every release publishes exactly one unit (Program Areas; Planning Areas on v1), so the list is shorter than the Shiny app's.",
  },
  "S-03": {
    match: "Layer select grouped by category in order",
    status: "partial",
    evidence: [
      {
        file: "tests/lens/scores/boot.test.ts",
        name: "groups composite, component, raw — each sorted by order",
      },
      {
        file: "tests/lens/scores/boot.test.ts",
        name: "the default layer is the composite row, never boot.layers[0] (which is order 1 = raw)",
      },
      {
        file: "tests/map/style.test.ts",
        name: "defaults to the globe projection and carries it IN the style (plan atlas-4 §5.3)",
      },
      {
        file: "tests/lens/scores/raster.test.ts",
        name: "unavailable when the release has not published this palette's stops (today: viridis/cividis/magma)",
      },
    ],
    note: "grouping, default layer and globe↔mercator are done. Only ONE palette is usable: every published release (v7 included) carries stops for `spectral_r` alone, so Viridis/Cividis/Magma render an 'unavailable' legend rather than an invented ramp. Data gap, owner atlas-1.",
  },
  "S-04": {
    match: "One PMTiles source + outline per unit",
    status: "partial",
    evidence: [
      { file: "tests/map/zones.test.ts", name: "programarea: white, 1 px, opacity 1, solid" },
      { file: "tests/map/zones.test.ts", name: "ecoregion: black, 3 px, opacity 1" },
      {
        file: "tests/map/zones.test.ts",
        name: "subregion: #d9d9d9, 2 px, opacity 0.7, dashed [3,3]",
      },
      { file: "tests/map/zones.test.ts", name: "programarea: white 12 px on a dark halo" },
      {
        file: "tests/map/zones.test.ts",
        name: "a vector source per unit, addressed through the pmtiles:// protocol",
      },
      {
        file: "e2e/scores.firstpaint.spec.ts",
        name: "renders 20 Program-Area outlines",
      },
    ],
    note: "every style rule of the `zone_style` table is ported and pinned, and the label LAYER is built — but no published release carries `label_pt` on any zone row, so no zone labels are drawn (known gap G-01, owner atlas-1/msens).",
  },
  "S-05": {
    match: "Cell branch: titiler tiles of the FULL COG",
    status: "done",
    evidence: [
      {
        file: "tests/lens/scores/raster.test.ts",
        name: "builds the FULL-COG titiler tile template, rescale verbatim, opacity 0.6",
      },
      {
        file: "tests/lens/scores/raster.test.ts",
        name: "endpoints are signif(rescale, 3), stops from boot.palettes",
      },
      {
        file: "tests/map/titiler.test.ts",
        name: "writes url, colormap_name, rescale in that order (the cache key's order)",
      },
      {
        file: "tests/map/style.test.ts",
        name: "the raster resamples NEAREST, so a probed pixel is the cell's own value",
      },
      {
        file: "e2e/scores.firstpaint.spec.ts",
        name: "paints the score raster at two ocean probe points",
      },
    ],
  },
  "S-06": {
    match: "Cells outside Program Areas",
    status: "done",
    evidence: [
      {
        file: "tests/lens/scores/raster.test.ts",
        name: "the explicit colormap, opacity 0.55, off by default",
      },
      {
        file: "tests/map/titiler.test.ts",
        name: 'is `{"1":[34,34,34,255]}`, escaped, with NO colormap_name and NO rescale',
      },
    ],
  },
  "S-07": {
    match: "Zone branch: ALL zones of the unit",
    status: "partial",
    evidence: [
      {
        file: "tests/lens/scores/zoneFill.test.ts",
        name: "the 11-bin rule: exact stop colours at the low/mid/high end, pinned against boot.palettes itself",
      },
      {
        file: "tests/lens/scores/zoneFill.test.ts",
        name: "one stop per zone, keyProperty named for the unit, legend range rounded to 1 decimal",
      },
      {
        file: "tests/lens/scores/zoneFill.test.ts",
        name: "empty values: the Inf/-Inf guard — no fill, no legend, empty:true",
      },
      {
        file: "tests/lens/scores/popup.test.ts",
        name: "the shared subject line + 'Score {value}' (UI-4), swatch coloured against the ramp",
      },
      {
        file: "tests/raster/ramps.test.ts",
        name: "choroplethBin — clamp(roundHalfEven((v-min)/max(max-min,1e-6)*10)+1, 1, 11)",
      },
    ],
    note: 'the fill/legend rule is implemented and pinned; the tooltip prints the zone KEY ("GAA: 40") rather than its name, because no published boot carries `name` — known gap G-01, and the code already falls back deliberately ("falls back to the key when the zone carries no name"). The atlas has NO hover interaction at all (`ScoresLens.svelte`\'s own comment: "this app has no hover") — the zone tooltip and highlight are wired to CLICK instead. The Shiny app repaints the hovered zone purple and shows its popup on mouseover, with no click needed; that repaint-on-hover behaviour is not built here (known gap G-26).',
  },
  "S-08": {
    match: "Layers control lists the layers that actually exist",
    status: "partial",
    evidence: [
      {
        file: "e2e/layers.spec.ts",
        name: "the Data row's eye toggle hides the raster's PAINTED pixel without removing the layer",
      },
      {
        file: "e2e/layers.spec.ts",
        name: "M3: the Outlines row's eye hides programarea_ln's rendered features (>0 -> 0), never removes the layer",
      },
      {
        file: "e2e/layers.spec.ts",
        name: "M3: the Selection row's eye hides the picked cell's selection-line ring (>0 -> 0), never removes the layer",
      },
      {
        file: "e2e/layers.spec.ts",
        name: "M3: hiding basemap-land (layers=) shows the theme's plain background colour through",
      },
    ],
    // R3 (round-2 plan §5 U4) replaced the dead-switch fix's structural, uncalled-in-production
    // `layersControlItems()` (derived-from-style ids, but no caller) with the REAL, interactive
    // `LayersPanel.svelte` stack -- one row per `LayerGroupId`, wired to `moveLayerStackEntry`/
    // `composeStyle`'s own `layerStack` input. Review round 1 (2026-09-24) flagged the old evidence
    // as testing dead code with no caller; the evidence above is the panel's own eyes proven
    // against a REAL rendered map (a pixel handoff or a rendered-feature-count drop to exactly 0,
    // never merely "the id list changed"), the stronger, load-bearing claim this row makes.
    note: "the dead-switch bug is fixed by construction (the panel's ids come from `layerStack.ts`'s own `LayerGroupId` enum, never a hand-maintained list) and proven end-to-end by the eye-toggle e2e above. NOT built: MapLibre's fullscreen / navigation / scale controls and the Nominatim geocoder — they are real buttons that would nest inside `#map[role=img]` and fail axe, so where map chrome lives is one cross-lens decision still open (known gap G-02). R3 (Ben, live-review 2026-09-25): 'Layers control lists the layers that actually exist' now reads differently — `layerStack.ts`'s new `LAYER_GROUP_IN_PANEL` deliberately DROPS three basemap rows (Land & water, Boundaries, Roads & buildings) from the pane's own list ('fine to leave on as default basemap without worrying about layer ordering'); they stay full model citizens (still in `DEFAULT_LAYER_STACK`, the `layers=` codec, Reset), so the basemap-land eye-toggle proof above now drives it via `layers=` rather than a panel row, per `e2e/layers.spec.ts`'s own updated header comment on that test.",
    diffs: ["ID-10"],
  },
  "S-09": {
    match: "The whole style is one composed object",
    status: "done",
    evidence: [
      {
        file: "tests/map/style.test.ts",
        name: "calls setStyle(style, {diff:true}) — and nothing else",
      },
      {
        file: "tests/map/style.test.ts",
        name: "sorts by the declared order regardless of the order layers were built in",
      },
      { file: "e2e/verify.faults.spec.ts", name: "seeded fault: setStyle loses the zone layer" },
    ],
  },
  "S-10": {
    match: "Click a cell: cellFromLonLat with the release's grid",
    status: "partial",
    evidence: [
      {
        file: "tests/map/interaction.test.ts",
        name: "computes the cell id with the RELEASE's grid — the same lon/lat differs per grid",
      },
      {
        file: "tests/lens/scores/popup.test.ts",
        name: "the shared subject line + 'Label value' (UI-4), swatch coloured against the ramp",
      },
      {
        file: "e2e/scores.popup.spec.ts",
        name: "click a known cell -> popup shows cell id, lon/lat at 3 dp, and the tile's value",
      },
      {
        file: "tests/lens/scores/selection.test.ts",
        name: "centres on the cell, half-extents from the grid resolution",
      },
    ],
    note: 'the click path, the popup text and the `#ff00aa` ring are done and asserted, and the value is read from the wide cell Parquet, never from a pixel. The plan\'s "≤ 2 requests cold, 0 warm" budget was never turned into a gate (known gap G-03).',
  },
  "S-11": {
    match: "Cell flower",
    status: "done",
    evidence: [
      {
        file: "tests/lens/scores/flower.test.ts",
        name: "drops component=all and passes val through as score",
      },
      {
        file: "tests/lens/scores/flower.test.ts",
        name: "strips extrisk_ and _ecoregion_rescaled, underscores to spaces",
      },
      { file: "tests/lens/scores/flower.test.ts", name: "cell: the shared subject line, 3 dp" },
      {
        file: "tests/lens/scores/flower.test.ts",
        name: "v8/v9 cell click: de-duplicates the extrisk_primary_producer/primprod pair the same way",
      },
    ],
  },
  "S-12": {
    match: "Click a zone: highlight line",
    status: "done",
    evidence: [
      {
        file: "tests/map/interaction.test.ts",
        name: "resolves the unit from the layer id and reads that unit's key property",
      },
      { file: "tests/map/colors.test.ts", name: 'is exactly "#ff00aa"' },
      {
        file: "tests/lens/scores/mapInputs.test.ts",
        name: "a zone selection sets highlightKey on the matching unit only",
      },
      {
        file: "tests/lens/scores/flower.test.ts",
        name: "reads the zone's own ecoregion-rescaled metrics",
      },
      { file: "tests/lens/scores/selection.test.ts", name: "zone:<unit>:<key>" },
    ],
  },
  "S-13": {
    match: "Nothing selected: flower from boot.flower_default",
    status: "done",
    diffs: ["ID-08"],
    evidence: [
      { file: "tests/lens/scores/flower.test.ts", name: "reads boot.flower_default[zoneAllKey]" },
      { file: "tests/lens/scores/flower.test.ts", name: "nothing selected: All US waters" },
      {
        file: "tests/lens/scores/flower.test.ts",
        name: "v7's real flower_default.FULL (8 components, Other included)",
      },
      {
        file: "tests/lens/scores/boot.test.ts",
        name: "prefers FULL when present among subregion keys",
      },
      { file: "e2e/scores.flower.spec.ts", name: "nothing selected: the default flower" },
      {
        file: "e2e/scores.flower.spec.ts",
        name: "every one of GAA's real 8 components draws a visible petal",
      },
    ],
    note:
      "fixes the Shiny app's unversioned CSV: the default flower is this release's own " +
      "`flower_default`. atlas-4 fix round 2 (owner-reported defect, 2026-09-24): the PREVIOUS " +
      "evidence here (`e2e/scores.firstpaint.spec.ts`'s hub-value check) ran against a " +
      "simplified 3-component fixture and so could never have caught the real live bug (v7's " +
      "real flower_default.FULL has 8 components, 5 of which the hub circle covered entirely) " +
      "-- a check that cannot fail is not a check. `e2e/scores.flower.spec.ts` now runs against " +
      "the REAL 8-component v7 fixture (and a selected zone's own real 8-component flower) and " +
      "probes each petal's own on-screen centroid via `document.elementFromPoint`, which is what " +
      "actually caught the bug (see flowerGeometry.ts's header for the root cause).",
  },
  "S-14": {
    match: "Flower centre = round(mean(score))",
    status: "done",
    diffs: ["ID-09"],
    evidence: [
      {
        file: "tests/lens/scores/flower.test.ts",
        name: "computeFlowerGeometry draws 7 petals with centre = round(mean of those 7)",
      },
      {
        file: "tests/ui/flowerGeometry.test.ts",
        name: "computeFlowerGeometry: petal count (7 vs 8, parity scores app.md:826-830)",
      },
      {
        file: "tests/ui/categories.test.ts",
        name: "has a row for every category key the parity doc lists",
      },
      {
        file: "tests/lens/scores/flower.test.ts",
        name: "atlas-4 fix round 2: every real component resolves to a defined color and a real petal",
      },
      {
        file: "e2e/scores.flower.spec.ts",
        name: "v7's default flower: no petal's accessible name reads 'No data' for a real component",
      },
    ],
    note:
      "fixes the grey `primary producer` petal; on v8/v9 the two published primary-producer " +
      "keys are folded into one slot rather than throwing. atlas-4 fix round 2 (owner-reported " +
      "defect, 2026-09-24): the PREVIOUS evidence here included `e2e/gallery.spec.ts`'s " +
      '"#flower-eight has exactly 8 distinct petal categories (colors)", which reads ' +
      "`getComputedStyle(path).fill` on each petal DIRECTLY and so passed even while the hub " +
      "circle covered 5 of the 8 real petals -- every fill was genuinely defined and distinct, " +
      "just painted over. That check stays in the suite (still a true, if too weak, assertion) " +
      "but is no longer cited as evidence here; `e2e/scores.flower.spec.ts` replaces it with a " +
      "real occlusion-aware probe (petal geometry -> on-screen centroid -> " +
      "`document.elementFromPoint`), plus a unit test on the real v7/v9 fixtures asserting every " +
      'component resolves to a defined, non-"no data" color AND a petal whose annular band ' +
      "clears the shared hub.",
  },
  "S-15": {
    match: "Headers and filename stems exactly as §7.3",
    status: "partial",
    evidence: [
      { file: "tests/lens/scores/species.test.ts", name: "cell: species_cellid-{id}" },
      {
        file: "tests/lens/scores/species.test.ts",
        name: "zone: species_{unit}-{lowercased name, first space -> '-'}",
      },
      {
        file: "tests/lens/scores/species.test.ts",
        name: "nothing selected: species_{zone_all_key}",
      },
      { file: "tests/lens/scores/species.test.ts", name: "stem_YYYY-MM-DD.csv" },
      {
        file: "tests/lens/scores/species.test.ts",
        name: "writes the UNFORMATTED value, not a display string (0.5, never '50%')",
      },
    ],
    note: "every rule is pinned, but the plan's byte-for-byte gate (the GAA Program-Area CSV on v7 against the R fixture) was never built (known gap G-04); and the zone stem uses the zone key where a name is missing (G-01).",
  },
  "S-16": {
    match: "Columns in order: cat, taxon, scientific",
    status: "partial",
    evidence: [
      { file: "tests/lens/scores/species.test.ts", name: "er_score: 0dp percent" },
      { file: "tests/lens/scores/species.test.ts", name: "avg_suit/pct_cat: 2dp percent" },
      { file: "tests/lens/scores/species.test.ts", name: "area_km2: 4 significant figures" },
      {
        file: "e2e/gallery.spec.ts",
        name: "DataTable: a header click sets aria-sort, and it toggles asc -> desc -> none",
      },
      {
        file: "e2e/gallery.spec.ts",
        name: "DataTable: arrow keys move the roving-tabindex active cell",
      },
      {
        file: "e2e/gallery.spec.ts",
        name: "DataTable: a numeric column sorts numerically, not as strings ('9%' before '10%')",
      },
    ],
    note: "the number formats, per-column filter, sort and keyboard cell navigation are asserted; the COLUMN ORDER itself is declared in `SpeciesTable.svelte` and has no test of its own (known gap G-05).",
  },
  "S-17": {
    match: "taxon links: BOTW",
    status: "done",
    evidence: [
      { file: "tests/lens/scores/species.test.ts", name: "BOTW authority -> birdsoftheworld.org" },
      { file: "tests/lens/scores/species.test.ts", name: "anything else -> WoRMS aphia.php" },
      {
        file: "tests/lens/scores/species.test.ts",
        name: "modelSelPatch switches lens + sp + in=merged, resets out to the species default",
      },
      {
        file: "tests/lens/scores/species.test.ts",
        name: "modelHref keeps place/camera, resolves to the species lens with the given sp",
      },
    ],
    note: 'both link rules and the in-place lens switch are pinned. "Modifier-click opens a new tab" is the browser\'s own behaviour for the real `<a href>` `modelHref` produces (`modelSelPatch` handles the plain click); no test presses ⌘/Ctrl.',
  },
  "S-18": {
    match: "The column glossary modal including the ER rule",
    status: "done",
    evidence: [
      {
        file: "tests/lens/scores/glossary.test.ts",
        name: "has exactly these nine rows, in this exact order, with these exact weights",
      },
      {
        file: "tests/lens/scores/glossary.test.ts",
        name: "NMFS/FWS EN is 100, not 99 (the seeded-fault case this test pins)",
      },
      {
        file: "tests/lens/scores/glossary.test.ts",
        name: "has one row per species-table column, each with a non-empty definition",
      },
    ],
  },
  "S-19": {
    match: "Composition treemap over app/taxonomy.parquet",
    status: "partial",
    evidence: [
      {
        file: "tests/lens/scores/composition.test.ts",
        name: "groups by category, counting ONE per row (each row is one species, sql/composition.sql)",
      },
      {
        file: "tests/lens/scores/composition.test.ts",
        name: "real v7 fixture (zone HAR, 478 species): box values are EXACTLY the per-category species counts",
      },
      {
        file: "tests/lens/scores/composition-valueLabel.test.ts",
        name: "REGRESSION: passes the exact current phrase, matching the count-based measure it now renders",
      },
      {
        file: "e2e/gallery.spec.ts",
        name: "Treemap: every cell is keyboard-reachable and individually named",
      },
      {
        file: "e2e/gallery.spec.ts",
        name: "Treemap: an empty dataset shows the empty state, not a blank chart",
      },
    ],
    note: 'the treemap is ONE level (species category), not the six WoRMS ranks the Shiny app drew (G-06). The two copy defects reported as G-23 (the summary line\'s mislabelled number, and the stale "bird not added" note) were fixed in 0.10.19 — see tests/ui/treemapLayout.test.ts and tests/lens/scores/composition-note.test.ts. Owner decision R8 (2026-09-24, atlas-4 fix round 2): boxes are now sized by SPECIES COUNT (`compositionTree()`\'s default `measure: "count"`), matching the ported Shiny app — the prior default (`suit_er_area`, suitability x extinction-risk x area) drew a real selection\'s Mammal box as the largest even though Shiny (sizing by count) draws it small; that measure is kept as an internal, not-yet-exposed option. `valueLabel` updated to "n species" accordingly (composition-valueLabel.test.ts).',
  },
  "S-20": {
    match: "Cell species unavailable",
    status: "deferred",
    evidence: NO_TEST,
    note: "neither lens reads `capabilities.cell_model`; on a release that does not publish cell-level species the header would not say so. The places panel DOES honour the same capability (`tests/places/results.test.ts`). Known gap G-07.",
  },
  "S-21": {
    match: "Release picker modal; welcome modal",
    status: "partial",
    evidence: [
      {
        file: "e2e/scores.welcome.spec.ts",
        name: "shows on first paint; 'don't show again' persists across a reload",
      },
      {
        file: "e2e/scores.welcome.spec.ts",
        name: "Take a tour announces (no real tour this phase); hidden when ?tour=off",
      },
      {
        file: "e2e/scores.versionPicker.spec.ts",
        name: "?ver=v9: with VITE_PREVIEW_ATLAS_ROUTE unset, no /atlas/ preview link renders -- the honest fallback (Scores/Species) does instead (round 2, Q4)",
      },
      {
        file: "e2e/scores.versionPicker.spec.ts",
        name: "the version chip opens the SAME modal for a manual look, listing every release",
      },
    ],
    note: "release picker (with D15's preview-host link, gated round 2 Q4 on VITE_PREVIEW_ATLAS_ROUTE until atlas-9 deploys the route -- see previewLink.ts), welcome modal and `tour=off` are done. The driver.js guided tour over the old ten steps is NOT built — the button announces that instead (known gap G-08).",
  },
  "S-22": {
    match: "Zones table: every zone of the unit ranked",
    status: "done",
    evidence: [
      {
        file: "tests/lens/scores/zonesTable.test.ts",
        name: "ranks by the current layer, descending, and equals boot.zones' own metrics exactly",
      },
      {
        file: "tests/lens/scores/zonesTable.test.ts",
        name: "unpublished values sort last regardless of direction",
      },
      {
        file: "tests/report/windowOpenSync.wiring.test.ts",
        name: "TablePanel.svelte's onReportSelected()",
      },
    ],
    note: 'new in the atlas (ID-13): the keyboard/screen-reader equivalent of the choropleth, and the "report on selected" entry point. The ROWS equal `boot.zones` exactly — but the score column is headed by the metric\'s full published label, which wraps the header open and pushes the rows out of view (G-24, visible in the screenshot pair).',
  },

  // ---------------------------------------------------------------- atlas-5 · species lens
  "P-01": {
    match: "Options grouped by sp_cat",
    status: "done",
    evidence: [
      { file: "tests/lens/species/picker.test.ts", name: "builds the option label of 5.4" },
      {
        file: "tests/lens/species/picker.test.ts",
        name: "is sorted by sp_cat then label, and groups into optgroups in that order",
      },
      {
        file: "tests/lens/species/picker.test.ts",
        name: "KEEPS a selection that is in both lists when the checkbox flips",
      },
      {
        file: "tests/lens/species/picker.test.ts",
        name: "is Dermochelys coriacea among the US-valid taxa",
      },
      {
        file: "e2e/species.smoke.spec.ts",
        name: "fix round 3 #1: ticking 'US only' on a non-US selection falls back to the default (keeps a shared one)",
      },
    ],
  },
  "P-02": {
    match: "Client-side search over",
    status: "done",
    evidence: [
      {
        file: "tests/lens/species/picker.test.ts",
        name: "matches a diacritic-free query against a diacritic name",
      },
      {
        file: "tests/lens/species/picker.test.ts",
        name: "searches the scientific AND the common name",
      },
      { file: "tests/lens/species/picker.test.ts", name: "is 900 ms by default" },
      {
        file: "tests/lens/species/picker.test.ts",
        name: "never logs under 3 folded characters, even after the debounce fires",
      },
      {
        file: "tests/lens/species/picker.test.ts",
        name: "REGRESSION: never logs the same query as the immediately preceding logged one",
      },
      {
        file: "e2e/gallery.spec.ts",
        name: "DataTable: only a bounded window of rows is ever in the DOM, even with 10,000 rows",
      },
    ],
    note: "the list is windowed through the shared DataTable's virtualization (the gallery spec in the Evidence column is that component's own gate).",
  },
  "P-03": {
    match: "Selectable scientific (italic) and common names",
    status: "partial",
    evidence: NO_TEST,
    note: "built in `SpeciesTitle.svelte` with the `execCommand('copy')` fallback and the 1.2 s ✓/✗ flash, but nothing asserts it (known gap G-09).",
  },
  "P-04": {
    match: "Bar is green (is-merged) or orange",
    status: "done",
    evidence: [
      {
        file: "tests/lens/species/layerBar.test.ts",
        name: "is merged (green) for the merged model",
      },
      {
        file: "tests/lens/species/layerBar.test.ts",
        name: "is input (orange) with 'Viewing input: {name}' and a way back",
      },
      {
        file: "tests/lens/species/layerBar.test.ts",
        name: "counts the shard's edges, not a dataset count",
      },
      {
        file: "tests/lens/species/layerBar.test.ts",
        name: "a SINGLE-input taxon yields n = 1, never undefined",
      },
    ],
  },
  "P-05": {
    match: "One pill per input in dataset.sort_order",
    status: "partial",
    evidence: [
      {
        file: "tests/lens/species/layerBar.test.ts",
        name: "are the merged model plus one per input, in dataset.sort_order",
      },
      {
        file: "tests/lens/species/layerBar.test.ts",
        name: "an input with no published surface is struck through, with the title that says why",
      },
      {
        file: "e2e/species.smoke.spec.ts",
        name: "a struck-through pill is not focusable-as-button and carries the reason as its title",
      },
    ],
    note: "the phone fold (`{N} layers ▾`) is implemented in `layerBar.ts` but has no test of its own (known gap G-09).",
  },
  "P-06": {
    match: "Representation toggle only when an input has two",
    status: "done",
    evidence: [
      {
        file: "tests/lens/species/layerBar.test.ts",
        name: "is available only when the input publishes both representations",
      },
      {
        file: "tests/lens/species/layerBar.test.ts",
        name: "is relabelled Delivered / As ingested when dataset.on_grid (AquaX, v9)",
      },
      {
        file: "tests/lens/species/layerBar.test.ts",
        name: "carries the four tooltips of section 7.2, verbatim",
      },
    ],
  },
  "P-07": {
    match: "Outlines select: Program Areas (white) / Ecoregions",
    status: "deferred",
    diffs: ["ID-10", "ID-11"],
    evidence: NO_TEST,
    note: "none of the species map's chrome is built: the Outlines select, Program-Area labels and hover tooltip, the globe minimap, fullscreen / navigation / scale, the Nominatim geocoder, the layers control and \"Zoom to layer\" (known gap G-02). Globe↔mercator IS in the URL and in the style. `out=` reaches the rendered style on both lenses since 0.10.19 (G-25, fixed) — but the species lens DEFAULTS to `out=none`, so a plain species link draws no outline where Shiny defaulted to Ecoregions; `out=programarea` draws the release's one unit, white, same as the scores lens (ID-11).",
  },
  "P-08": {
    match: "COG branch: titiler tiles with the asset's own colormap",
    status: "done",
    evidence: [
      {
        file: "tests/lens/species/mapInputs.test.ts",
        name: "the merged model: titiler tile with its own colormap/rescale, opacity 0.8",
      },
      {
        file: "tests/lens/species/mapInputs.test.ts",
        name: "AquaX 'Delivered' (native) representation carries rescale=0,1000 — the AquaX gate",
      },
      {
        file: "tests/lens/species/mapInputs.test.ts",
        name: "AquaX 'As ingested' (model) representation carries rescale=1,100",
      },
      {
        file: "e2e/species.smoke.spec.ts",
        name: "an AquaX 'Delivered' (native) tile URL carries rescale=0,1000 (the AquaX gate)",
      },
    ],
  },
  "P-09": {
    match: "PMTiles branch: fill #3388ff",
    status: "partial",
    evidence: [
      {
        file: "tests/map/ranges.test.ts",
        name: "fills #3388ff at 0.5, filtered to the asset's mdl_key, verbatim (§6.2)",
      },
      {
        file: "tests/map/ranges.test.ts",
        name: "registers a vector source through the pmtiles:// protocol",
      },
      {
        file: "tests/lens/species/mapInputs.test.ts",
        name: "fill #3388ff at 0.5, source-layer + mdl_key filter from the asset, categorical legend",
      },
      {
        file: "e2e/species.smoke.spec.ts",
        name: "a range draws >= 1 rendered feature (the PMTiles branch, real vector data)",
      },
    ],
    note: "the branch draws real vector features from the published PMTiles; the `capabilities.pmtiles_s3` PREFERENCE (S3 copy over file.marinesensitivity.org) is not implemented — the app uses the URL the shard gives it (known gap G-10).",
  },
  "P-10": {
    match: "merged.type = null",
    status: "done",
    evidence: [
      {
        file: "tests/lens/species/mapInputs.test.ts",
        name: "merged: null -> the notice, no raster, no range (the ~192 residual taxa)",
      },
      {
        file: "tests/lens/species/card.test.ts",
        name: "is the notice production shows, and only for a taxon with merged: null",
      },
      {
        file: "tests/lens/species/shards.test.ts",
        name: "merged: null is a VALUE (no published surface), not a schema violation",
      },
    ],
  },
  "P-11": {
    match: "Camera: fit to merged.bbox",
    status: "partial",
    diffs: ["ID-12"],
    evidence: [
      {
        file: "tests/lens/species/camera.test.ts",
        name: "passes an unwrapped frame through UNCHANGED (xmax may exceed 180)",
      },
      {
        file: "tests/lens/species/camera.test.ts",
        name: "every fitted span is < 200 deg and every centre lies inside the model's own longitudes",
      },
      { file: "tests/lens/species/camera.test.ts", name: "an input uses its OWN extent" },
      {
        file: "tests/lens/species/camera.test.ts",
        name: "is FALSE on a layer switch (section 11.9: compare two models at one camera)",
      },
      {
        file: "tests/lens/species/camera.test.ts",
        name: "with no extent at all, the study area frames US waters — never the globe",
      },
    ],
    note: "the camera rule is done and gated on 50 REAL v9 extents — but the published bboxes do not support it as written: v7 publishes NONE (16,153 null) and 5,053 of v9's span > 300° because they are written wrapped. So a v7 species frames the study area rather than its own range, where the Shiny app computed `mdl_bbox()` per model (ID-12, known gap G-11).",
  },
  "P-12": {
    match: "Switching layers removes source and layer together",
    status: "done",
    evidence: [
      {
        file: "tests/map/ranges.test.ts",
        name: "removing the range removes exactly that layer — nothing cascades",
      },
      {
        file: "tests/map/ranges.test.ts",
        name: "a raster and a range can coexist (switching representation never leaves a stale layer)",
      },
      {
        file: "e2e/species.smoke.spec.ts",
        name: "switching species twice before the map's first idle leaves the SECOND species' raster in sources (fix round 1)",
      },
    ],
  },
  "P-13": {
    match: "cellFromLonLat with the release's grid",
    status: "done",
    diffs: ["ID-16"],
    evidence: [
      { file: "tests/grid/grid.test.ts", name: "cellFromLonLat (msens::cell_from_lonlat)" },
      { file: "tests/raster/point.test.ts", name: "builds {host}/cog/point/{lon},{lat}?url=<enc>" },
      {
        file: "tests/raster/point.test.ts",
        name: "rejects a scores-domain request before ever calling fetchJson (seeded fault)",
      },
      {
        file: "tests/lens/species/popup.test.ts",
        name: "a range click reports 'presence only', swatch = the range fill color",
      },
      {
        file: "tests/lens/species/popup.test.ts",
        name: "probe 5 — off-grid: the click never resolved a cell id, so no /cog/point call is made",
      },
    ],
    note: "fixes the hard-coded 7200/3600 grid, which was wrong for every v1–v7 release.",
  },
  "P-14": {
    match: "Popup opens on the first click",
    status: "done",
    evidence: [
      {
        file: "tests/lens/species/popup.test.ts",
        name: "§6.5's name/cell/lon/lat/value shape, swatch colored, text contrast applied",
      },
      {
        file: "tests/lens/species/popup.test.ts",
        name: "the exact 0.5 threshold, PAIRED on both sides (fix round 3 #3)",
      },
      {
        file: "tests/lens/species/popup.test.ts",
        name: "a numeric value bins against the asset's OWN rescale, not a hard-coded [1,100]",
      },
      {
        file: "e2e/species-popup.spec.ts",
        name: "species popup text clears 4.5:1 contrast against its background",
      },
    ],
  },
  "P-15": {
    match: "Common name, Category, ESA Listing",
    status: "done",
    evidence: [
      {
        file: "tests/lens/species/card.test.ts",
        name: "has common name, category, ESA, IUCN and the WoRMS link",
      },
      {
        file: "tests/lens/species/card.test.ts",
        name: "maps the status to a reviewer-legible label, code kept in parentheses; source named once, in the fact's label",
      },
      {
        file: "tests/lens/species/card.test.ts",
        name: "is the merged node with '(IUCN masked)' and every input beneath it",
      },
      {
        file: "tests/lens/species/card.test.ts",
        name: "exists only when the taxon has an rng_iucn input, with (required) on it",
      },
      {
        file: "tests/lens/species/card.test.ts",
        name: "marks the layer on screen active and an input with no surface as not-a-link",
      },
    ],
  },
  "P-16": {
    match: "?mdl_key= (merged or raw input) and ?mdl_seq=",
    status: "done",
    evidence: [
      {
        file: "tests/lens/species/resolve.test.ts",
        name: "resolves through the alias shard to (sp, in) and logs resolution=input_model",
      },
      {
        file: "tests/lens/species/resolve.test.ts",
        name: "an integer id resolves to the v7 merged key",
      },
      {
        file: "tests/lens/species/resolve.test.ts",
        name: "clearUs is true for a taxon that is not valid_usa",
      },
      {
        file: "tests/lens/species/resolve.test.ts",
        name: "is not-found, with the two explanations of section 4",
      },
      {
        file: "tests/lens/species/resolve.test.ts",
        name: "rewrites a legacy input link to sp + in, dropping the legacy key",
      },
      {
        file: "e2e/species.smoke.spec.ts",
        name: "?mdl_seq=<int> on v7 lands on the right taxon and input (the merged model)",
      },
      {
        file: "e2e/species.smoke.spec.ts",
        name: "?mdl_key=am|... on v9 lands on the right taxon AND selects that input",
      },
    ],
  },
  "P-17": {
    match: "No merged-surface flash",
    status: "partial",
    evidence: [
      {
        file: "e2e/species.smoke.spec.ts",
        name: "switching species twice before the map's first idle leaves the SECOND species' raster in sources (fix round 1)",
      },
    ],
    note: 'the underlying cause (a queued style outliving a later apply) is fixed and pinned in `styleQueue.ts`; the deep-linked-input "jigger" itself was verified by hand during atlas-5, never turned into its own spec (known gap G-09).',
  },
  "P-18": {
    match: "Document title",
    status: "done",
    evidence: [
      {
        file: "tests/lens/species/card.test.ts",
        name: "names the taxon, its category, the key on screen and the layer",
      },
      {
        file: "tests/lens/species/card.test.ts",
        name: "uses the INPUT's mdl_key and name when an input is on screen",
      },
      { file: "tests/lens/species/card.test.ts", name: "omits the common name when there is none" },
    ],
    note: 'the suffix is "| Marine Sensitivity"; the Shiny app\'s is "| BOEM Marine Sensitivity" (ID-14).',
    diffs: ["ID-14"],
  },
  "P-19": {
    match: "Welcome modal, release picker, tour",
    status: "partial",
    evidence: [
      {
        file: "e2e/scores.welcome.spec.ts",
        name: "shows on first paint; 'don't show again' persists across a reload",
      },
      {
        file: "e2e/scores.versionPicker.spec.ts",
        name: "the version chip opens the SAME modal for a manual look, listing every release",
      },
      {
        file: "e2e/shell.url-state.spec.ts",
        name: "an explicit theme choice writes a real value (not a default-value bug)",
      },
      {
        file: "tests/lens/species/resolve.test.ts",
        name: "has exactly the shape events.ts types for deeplink_mdl_key",
      },
    ],
    note: "welcome modal, release picker and the theme toggle are shared shell chrome and done. The five-step tour is not built (G-08) and three of the ten analytics events are not emitted (G-12).",
  },
  "P-20": {
    match: "Port obis_h3t_sql()",
    status: "deferred",
    evidence: NO_TEST,
    note: "the OBIS occurrence overlay is not built at all (known gap G-13). The Shiny species app has it behind its own toggle.",
  },
  "P-21": {
    match: 'Share (copy link) and "Download this layer"',
    status: "partial",
    evidence: [{ file: "tests/lens/species/mapInputs.test.ts", name: "pickAsset" }],
    note: "both controls are built in `SpeciesCardView.svelte` over the drawn asset `pickAsset` resolves; neither has its own test (known gap G-09).",
  },
  "P-22": {
    match: "With a place active, its outline stays on the map",
    status: "partial",
    evidence: [
      {
        file: "e2e/places.spec.ts",
        name: "keyboard-only: Enter coordinates creates a place, rename, then remove -- drawing is never the only way",
      },
    ],
    note: "`Shell.svelte` composes the places selection into the ONE style for BOTH lenses (the input is not lens-conditional), so a lens switch structurally cannot remove it, and the places e2e walk exercises the layer in a real browser — but no spec switches lens with a place active (known gap G-09).",
  },

  // ---------------------------------------------------------------- atlas-7 · report
  "R-01": {
    match: "Order: title + timestamp",
    status: "done",
    evidence: [
      {
        file: "e2e/report.spec.ts",
        name: "two Program Areas: header, table of scores and per-place flowers all render",
      },
      {
        file: "e2e/report.spec.ts",
        name: "headings are hierarchical (one h1, every section a h2)",
      },
      { file: "tests/lib/report/model.test.ts", name: "the release chip is ver · status · access" },
    ],
  },
  "R-02": {
    match: "Multiple areas → tab-set",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/scores.test.ts",
        name: "keeps the places in the order given -- no sorting, no row limit (report.qmd:326-349)",
      },
      {
        file: "tests/lib/report/model.test.ts",
        name: "splits keys, names them 'Full Name (KEY)' from boot (P3: paLabel), and re-encodes a one-key token each",
      },
      {
        file: "e2e/report.spec.ts",
        name: "two Program Areas: header, table of scores and per-place flowers all render",
      },
    ],
    note: "tabs on screen, sequential in print (the print stylesheet flattens them).",
  },
  "R-03": {
    match: "All static narrative from §2 present",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/narratives.test.ts",
        name: "item 1: the four static section narratives",
      },
      {
        file: "tests/lib/report/narratives.test.ts",
        name: "names exactly this release's components, and neither 'reptile' nor 'other'",
      },
      {
        file: "tests/lib/report/narratives.test.ts",
        name: "SEEDED FAULT: a hardcoded 'reptile, other' component list is exactly what this test catches",
      },
    ],
    note: "the stale category sentence is corrected AND derived from the release, so it cannot go stale again.",
  },
  "R-04": {
    match: "Empty-area case prints",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/model.test.ts",
        name: "a place whose species query RAN and found none shows §6c's sentence",
      },
      {
        file: "tests/lib/report/model.test.ts",
        name: "a place with no species yet shows neither the tables nor the empty-case string",
      },
      {
        file: "tests/lib/report/er.test.ts",
        name: "an empty place gives an empty table, not a throw",
      },
    ],
  },
  "R-05": {
    match: "For each of the 20 v9 Program Areas the 8 component scores",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "reproduces every published component and its post/pre coverage within 1e-9",
      },
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "every component score survives the model untouched (1e-9)",
      },
      {
        file: "tests/lens/scores/zonesTable.test.ts",
        name: "ranks by the current layer, descending, and equals boot.zones' own metrics exactly",
      },
      {
        file: "tests/fixtures/parity-e2e/e2e/parity.spec.ts",
        name: "every SQL twin answers msens's numbers inside DuckDB-WASM, CDN blocked",
      },
    ],
    note: "a zone place's components are the published `zone_metric` values themselves, and every zone of the unit is asserted equal to them; the R-fixture comparison at 1e-9 covers GAA plus a drawn Gulf rectangle and the Aleutian polygon on v7 AND v9, not all 20 areas one by one.",
  },
  "R-06": {
    match: "Overall = unweighted mean",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "Overall equals msens::mean_score() within 1e-9",
      },
      {
        file: "tests/lib/report/scores.test.ts",
        name: "is the unweighted mean, whatever the coverages are",
      },
      {
        file: "tests/lib/report/faults.test.ts",
        name: "fault 3 -- Overall as a weighted mean (by coverage) instead of a plain one",
      },
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "the flower's centre is the table's Overall, rounded",
      },
    ],
  },
  "R-07": {
    match: "N cells for a PRA",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "N cells and area are the D7b-clipped ones R computed",
      },
      {
        file: "tests/lib/report/model.test.ts",
        name: "a custom place reports its vertex count, bbox, area, N cells and token",
      },
      {
        file: "tests/lib/report/faults.test.ts",
        name: "the clipped set gives R's N cells and R's share inside the study area",
      },
    ],
    note: "for a ZONE place `N cells` and area come from `boot.zones[*].n_cells/area_km2` (the same `zone_cell` count); for a custom place they are the D7b-clipped counts R produced.",
  },
  "R-08": {
    match: "A drawn polygon exactly tracing a Program Area reproduces",
    status: "intentional-difference",
    diffs: ["ID-01", "ID-02"],
    evidence: [
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "a ZONE place reports the PUBLISHED zone_metric composite, exactly",
      },
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "the SAME area traced as a custom place reads ~0.05 higher, and the fixture says which is which",
      },
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "the D7b clip is visible in the trace: fewer cells than the geometry touched",
      },
      {
        file: "tests/analysis/studyAreaClip.test.ts",
        name: "n_cells_sa < n_cells: the touched-but-outside cells are dropped",
      },
    ],
    note: "the pct-area down-weight of §3.5 IS applied (D7), so the two methods agree to within 0.1 — but not exactly: clipping the traced place to US waters (D7b) leaves it ~0.05 above the published Area (+0.0498 on v9 GAA, +0.0076 on v7). Both numbers are asserted against R, and the report states which path produced the number.",
  },
  "R-09": {
    match: "Species counts per PRA match zone_taxon",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "the species counts table matches R EXACTLY (columns, every cell, both totals)",
      },
      { file: "tests/lib/report/numbers.test.ts", name: "N species matches n_distinct(mdl_key)" },
      {
        file: "tests/lib/report/er.test.ts",
        name: "N species is n_distinct(mdl_key) -- a model listed twice counts once",
      },
    ],
  },
  "R-10": {
    match: "er_consolidate() reproduced exactly",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/er.test.ts",
        name: "erConsolidate -- one case per arm of report_area_child.qmd:47-56",
      },
      {
        file: "tests/lib/report/er.test.ts",
        name: "null and undefined take the SAME path as the literal 'NA' R rewrites them to",
      },
      {
        file: "tests/lib/report/er.test.ts",
        name: "the Total ROW is the column sums, and its own total is the grand total",
      },
      {
        file: "tests/lib/report/faults.test.ts",
        name: "fault 1 -- er_consolidate maps one code wrong (IUCN:VU -> IUCN:NT(2))",
      },
    ],
  },
  "R-11": {
    match: "Top-20 sorted by suit_er_area",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/species.test.ts",
        name: "sorts by suit_er_area DESCENDING and takes the first N",
      },
      {
        file: "tests/lib/report/species.test.ts",
        name: "is not avg_suit: the two columns rank differently and only one is the Score",
      },
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "the top 20 is in R's EXACT order, with R's numbers",
      },
      {
        file: "tests/lib/report/format.test.ts",
        name: "formatErScore -- a 0-1 fraction as an integer percent",
      },
      {
        file: "tests/lib/report/faults.test.ts",
        name: "fault 4 -- the top 20 sorted by the wrong column (avg_suit, not suit_er_area)",
      },
    ],
  },
  "R-12": {
    match: "avg_suit = Σ(val·pct)",
    status: "done",
    evidence: [
      {
        file: "tests/analysis/sqlTwins.test.ts",
        name: "scores divide by the study-area weight (w_all), not by the present weight (w_present)",
      },
      {
        file: "tests/analysis/sqlTwins.test.ts",
        name: "scores and species read the SAME clipped cell set (D7b)",
      },
      {
        file: "tests/fixtures/parity-e2e/e2e/parity.spec.ts",
        name: "every SQL twin answers msens's numbers inside DuckDB-WASM, CDN blocked",
      },
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "the full species list (the CSV's rows) is in R's EXACT order",
      },
    ],
  },
  "R-13": {
    match: "Eligibility: is_valid_usa AND is_marine",
    status: "partial",
    evidence: [
      {
        file: "tests/analysis/sqlTwins.test.ts",
        name: "${f} names its R twin and the fixture that pins it",
      },
      {
        file: "tests/fixtures/parity-e2e/e2e/parity.spec.ts",
        name: "every SQL twin answers msens's numbers inside DuckDB-WASM, CDN blocked",
      },
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "the species counts table matches R EXACTLY (columns, every cell, both totals)",
      },
    ],
    note: "the eligibility filter lives in `sql/species_for_cells.sql`, whose answers are diffed against msens at 1e-9 — so a changed filter turns the parity gate red. No test names the three conditions literally (known gap G-05).",
  },
  "R-14": {
    match: "If any raw metric is recomputed",
    status: "done",
    evidence: [
      {
        file: "tests/analysis/sqlTwins.test.ts",
        name: "reads the component layers out of boot, never a constant list",
      },
      {
        file: "tests/analysis/queries.test.ts",
        name: "a component (_ecoregion_rescaled) or raw metric_key works the same as the composite",
      },
    ],
    note: "conditional line: the atlas recomputes NO raw metric. It reads the published `*_ecoregion_rescaled` values, so the `er_mode` rule stays where it is applied — in msens, at publish time.",
  },
  "R-15": {
    match: "Ecoregion rescale blends across multi-ecoregion cells",
    status: "partial",
    evidence: NO_TEST,
    note: "same construction as R-14: the `norm_pct` blend happens in msens at publish time and the atlas reads the published column, so nothing here re-implements (or re-tests) it. Verified once against the published values during atlas-1, not by a gate in this repo (known gap G-14).",
  },
  "R-16": {
    match: "Map: Spectral reversed (red = high)",
    status: "done",
    evidence: [
      {
        file: "tests/report/reportMap.test.ts",
        name: "interpolates over the given domain, not a fixed 0-100",
      },
      {
        file: "tests/lib/report/model.test.ts",
        name: "a one-place report's ramp is widened ±0.5 -- never a zero-width domain",
      },
      { file: "tests/lib/report/model.test.ts", name: "the legend is the old report's own title" },
      {
        file: "tests/report/pointOnSurface.test.ts",
        name: "falls back to a boundary vertex for a concave (C-shaped) ring whose centroid falls outside it",
      },
      {
        file: "tests/report/rampDomainFromPlaces.wiring.test.ts",
        name: "the map's color domain comes ONLY from model.map.domain, never a release-wide rescale bound",
      },
      {
        file: "tests/lib/report/faults.test.ts",
        name: "fault 2 -- the ramp is not widened when every place agrees",
      },
    ],
  },
  "R-17": {
    match: "Flower: one petal per component",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/model.test.ts",
        name: "the centre is the TABLE's Overall, so the ring and the table cannot disagree",
      },
      {
        file: "tests/lib/report/model.test.ts",
        name: "every component keeps its slot; a null score draws nothing and never enters the mean",
      },
      {
        file: "tests/report/flowerSvg.test.ts",
        name: "resolves every petal's CSS var color to a concrete value, and draws no petal for a no-data slot",
      },
      {
        file: "tests/ui/categories.test.ts",
        name: "has a row for every category key the parity doc lists",
      },
    ],
    note: "`primary producer` has a real colour (ID-09), and the centre is ruled to be the table's Overall so the ring and the table can never disagree.",
  },
  "R-18": {
    match: "Intro links to",
    status: "intentional-difference",
    diffs: ["ID-05"],
    evidence: [
      {
        file: "tests/lib/report/model.test.ts",
        name: "the intro links to ./index.html at this release",
      },
      {
        file: "tests/lib/report/model.test.ts",
        name: "intro and in-app links are RELATIVE (CLAUDE.md's relative-base rule)",
      },
    ],
  },
  "R-19": {
    match: "Top-20 Common links to",
    status: "intentional-difference",
    diffs: ["ID-05"],
    evidence: [
      {
        file: "tests/lib/report/model.test.ts",
        name: "a top-20 row links to the Species lens in this release, relatively",
      },
    ],
  },
  "R-20": {
    match: "CSV control yields the species_for_cells()",
    status: "done",
    diffs: ["ID-15"],
    evidence: [
      {
        file: "tests/lib/report/species.test.ts",
        name: "is msens::species_for_cells()'s own frame, in its own order (spec §7)",
      },
      {
        file: "tests/report/exportFiles.test.ts",
        name: "reuses the app's own CSV columns/serializer",
      },
      {
        file: "tests/lib/report/model.test.ts",
        name: "the CSV filename carries the place, the release and the date (and PREVIEW_ when restricted)",
      },
      {
        file: "e2e/report.spec.ts",
        name: "the permalink reproduces byte-identical scores.csv/species.csv in a FRESH context",
      },
    ],
    note: "columns and order are msens's own frame; the FILENAME adds the date and a `PREVIEW_` prefix on a restricted release (ID-15), and the file is built in the browser — `GET /species.csv` with a WKT polygon in the query string is retired.",
  },
  "R-21": {
    match: "Version from versions.json",
    status: "done",
    diffs: ["ID-06"],
    evidence: [
      {
        file: "tests/release/version.test.ts",
        name: "is exactly /^v[0-9]+[a-z]?$/, source and all — the same shape as msens::atlas_resolve_ver()",
      },
      {
        file: "e2e/report.spec.ts",
        name: "public host + ?ver=v9: not one request under /v9/, falls through to latest",
      },
      {
        file: "e2e/report.spec.ts",
        name: "a restricted release on the PUBLIC host (no preview session) renders nothing to report on",
      },
      {
        file: "e2e/report.spec.ts",
        name: "a restricted release on a preview session shows the gold banner and the print watermark",
      },
    ],
    note: "an unknown or denied version falls THROUGH to `latest.txt` with the reason recorded, instead of erroring (ID-06); restricted releases are gated by `session.json`, never by a token in the URL.",
  },
  "R-22": {
    match: "v1–v7 releases work",
    status: "partial",
    evidence: [
      { file: "tests/grid/grid.test.ts", name: "cellLonLat (msens::cell_lonlat)" },
      {
        file: "tests/analysis/sqlTwins.test.ts",
        name: "v1-v7 reads mdl_seq directly and never mentions mdl_id (v7 has no such column)",
      },
      {
        file: "tests/lens/species/picker.test.ts",
        name: "v7's mdl_seq keys are ordinary index keys",
      },
      { file: "tests/lens/scores/boot.test.ts", name: "v1: planarea" },
    ],
    note: "v7 (the public release, `usa05`, `mdl_seq`) is exercised end to end in the browser suites; v1's Planning-Area shape is unit-tested but the per-version e2e matrix (v1, v2, v4b, v3) was never run — known gap G-15.",
  },
  "R-23": {
    match: "Published Parquet read with val",
    status: "done",
    evidence: [
      { file: "tests/analysis/sqlTwins.test.ts", name: "sql/*.sql: `value` never appears" },
      {
        file: "tests/analysis/sqlTwins.test.ts",
        name: "the scanner is not vacuous: it flags a seeded `value`",
      },
      { file: "tests/analysis/sqlTwins.test.ts", name: "allows the two legitimate spellings" },
    ],
  },
  "R-24": {
    match: "The whole report regenerates from the URL alone",
    status: "done",
    evidence: [
      { file: "e2e/report.spec.ts", name: "the permalink round-trips ver and pl" },
      {
        file: "e2e/report.spec.ts",
        name: "the permalink reproduces byte-identical scores.csv/species.csv in a FRESH context",
      },
      {
        file: "e2e/report.spec.ts",
        name: "the hash (place token) is absent from every request the browser makes",
      },
      {
        file: "tests/report/windowOpenSync.wiring.test.ts",
        name: "window.open() runs synchronously (no `await` before it) in both report entry points",
      },
    ],
    note: "the link IS the report: nothing in the document depends on `api.marinesensitivity.org`, and the place geometry never leaves the device.",
  },
  "R-25": {
    match: "An antimeridian polygon (Aleutians)",
    status: "done",
    evidence: [
      {
        file: "tests/geo/adoptedFixtures.test.ts",
        name: "the antimeridian convention, now settled with msens",
      },
      {
        file: "tests/geo/adoptedFixtures.test.ts",
        name: "${name} is byte-identical to the msens copy",
      },
      {
        file: "tests/lib/report/numbers.test.ts",
        name: "N cells and area are the D7b-clipped ones R computed",
      },
      {
        file: "tests/geo/knifeEdge.test.ts",
        name: "the 1e-9 snap is load-bearing, not a cosmetic tolerance",
      },
    ],
    note: "the Aleutian polygon is one of the three R fixtures the report numbers are diffed against, on v7 and v9; the unwrap rule itself is shared byte-for-byte with msens (D8 addendum).",
  },
  "R-26": {
    match: "Zero intersecting cells degrades gracefully",
    status: "partial",
    evidence: [
      {
        file: "tests/lib/report/model.test.ts",
        name: "a place with no scores yet has no components, no overall, and no map score",
      },
      {
        file: "tests/lib/report/scores.test.ts",
        name: "an empty report is an empty table, not a throw",
      },
      {
        file: "tests/lib/report/er.test.ts",
        name: "an empty place gives an empty table, not a throw",
      },
    ],
    note: "every empty shape the model can be handed is covered by a unit test; there is no end-to-end fixture of a place that intersects ZERO cells (known gap G-16).",
  },
  "R-27": {
    match: "HTML is self-contained and prints cleanly",
    status: "done",
    diffs: ["ID-04"],
    evidence: [
      {
        file: "tests/report/exportHtml.test.ts",
        name: "is a single self-contained document: no <link> or external <script>",
      },
      {
        file: "e2e/report.spec.ts",
        name: "Download HTML opens OFFLINE (context.offline) and shows map, flowers and tables",
      },
      {
        file: "tests/report/printBreakInside.test.ts",
        name: "covers table tr (the row-clipping gate)",
      },
      {
        file: "e2e/report.spec.ts",
        name: "v9 preview: place/table labels present, PREVIEW watermark present, map image not blank",
      },
      {
        file: "e2e/report.spec.ts",
        name: "the running footer: real permalink + release + page N of M on every page, no overprinted/dropped body text",
      },
    ],
    note: "\"Save as PDF\" goes through the browser's own print pipeline (ID-04): text stays selectable and searchable, and `page.pdf()`'s extracted text is what the gate asserts.",
  },
  "R-28": {
    match: "Provenance names ver",
    status: "done",
    evidence: [
      {
        file: "tests/lib/report/model.test.ts",
        name: "names the release, its status/access, the app SHA and the timestamp",
      },
      {
        file: "tests/lib/report/model.test.ts",
        name: "carries a digest for every table read, and an explicit null for one boot does not publish",
      },
      { file: "tests/lib/report/model.test.ts", name: "quotes the SQL that ran, verbatim" },
      {
        file: "tests/lib/report/model.test.ts",
        name: "the Reproduce-in-R snippet carries the REAL token and the release's own grid",
      },
    ],
    note: 'replaces `devtools::session_info()` and adds table digests, the app SHA, the SQL that ran and a "Reproduce in R" snippet.',
  },
};

/** @type {Status[]} */
export const STATUS_ORDER = ["done", "partial", "intentional-difference", "deferred"];

/** @type {Record<Status, string>} */
export const STATUS_LABEL = {
  done: "done",
  partial: "partial",
  "intentional-difference": "intentional difference",
  deferred: "deferred",
};

/**
 * Attach the verdicts to the parsed rows.
 *
 * @param {import("./checklist-core.mjs").ChecklistRow[]} rows
 * @param {Record<string, StatusEntry>} [status] defaults to this file's own table; a test passes a
 *   small fixture table of the same shape
 * @returns {MergedRow[]}
 * @throws when an id has no entry, an entry has no row, or an entry's `match` is not in the row's
 *   own text (the positional-id drift guard described in this file's header).
 */
export function mergeStatus(rows, status = STATUS) {
  const seen = new Set();
  const merged = rows.map((row) => {
    const s = status[row.id];
    if (!s)
      throw new Error(`mergeStatus: no status entry for ${row.id} (${row.text.slice(0, 60)})`);
    if (!row.text.includes(s.match)) {
      throw new Error(
        `mergeStatus: ${row.id}'s match "${s.match}" is not in the parsed line "${row.text.slice(0, 90)}" — ` +
          "a checklist line moved; re-point the status table, do not renumber silently.",
      );
    }
    seen.add(row.id);
    return {
      ...row,
      status: s.status,
      evidence: s.evidence,
      note: s.note ?? "",
      diffs: s.diffs ?? [],
    };
  });
  const extra = Object.keys(status).filter((id) => !seen.has(id));
  if (extra.length)
    throw new Error(`mergeStatus: status entries with no checklist row: ${extra.join(", ")}`);
  return merged;
}

/**
 * The consistency rule this page is signed against: a line may not be called `done` while its
 * evidence says "no test". Returns a list of problems (empty = consistent).
 *
 * @param {{id: string, status: string, evidence?: Evidence[]}[]} rows
 * @returns {string[]} one human-readable problem per offending row
 */
export function checkConsistency(rows) {
  const problems = [];
  for (const row of rows) {
    const ev = row.evidence ?? [];
    const noTest = ev.length === 0 || ev.every((e) => e.file === "no test");
    if (row.status === "done" && noTest) {
      problems.push(`${row.id}: status "done" with no test as evidence`);
    }
    if (row.status !== "deferred" && ev.length === 0) {
      problems.push(`${row.id}: no evidence column at all (use { file: "no test" } explicitly)`);
    }
  }
  return problems;
}
