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
