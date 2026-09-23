# `src/lib/map` — the shared map, and what a lens may call

One MapLibre instance, one composed style, one `setStyle(diff:true)`. The scores lens (atlas-4), the
species lens (atlas-5) and places (atlas-6) all render through this module and none of them touches
MapLibre directly.

## The contract, in one paragraph

A lens **computes `composeStyle()` inputs** — plain data — and hands the result to the map handle. It
never calls `addLayer`, `addSource`, `moveLayer`, `setPaintProperty` or `setStyle`; it never
constructs a `Map`; and it never calls `fitBounds`. If a lens needs something on the map that
`composeStyle` cannot express, the fix is a new input here (with its builder and its unit test), not
a second code path in the lens.

## What a lens may call

| call                                             | from                    | what it does                                                    |
| ------------------------------------------------ | ----------------------- | --------------------------------------------------------------- |
| `composeStyle(input)`                            | `map/style.ts`          | the whole style as one object                                   |
| `handle.applyStyle(style)`                       | `map/map.ts`            | the one `setStyle(style, {diff:true})`                          |
| `handle.setProjection("globe"\|"mercator")`      | `map/map.ts`            | the imperative twin of `composeStyle({projection})`             |
| `handle.flyTo(studyArea)`                        | `map/map.ts`            | centre + zoom; never a bbox                                     |
| `handle.camera()` / `handle.resize()`            | `map/map.ts`            | current (rounded) camera; re-measure the container              |
| `mapClick(map, lngLat, point, {grid, units})`    | `map/interaction.ts`    | `{lngLat, cellId, zone}`                                        |
| `zoneAtPoint(map, point, units)`                 | `map/interaction.ts`    | hover: the zone under the cursor                                |
| `studyAreaFromBoot(boot, key)`                   | `map/interaction.ts`    | `boot.study_areas[key]`, clamped to `FULL`                      |
| `zoneUnitsFromBoot(boot)` / `zoneLabelsFromBoot` | `map/layers/zones.ts`   | `boot.units[]` → specs; `boot.zones[unit][*].label_pt` → points |
| `titilerTileTemplate(params)`                    | `map/layers/titiler.ts` | the `{z}/{x}/{y}` tile template, rescale verbatim               |
| `zoneLineStyle` / `zoneLabelStyle`               | `map/layers/zones.ts`   | the `zone_style` table, as data                                 |
| `SCORE_RASTER_OPACITY`, `OVERLAY_RASTER_OPACITY` | `map/layers/raster.ts`  | the parity constants (0.6 / 0.55)                               |

`createMap()` itself is called **once**, by the shell. A lens receives the handle.

## `composeStyle` inputs

```ts
composeStyle({
  theme, // "navy" | "paper" -> dark-matter | positron basemap + background
  projection, // "globe" (default) | "mercator"
  basemap, // omit for the theme's own; `null` for none (print)
  zones, // ZoneUnitSpec[]: outline always, `fill` and `labels` optional
  raster, // RasterLayerSpec | null: the score COG / species COG surface
  range, // RangeLayerSpec | null: a species PMTiles presence fill (atlas-5)
  overlays, // RasterLayerSpec[]: e.g. "cells outside Program Areas"
  selection, // SelectionSpec | null: the #ff00aa highlight
  basemapStyle, // override ONLY in a test: skips the network fetch, merges this instead
});
```

`composeStyle()` is deliberately **synchronous** — see "The basemap is CARTO vector" below for why
it never awaits the basemap fetch inline, and never forces a recompose the moment that fetch
resolves either.

**Adding a source** (bathymetry, OBIS occurrences, a drawn place): add a field to
`ComposeStyleInput`, a pure builder under `map/layers/`, a `LayerRole` in `LAYER_ORDER` at the depth
it belongs, and a unit test for the builder. `orderLayers()` throws on a role the table does not
name, so there is no way to add a layer without deciding where it sits.

**Layer order is declared, bottom to top:** `background · basemap · raster · range · overlay ·
zone-fill · zone-line · zone-label · selection-fill · selection-line`. Because the order is a table
rather than a chain of `before` ids, a missing layer removes exactly itself — the v1 failure where
one absent `before_id` cascaded into "a map with nothing but labels" cannot happen here.
`range` (atlas-5, `map/layers/ranges.ts`) is a species PMTiles presence fill, filtered to one
`mdl_key` — distinct from a zone unit's own PMTiles outline even though both register the same
`pmtiles://` protocol.

## Rules with teeth

- **The basemap is CARTO vector** (`dark-matter-gl-style` / `positron-gl-style`), not raster.
  CARTO's raster endpoint (the two theme-named XYZ tile hosts this file used to point at) started
  answering with an "API KEY REQUIRED" watermark tile (owner report, 2026-09-23); its vector GL
  styles are still keyless. `layers/basemap.ts#loadBasemapStyle(theme)` fetches+caches the real
  style.json once per theme; `style.ts#mergeCartoStyle()` namespaces every one of its
  sources/layers with the `basemap-` prefix (CARTO's own style.json literally has a layer id
  `"background"`, which would otherwise collide with this module's own synthetic background layer)
  and merges them whole into the "basemap" role slot, FIRST in `LAYER_ORDER`. `EMPTY_BASEMAP_STYLE`
  (no sources, no layers — just the synthetic background colour) is the in-memory fallback while a
  theme is still cold or its fetch failed, so the app never blanks. Glyphs are set whenever EITHER
  a zone label OR the basemap's own place/road labels need them (CARTO's real style always carries
  symbol layers; the minimal test fixture may not). `tests/map/no-raster-basemap.test.ts` is the
  source-scan gate that the old raster literals (`dark_all`/`light_all`) never come back.
  - **`composeStyle()` never awaits the fetch, and nothing forces an extra recompose the moment it
    resolves either** — both were tried and both measurably broke a real e2e regression test
    (`Shell.svelte`'s own header comment above its basemap-warming `onMount` has the full story):
    an EXTRA `setStyle(diff:true)` call whose timing is driven by a promise resolving via the
    browser's real network/route stack, landing at an unpredictable moment inside another
    critical window (two rapid species switches; a theme toggle), is what exposed a real
    MapLibre-level mis-ordering — not a bug in the caller, and not something
    `map/styleQueue.ts`'s "queue while `!isStyleLoaded()`" guards against (the map's first,
    source-less `blankStyle()` is trivially "loaded"). The fix: `Shell.svelte` (and
    `reportMap.ts#buildReportMapStyle`, a one-shot sequential flow with no such race) call
    `loadBasemapStyle()` themselves, ahead of time, fire-and-forget, and rely on the next
    _unrelated_ reactive change (zones/raster/selection all change within the first second of any
    real load) to pick up the by-then-warm cache — the call PATTERN into MapLibre never changes
    shape from before this fix existed.
- **Numbers never come from the tile server** (plan D4). `titiler.ts` builds _display_ tiles;
  scores, cell ids and zonal statistics come from Parquet. `tileUrlLeaksStudyArea()` is the gate that
  a study-area key never reaches a URL — the study area is a camera, not a filter.
- **No `fitBounds`, anywhere** — a bbox inverts across the antimeridian (PIS's 67.5° span reads as
  360°). `tests/map/no-fitbounds.test.ts` scans `src/lib/map` and `src/lens` and has its own seeded
  fault.
- **A cell id is arithmetic on `boot.grid`**, never a constant and never `/cog/point`: usa05 and
  global05 disagree about what `cell_id` means.
- **The camera is URL state.** `map.ts` writes it through the caller's `onCamera` (the shell's
  `selStore.set`, i.e. `history.replaceState`), rounded, de-duplicated, debounced 300 ms, and
  **never for a programmatic move** — `flyTo` tags its events `atlasProgrammatic: true`.
- **The MapLibre wiring is `docs/spikes/S2.md`'s verdict**: named imports, `?worker&url` +
  `setWorkerUrl`, `canvasContextAttributes.preserveDrawingBuffer`, `map.resize()` at construction
  (plus a `ResizeObserver` on the container afterwards). Every map spec asserts a **rendered vector
  feature** (`isSourceLoaded()` and `queryRenderedFeatures().length > 0`), because the wrong worker
  wiring paints rasters happily while silently parsing no vector tile at all.

## Testing a lens against the map

`e2e/map-hermetic.ts` has the fixtures: a real 7 KB zones PMTiles archive served with working HTTP
range support, `blockWasm()`, and `BOOT_FIXTURE`. `routeBasemapStyle()` routes the WHOLE CARTO
vector-style chain — a minimal style.json (one `background` layer + one `water` fill, both
themes), its `sources.carto` TileJSON, every `{z}/{x}/{y}.mvt` tile (a real, tippecanoe-built
tile whose "water" layer covers the whole tile, so it paints solid regardless of which tile a
probe lands on), and the sprite (`.json` + `.png`); `routeVariedBasemapStyle()` is the same chain
with a checkerboard "water" fill instead (for a spec whose own assertion is about a CAPTURED map
image needing real pixel variance, e.g. `e2e/report.spec.ts`). `routeGlyphs()` covers the font
range. `e2e/hermetic.ts`'s `routeBucket()` already calls `routeBasemapStyle()` + `routeGlyphs()`
for every shell spec, so no spec reaches the live network by accident; a spec that wants a
distinguishable score-raster pixel still registers its own, later-winning titiler route.

The shell publishes `window.__atlasMap = { handle, composeStyle, inputs() }` for e2e and
`scripts/verify.mjs`: compose a style from `inputs()`, apply it, assert. That is the same sequence a
lens performs, so a spec written against it is testing the real path.
