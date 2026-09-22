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
