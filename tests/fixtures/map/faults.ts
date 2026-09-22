// Seeded faults for the map module's three gates (atlas-map). Each is a COMMITTED red fixture: the
// gate's own test asserts that the checker rejects it, so "this check can actually fail" is proved
// on every run rather than argued for in a comment (CLAUDE.md: a check that cannot fail is not a
// check).
//
// These are never imported by src/ — tests/fixtures/** is outside vitest's `include` and outside
// index.html's build graph.
import type { LayerSpecification } from "maplibre-gl";

/**
 * FAULT 1 — a layer order that would cascade.
 *
 * A layer tagged with a role the declared `LAYER_ORDER` does not name. If `orderLayers()` appended
 * it blindly instead of throwing, the layer would land at an arbitrary depth and the next person to
 * add one would reach for a `before` id — which is exactly the `before_id` chain that left v1 as "a
 * map with nothing but labels" (atlas-4 §2.4).
 */
export const UNORDERED_ROLED_LAYER = {
  role: "bathymetry" as never,
  layer: {
    id: "bathymetry",
    type: "line",
    source: "bathy",
    paint: { "line-color": "#ffffff" },
  } as LayerSpecification,
};

/**
 * FAULT 2 — a tile URL that leaks a study-area key.
 *
 * "The study area is a camera, never a filter" (plan apps#13/#14): the raster is always the `FULL`
 * COG. A URL like this one would mean the server filtered by study area, silently changing what
 * every number on the page means.
 */
export const LEAKY_TILE_URL =
  "https://titiler-v8.marinesensitivity.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png" +
  "?url=https%3A%2F%2Fexample%2Ecom%2Fa.tif&area=AK&colormap_name=spectral_r&rescale=0,90";

/** the same URL with the study area expressed as a value rather than a parameter name. */
export const LEAKY_TILE_URL_BY_VALUE =
  "https://titiler-v8.marinesensitivity.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png" +
  "?url=https%3A%2F%2Fexample%2Ecom%2Fa.tif&subregion_key=GA&colormap_name=spectral_r";
