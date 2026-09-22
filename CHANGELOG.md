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

# atlas 0.9.11

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
