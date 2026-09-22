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
});
```

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

- **The basemap is CARTO raster** (`dark_all` / `light_all` = dark-matter / positron): one source,
  one layer, no style.json, no sprite, no TileJSON, zero added JS — the smallest option that works
  and the only one a hermetic `page.route` can serve offline. Glyphs (labels only) come from CARTO's
  own font endpoint and are declared **only** when a label layer exists.
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
range support, solid-colour basemap/titiler tiles (so a probed pixel has an exact expected value),
`blockWasm()`, and `BOOT_FIXTURE`. `e2e/hermetic.ts`'s `routeBucket()` already routes the tile
origins for every shell spec, so no spec reaches the live network by accident.

The shell publishes `window.__atlasMap = { handle, composeStyle, inputs() }` for e2e and
`scripts/verify.mjs`: compose a style from `inputs()`, apply it, assert. That is the same sequence a
lens performs, so a spec written against it is testing the real path.
