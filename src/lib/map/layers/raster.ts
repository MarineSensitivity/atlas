// The raster source + layer pair, `msens::add_cell_tiles()`'s shape (viz.R:294-312, atlas-4 §6.2
// step 4): `add_raster_source(id, tiles, tileSize = 256)` + `add_raster_layer(raster_resampling =
// "nearest")`. Pure: given a `RasterLayerSpec` it returns plain specs, no MapLibre instance needed.
//
// `raster-resampling: "nearest"` is not cosmetic — the COGs are categorical-ish score surfaces on a
// 0.05° grid and MapLibre's default `linear` blends neighbouring cells, so a pixel probed at a
// lon/lat would not equal the cell's own value (atlas-4's "legend, painted pixel and popup swatch
// agree at three probe values per palette" gate).
import type { LayerSpecification, RasterLayerSpec, SourceSpecification } from "../types";

/** the score raster's opacity (`raster_opacity = 0.6`, app.R:2115). */
export const SCORE_RASTER_OPACITY = 0.6;
/** the "cells outside Program Areas" overlay's opacity (`raster_opacity = 0.55`, app.R:2124). */
export const OVERLAY_RASTER_OPACITY = 0.55;
/** every titiler `/cog/tiles/WebMercatorQuad` tile is 256 px. */
export const RASTER_TILE_SIZE = 256;

export function rasterSourceId(spec: RasterLayerSpec): string {
  return spec.id;
}

export function rasterSource(spec: RasterLayerSpec): SourceSpecification {
  return {
    type: "raster",
    tiles: [...spec.tiles],
    tileSize: spec.tileSize ?? RASTER_TILE_SIZE,
  };
}

export function rasterLayer(spec: RasterLayerSpec): LayerSpecification {
  return {
    id: spec.id,
    type: "raster",
    source: rasterSourceId(spec),
    layout: { visibility: spec.visible === false ? "none" : "visible" },
    paint: {
      "raster-opacity": spec.opacity,
      "raster-resampling": "nearest",
    },
  };
}
