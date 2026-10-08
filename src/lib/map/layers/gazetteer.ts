// A gazetteer collection's PMTiles polygons -- the "Pick from gazetteer" map layer. Pure, like
// layers/ranges.ts: given a `GazetteerLayerSpec` it returns plain source/layer objects, no MapLibre
// instance, and the `pmtiles://` protocol is registered once by map.ts.
//
// One fill (faint, the click target) and one line, both on the SAME vector source. The source
// carries the collection's `attribution`, and `composeStyle` hands that same string to the shell's
// credit line (`gazetteerCredit()` below), so the credit is on screen exactly while the layer is.
import { GAZETTEER_COLOR } from "../colors";
import type { GazetteerLayerSpec, LayerSpecification, SourceSpecification } from "../types";

export const GAZETTEER_SOURCE_ID = "gazetteer";
export const GAZETTEER_FILL_ID = "gazetteer-fill";
export const GAZETTEER_LINE_ID = "gazetteer-line";
export const GAZETTEER_FILL_OPACITY = 0.25;
export const GAZETTEER_LINE_WIDTH = 1.25;

export function gazetteerSource(spec: GazetteerLayerSpec): SourceSpecification {
  return {
    type: "vector",
    url: `pmtiles://${spec.pmtiles}`,
    ...(spec.attribution ? { attribution: spec.attribution } : {}),
  };
}

export function gazetteerFillLayer(spec: GazetteerLayerSpec): LayerSpecification {
  return {
    id: GAZETTEER_FILL_ID,
    type: "fill",
    source: GAZETTEER_SOURCE_ID,
    "source-layer": spec.sourceLayer,
    paint: { "fill-color": GAZETTEER_COLOR, "fill-opacity": GAZETTEER_FILL_OPACITY },
  };
}

export function gazetteerLineLayer(spec: GazetteerLayerSpec): LayerSpecification {
  return {
    id: GAZETTEER_LINE_ID,
    type: "line",
    source: GAZETTEER_SOURCE_ID,
    "source-layer": spec.sourceLayer,
    paint: { "line-color": GAZETTEER_COLOR, "line-width": GAZETTEER_LINE_WIDTH },
  };
}
