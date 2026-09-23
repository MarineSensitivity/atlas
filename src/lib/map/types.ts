// map/ — the shapes the three lenses (atlas-4 scores, atlas-5 species, atlas-6 places) hand to
// `composeStyle()`. Every type here is plain data: no MapLibre instance, no DOM. The only
// MapLibre things this file touches are `import type` style-spec types, which erase at compile
// time — that is what keeps `style.ts` and `layers/*` unit-testable under vitest's node
// environment (CLAUDE.md "Testing pyramid": the test asserts the function, the component calls it).
import type { FeatureCollection } from "geojson";
import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";
import type { MapView, Projection, ResolvedTheme } from "../state/types";

export type { LayerSpecification, SourceSpecification, StyleSpecification };
export type { MapView, Projection, ResolvedTheme };

/** the theme's CARTO vector basemap: a style.json URL `composeStyle()` fetches (via
 * `layers/basemap.ts#loadBasemapStyle()`, cached per theme) and merges whole — never a raster tile
 * template (CARTO's raster endpoint now requires a key; see `layers/basemap.ts`'s header). */
export interface BasemapSpec {
  /** absolute https URL of CARTO's GL style.json — always absolute (plan D2: never resolve
   * against the mount point). */
  url: string;
  /** shown by the on-map About card (spec.md §9), never by MapLibre's own control. */
  attribution: string;
}

/** one zone unit's choropleth, built by the lens from `boot.zones[unit]` values (atlas-4 §6.4). */
export interface ZoneFillSpec {
  /** the tile property a stop's `key` is matched against, e.g. `programarea_key`. */
  keyProperty: string;
  /** one `{key, color}` per zone; a key absent here paints `defaultColor`. */
  stops: ReadonlyArray<{ key: string; color: string }>;
  /** `lightgrey` in the Shiny app (`app.R:2318`) — a zone with no value is drawn, not dropped. */
  defaultColor: string;
  opacity: number;
  outlineColor: string;
}

/** label points for one unit — `boot.zones[unit][*].label_pt` (atlas-4 §6.2 step 3). */
export interface ZoneLabelSpec {
  /** GeoJSON FeatureCollection of points carrying `key` and `name` properties. */
  points: FeatureCollection;
  /** which property the symbol layer renders; `"key"` matches the Shiny app's `text_field`. */
  textProperty: string;
}

/** one drawable zone unit — a `boot.units[]` row plus whatever the lens adds on top. */
export interface ZoneUnitSpec {
  /** the unit *type*: `programarea`, `ecoregion`, `subregion`, `planarea`, … (`fld` minus `_key`). */
  unit: string;
  /** absolute https URL of the PMTiles archive (`boot.units[].pmtiles`). */
  pmtiles: string;
  /** the vector layer inside the archive (`boot.units[].source_layer`). */
  sourceLayer: string;
  /** human label (`boot.units[].label`), for the layers control; never used in a URL. */
  label?: string;
  /** omit for an outline-only unit (the default: atlas-4 draws a fill only for the selected unit). */
  fill?: ZoneFillSpec;
  /** omit for no labels; `layers/zones.ts` already refuses labels for `subregion` (zone_style). */
  labels?: ZoneLabelSpec;
  /** `false` hides the line layer without removing it (the layers control's switch). */
  lineVisible?: boolean;
  /** the key of ONE zone to outline in the selection colour (atlas-4 §6.6: a clicked zone's
   * highlight, `colors.ts`'s `SELECTION_COLOR`, 4 px) — filtered against the SAME vector
   * source/layer, so no separate geometry fetch is needed. `layers/zones.ts`'s
   * `zoneHighlightLayer()` builds it. */
  highlightKey?: string;
}

/** a titiler-backed raster: the score COG, or an overlay such as `_outside_pra` (atlas-4 §6.2). */
export interface RasterLayerSpec {
  /** style source AND layer id (they share the id, as in `msens::add_cell_tiles`). */
  id: string;
  /** tile URL templates carrying literal `{z}/{x}/{y}` — build them with `layers/titiler.ts`. */
  tiles: string[];
  opacity: number;
  tileSize?: number;
  /** `false` → `visibility: "none"`; the overlay ships off by default (atlas-4 §6.2 step 5). */
  visible?: boolean;
}

/** the selection highlight (atlas-4 §6.6 / §7: a cell ring or a zone outline, in
 * `colors.ts`'s `SELECTION_COLOR`). */
export interface SelectionSpec {
  /** whatever the lens computed: a cell square, a zone boundary, a drawn place. */
  features: FeatureCollection;
  /** overridden only by a test; the lens uses the shipped constant. */
  color?: string;
  /**
   * atlas-6 Deliverable 2's "show analysis cells" toggle: when true, `fill-opacity` reads each
   * feature's own `opacity` property (0-1, `pct / 100` — `places/cellSquares.ts` sets it) instead
   * of the flat 0.15 an ordinary selection highlight uses, so a lightly-covered cell paints
   * fainter than a fully-covered one.
   */
  cellOpacity?: boolean;
}

/**
 * A PMTiles vector "presence" fill — atlas-5's ranges branch (an IUCN/BirdLife/critical-habitat
 * range polygon, `atlas-refs/"parity species app.md"` §6.2's PMTiles branch). Distinct from
 * `ZoneUnitSpec` (a release's drawable UNIT, e.g. Program Area) even though both are PMTiles vector
 * fills: a range is per-SPECIES-input, filtered to one `mdl_key`, and carries no outline/label.
 */
export interface RangeLayerSpec {
  /** style source AND layer id. */
  id: string;
  /** absolute https PMTiles URL (`asset.url`; the map module registers `pmtiles://` — map.ts). */
  pmtiles: string;
  /** the vector layer inside the archive (`asset.sourceLayer`). */
  sourceLayer: string;
  /** the property every feature carries the model id under (`"mdl_key"`, §6.2). */
  keyProperty: string;
  /** the value to filter to — `["==", ["get", keyProperty], key]`. */
  key: string;
  fillColor: string;
  opacity: number;
}
