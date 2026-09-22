// A species "range" fill — atlas-5's PMTiles branch (`atlas-refs/"parity species app.md"` §6.2:
// `add_fill_layer(id="r_pm", source="pm_src", source_layer=asset$source_layer, filter=list("==",
// list("get","mdl_key"), layer_mdl_key), fill_color=<the fixed range blue>, fill_opacity=0.5)`).
//
// Pure: given a `RangeLayerSpec` it returns plain specs, no MapLibre instance needed — the same
// shape as `layers/raster.ts`. The `pmtiles://` protocol itself is registered once, process-wide,
// by `map.ts`'s `wireMapLibreOnce()`; this module only ever builds the URL/source/layer objects.
//
// The fill color itself (a bare hex literal) lives ONLY in `../colors.ts` — the map module's one
// colour file, and `tests/raster/ramps.wiring.test.ts`'s gate scans the rest of `src/` for a stray
// hex literal, comments included, so it is deliberately never spelled out again here.
import { RANGE_FILL_COLOR } from "../colors";
import type { LayerSpecification, RangeLayerSpec, SourceSpecification } from "../types";

/** re-exported so a caller building a `RangeLayerSpec` has one import for "the range fill's color
 * and opacity" together. */
export { RANGE_FILL_COLOR };
export const RANGE_FILL_OPACITY = 0.5;

export function rangeSourceId(spec: RangeLayerSpec): string {
  return spec.id;
}

export function rangeSource(spec: RangeLayerSpec): SourceSpecification {
  return { type: "vector", url: `pmtiles://${spec.pmtiles}` };
}

export function rangeLayer(spec: RangeLayerSpec): LayerSpecification {
  return {
    id: spec.id,
    type: "fill",
    source: rangeSourceId(spec),
    "source-layer": spec.sourceLayer,
    filter: ["==", ["get", spec.keyProperty], spec.key] as never,
    paint: {
      "fill-color": spec.fillColor,
      "fill-opacity": spec.opacity,
    },
  };
}
