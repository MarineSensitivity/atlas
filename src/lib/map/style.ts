// ONE composed style, applied with ONE `setStyle(style, { diff: true })` (CLAUDE.md; plan lesson 3
// from `atlas-refs/"calcofi explore review.md"` §5). Nothing in this app ever calls `addLayer()`
// after load: a layer added that way silently vanishes across the next style swap, and the Shiny
// app's own `before_id` chain is exactly how v1 ended up as "a map with nothing but labels"
// (atlas-4 §2.4: "MapLibre rejects an add whose `before_id` doesn't exist and the failure
// cascades").
//
// The fix is a DECLARED order. Every layer this module builds is tagged with a `LayerRole`, and the
// final array is those roles' fixed order, filtered to the layers that actually exist. A missing
// layer therefore removes exactly itself — there is no `before` id left to dangle, so nothing can
// cascade. `orderLayers()` throws on a role outside the table, so a new layer kind cannot be added
// without deciding where it sits (tests/map/style.test.ts seeds exactly that fault).
import { basemapForTheme, GLYPHS_URL, MAP_BACKGROUND_BY_THEME } from "./layers/basemap";
import { SELECTION_COLOR } from "./colors";
import { rasterLayer, rasterSource } from "./layers/raster";
import {
  zoneFillLayer,
  zoneHighlightLayer,
  zoneLabelLayer,
  zoneLineLayer,
  zoneSources,
  zonesNeedGlyphs,
} from "./layers/zones";
import type {
  BasemapSpec,
  LayerSpecification,
  Projection,
  RasterLayerSpec,
  ResolvedTheme,
  SelectionSpec,
  SourceSpecification,
  StyleSpecification,
  ZoneUnitSpec,
} from "./types";

/**
 * The declared paint order, bottom to top. Read it as the answer to "what is on top of what":
 * the basemap under the score raster, the raster under the zone fills, every outline above every
 * fill, labels above outlines, and the selection above everything so a selection ring is never
 * hidden by the layer it selects.
 */
export const LAYER_ORDER = [
  "background",
  "basemap",
  "raster",
  "overlay",
  "zone-fill",
  "zone-line",
  "zone-label",
  "selection-fill",
  "selection-line",
] as const;

export type LayerRole = (typeof LAYER_ORDER)[number];

export interface RoledLayer {
  role: LayerRole;
  layer: LayerSpecification;
}

/** the selection highlight's colour (atlas-4 §6.6/§7.1-7.3), from the module's one colour file. */
export { SELECTION_COLOR };
export const SELECTION_LINE_WIDTH = 4;
export const SELECTION_SOURCE_ID = "selection";

export interface ComposeStyleInput {
  theme: ResolvedTheme;
  /** defaults to `basemapForTheme(theme)`; pass `null` for no basemap at all (print/report). */
  basemap?: BasemapSpec | null;
  /** `globe` (the shipped default) or `mercator`; travels IN the style, so a projection change is
   * one more `setStyle(diff)` rather than a second imperative API the lenses have to remember. */
  projection?: Projection;
  zones?: readonly ZoneUnitSpec[];
  /** the score raster (atlas-4) or a species surface (atlas-5). */
  raster?: RasterLayerSpec | null;
  /** extra rasters above the main one, e.g. "cells outside Program Areas". */
  overlays?: readonly RasterLayerSpec[];
  selection?: SelectionSpec | null;
  /** override only in a test: the glyph endpoint used when a label layer exists. */
  glyphs?: string;
}

/**
 * Sort tagged layers into {@link LAYER_ORDER}, stably within a role (so two units' outlines keep
 * boot's own order: Program Areas first, then finest first).
 *
 * @throws if a layer carries a role the order table does not name — the seeded fault for
 * "a layer order that would cascade". Silently appending an unknown role would reintroduce exactly
 * the failure this table exists to prevent.
 */
export function orderLayers(roled: readonly RoledLayer[]): LayerSpecification[] {
  const rank = new Map<string, number>(LAYER_ORDER.map((r, i) => [r, i]));
  for (const { role, layer } of roled) {
    if (!rank.has(role)) {
      throw new Error(
        `map/style: layer "${layer.id}" has role "${role}", which is not in LAYER_ORDER ` +
          `(${LAYER_ORDER.join(", ")}) — add it to the declared order, never append it blindly`,
      );
    }
  }
  return roled
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank.get(a.r.role)! - rank.get(b.r.role)! || a.i - b.i)
    .map(({ r }) => r.layer);
}

function selectionLayers(sel: SelectionSpec): RoledLayer[] {
  const color = sel.color ?? SELECTION_COLOR;
  return [
    {
      role: "selection-fill",
      layer: {
        id: "selection-fill",
        type: "fill",
        source: SELECTION_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": color, "fill-opacity": 0.15 },
      },
    },
    {
      role: "selection-line",
      layer: {
        id: "selection-line",
        type: "line",
        source: SELECTION_SOURCE_ID,
        paint: { "line-color": color, "line-width": SELECTION_LINE_WIDTH },
      },
    },
  ];
}

/**
 * Compose the whole style: background ⊕ basemap ⊕ raster ⊕ overlays ⊕ zones ⊕ selection.
 *
 * This is the ONE entry point a lens uses to change what the map shows. A lens never touches
 * MapLibre: it recomputes its inputs, calls this, and hands the result to {@link applyStyle}.
 */
export function composeStyle(input: ComposeStyleInput): StyleSpecification {
  const basemap = input.basemap === undefined ? basemapForTheme(input.theme) : input.basemap;
  const zones = input.zones ?? [];
  const overlays = input.overlays ?? [];

  const sources: Record<string, SourceSpecification> = {};
  const roled: RoledLayer[] = [
    {
      role: "background",
      layer: {
        id: "background",
        type: "background",
        paint: { "background-color": MAP_BACKGROUND_BY_THEME[input.theme] },
      },
    },
  ];

  if (basemap) {
    sources[basemap.id] = {
      type: "raster",
      tiles: [...basemap.tiles],
      tileSize: basemap.tileSize,
      maxzoom: basemap.maxzoom,
      attribution: basemap.attribution,
    };
    roled.push({
      role: "basemap",
      layer: { id: basemap.id, type: "raster", source: basemap.id, paint: { "raster-opacity": 1 } },
    });
  }

  if (input.raster) {
    sources[input.raster.id] = rasterSource(input.raster);
    roled.push({ role: "raster", layer: rasterLayer(input.raster) });
  }
  for (const overlay of overlays) {
    sources[overlay.id] = rasterSource(overlay);
    roled.push({ role: "overlay", layer: rasterLayer(overlay) });
  }

  Object.assign(sources, zoneSources(zones));
  for (const u of zones) {
    const fill = zoneFillLayer(u);
    if (fill) roled.push({ role: "zone-fill", layer: fill });
    roled.push({ role: "zone-line", layer: zoneLineLayer(u) });
  }
  for (const u of zones) {
    const label = zoneLabelLayer(u);
    if (label) roled.push({ role: "zone-label", layer: label });
  }
  for (const u of zones) {
    const highlight = zoneHighlightLayer(u);
    if (highlight) roled.push({ role: "selection-line", layer: highlight });
  }

  if (input.selection) {
    sources[SELECTION_SOURCE_ID] = { type: "geojson", data: input.selection.features };
    roled.push(...selectionLayers(input.selection));
  }

  const style: StyleSpecification = {
    version: 8,
    projection: { type: input.projection ?? "globe" },
    sources,
    layers: orderLayers(roled),
  };
  // only when a symbol layer really exists: an unused `glyphs` key costs nothing, but keeping it
  // conditional makes "a style with no labels fetches no font range" an assertable property.
  if (zonesNeedGlyphs(zones)) style.glyphs = input.glyphs ?? GLYPHS_URL;
  return style;
}

/** the narrow slice of MapLibre's `Map` this module needs — so `applyStyle` is unit-testable with
 * a two-line fake and `style.ts` never imports maplibre-gl at runtime. */
export interface StyleTarget {
  setStyle(style: StyleSpecification, options: { diff: boolean }): unknown;
}

/**
 * Apply a composed style. This is the ONLY `setStyle` in the app, and it does nothing else:
 * no `addLayer`, no `addSource`, no `moveLayer`, no `before` id (CLAUDE.md).
 */
export function applyStyle(map: StyleTarget, style: StyleSpecification): void {
  map.setStyle(style, { diff: true });
}
