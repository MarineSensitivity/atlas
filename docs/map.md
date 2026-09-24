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

**Where those inputs live: a lens-level store, never panel-only UI (0.10.21).** `Panel.svelte`
renders its children only while `!geometry.collapsed` (desktop; the geometry is remembered per
viewport in `localStorage`, `src/lib/ui/panelGeometry.ts`) — `Sheet.svelte`'s phone body always
renders. Before 0.10.21 the scores lens computed its `composeStyle` contribution (`mapExtra`) inside
an `$effect` in `ScoresLens.svelte`, the panel body itself, written back to Shell.svelte through a
`bind:mapExtra` prop. Collapse the desktop panel on load (a real, reported case) and that component
never mounts at all, so `mapExtra` stays empty forever: the score raster and its floating legend
never paint, even though the map is fully visible. The fix, and the rule for every lens after it:
map inputs are a plain store (`createScoresLens()` in `src/lens/scores/state.svelte.ts`, mirroring
`src/lens/species/state.svelte.ts`) that the shell instantiates whenever the lens is selected
(`sel.lens === "scores"`), independent of which tool/panel is open or collapsed; the panel component
only reads it (a `lens` prop, not a bindable one) and renders UI. `e2e/scores.collapsed-panel.spec.ts`
is the regression gate — a desktop panel collapsed at load still paints the raster and the legend.

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
  layerStack, // R3: the user's layer stack (order + each group's visible/opacity) — see below
});
```

`composeStyle()` is deliberately **synchronous** — see "The basemap is CARTO vector" below for why
it never awaits the basemap fetch inline, and never forces a recompose the moment that fetch
resolves either.

**Adding a source** (bathymetry, OBIS occurrences, a drawn place): add a field to
`ComposeStyleInput`, a pure builder under `map/layers/`, a `LayerRole` in `LAYER_ORDER` at the depth
it belongs, and a unit test for the builder. `orderLayers()` throws on a role the table does not
name, so there is no way to add a layer without deciding where it sits.

**Layer order is declared, bottom to top:** `background · basemap-land · basemap-bathymetry ·
basemap-boundaries · basemap-roads · basemap-labels · raster · range · overlay · zone-fill ·
zone-line · zone-label · selection-fill · selection-line`. Because the order is a table rather than
a chain of `before` ids, a missing layer removes exactly itself — the v1 failure where one absent
`before_id` cascaded into "a map with nothing but labels" cannot happen here. `range` (atlas-5,
`map/layers/ranges.ts`) is a species PMTiles presence fill, filtered to one `mdl_key` — distinct
from a zone unit's own PMTiles outline even though both register the same `pmtiles://` protocol.

### The layer stack (R3, round-2 plan §5 U4 / `docs/usability.md` §7 R3)

The single "basemap" role above used to be one bucket holding every merged CARTO layer, unmovable —
so CARTO's own place/road labels always painted UNDER the score raster, invisibly. `map/layerStack.ts`
(pure, no MapLibre/Svelte) turns that fixed bucket into five sub-roles (`classifyBasemapLayer`) plus
three data groups (`raster`+`range`+`overlay` folded into `data-raster` — "the lens's data"; the
three zone roles into `data-zones`; the selection pair into `data-places`), each a `LayerGroupId` a
viewer can reorder and dim from the Layers panel (`src/lib/ui/LayersPanel.svelte`, shared by both
lenses — the panel IS the stack, its "Data" row expanding into the lens's own controls). Five lines:

1. **The model is an ordered `LayerStackEntry[]`** (`{id, visible, opacity}`), bottom-to-top —
   `DEFAULT_LAYER_STACK` is exactly today's rendering (every basemap sub-role still under the
   raster); moving `basemap-labels` above `data-raster` (Ben's example: names over a semi-
   transparent raster) is the new capability, not a change to the default view.
2. **`composeStyle({layerStack})` consumes it two ways**: `rankForStack()` expands the group order
   into the flat `LayerRole` order `orderLayers()` sorts against (background always first,
   unconditionally), and `applyLayerGroupStyling()` overrides a layer's `layout.visibility`/opacity
   paint key(s) from its group's entry — applied uniformly to every layer, basemap or data, in ONE
   pass before the one `orderLayers()`/`setStyle(diff:true)` call. Omitting `layerStack` (every
   pre-R3 caller) is a no-op on both counts — byte-identical output.
3. **`layers=` is the URL key** (`parseLayerStack`/`formatLayerStack`, called from
   `state/codec.ts`): `<id>[:h][:oNN],...`, order = draw order bottom-to-top; `:h` = hidden,
   `:oNN` = opacity NN% (01–99; 100/opacity 1 is the default and is never written); a KNOWN group
   missing from the token is appended at its default relative position (a release that adds a group
   later never orphans an old link); an unknown id is dropped; omitted entirely = the default stack.
4. **`isDefaultLayerStack()`** is the one "is this a deviation?" check both `formatLayerStack` (omit
   the key) and the panel's "Reset layers" button (disabled at the default) share.
5. **Scope note**: "places" (a drawn/picked outline) and the click-driven "selection" ring both draw
   through the SAME `selection-fill`/`selection-line` pair (one GeoJSON source), so they are ONE
   stack row (`data-places`), not two — splitting them needs a second source/layer pair, out of R3's
   scope.

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
  - **`composeStyle()` never awaits the fetch; the resolved style is an ordinary reactive input.**
    `layers/basemap.ts#warmBasemapStyles()` warms both themes on mount and reports each one;
    `Shell.svelte` holds them in `$state` and passes the active theme's to `composeStyle()`
    (0.10.20 — between 0.10.11 and 0.10.19 nothing recomposed when the fetch resolved, and a
    style.json landing after the last reactive change meant the basemap NEVER painted). What made
    that extra recompose safe is `map/styleQueue.ts`: **at most one `setStyle` in flight**.
  - **"In flight" ends on the issued style's own `"style.load"`, not on `"idle"` (0.10.22).**
    MapLibre fires `"style.load"` at the end of a diff that changed something (synchronously, inside
    `setStyle`) and when a from-scratch rebuild has loaded; `"idle"` waits for every tile of every
    source AND for the camera to stop. Settling on `"idle"` parked the species raster's style behind
    the basemap-arrival recompose for the whole species camera flight — the bimodal ~1 s regression
    in `e2e/species.timing.spec.ts` (0.10.19 1.3–1.5 s median; 0.10.20/0.10.21 up to 3.2 s). Two
    more rules came with it: a style identical to the one last issued is not issued at all (the
    INACTIVE theme's style.json reporting in recomposes an identical style, whose empty diff fires
    no event), and "may this style be diffed yet?" is a latch set once the map's style has loaded,
    not `isStyleLoaded()` (false while any tile loads). A changed `sprite` is the one part of a
    diff `"style.load"` does not cover (MapLibre fetches it afterwards and never aborts an earlier
    fetch), so a style that changes the sprite AGAIN while the last change loads still waits for
    `"idle"`. `"idle"` and the 4 s fallback remain the backstops. Gates:
    `tests/map/styleQueue.test.ts` ("0.10.22") and `e2e/species.smoke.spec.ts` (basemap tiles hung
    so the map can never go idle: the raster must reach the style before the basemap's 4 s
    fallback could release it); seeded fault `tests/faults/style-settle-on-idle.patch`.
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
