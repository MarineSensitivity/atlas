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
