// the "Pick from gazetteer" tile layer (layers/gazetteer.ts) and its composeStyle wiring: a vector
// PMTiles source carrying the collection's attribution, a fill + line, sitting in the Selection
// (data-places) group just under the selection highlight.
import { describe, expect, it } from "vitest";
import {
  GAZETTEER_FILL_ID,
  GAZETTEER_LINE_ID,
  GAZETTEER_SOURCE_ID,
  gazetteerSource,
} from "../../src/lib/map/layers/gazetteer";
import { LAYER_ORDER, composeStyle } from "../../src/lib/map/style";
import type { GazetteerLayerSpec } from "../../src/lib/map/types";
import { DEFAULT_LAYER_STACK } from "../../src/lib/map/layerStack";

const SPEC: GazetteerLayerSpec = {
  slug: "places",
  pmtiles:
    "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/places/places.pmtiles",
  sourceLayer: "places",
  attribution: "NOAA ONMS; Marine Regions. Processed by Ocean Metrics.",
};
const EMPTY_BASEMAP = { sources: {}, layers: [] };

describe("gazetteer layer", () => {
  it("the source is a pmtiles:// vector source carrying the credit", () => {
    expect(gazetteerSource(SPEC)).toEqual({
      type: "vector",
      url: `pmtiles://${SPEC.pmtiles}`,
      attribution: SPEC.attribution,
    });
  });
  it("no credit text, no attribution key", () => {
    expect(gazetteerSource({ ...SPEC, attribution: "" })).not.toHaveProperty("attribution");
  });
  it("composeStyle adds the source, a fill and a line on the archive's source-layer", () => {
    const style = composeStyle({ theme: "paper", basemapStyle: EMPTY_BASEMAP, gazetteer: SPEC });
    expect(style.sources[GAZETTEER_SOURCE_ID]).toMatchObject({ type: "vector" });
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain(GAZETTEER_FILL_ID);
    expect(ids).toContain(GAZETTEER_LINE_ID);
    const fill = style.layers.find((l) => l.id === GAZETTEER_FILL_ID) as { "source-layer": string };
    expect(fill["source-layer"]).toBe("places");
  });
  it("no gazetteer input, no gazetteer source or layers (every existing style is unchanged)", () => {
    const style = composeStyle({ theme: "paper", basemapStyle: EMPTY_BASEMAP });
    expect(style.sources[GAZETTEER_SOURCE_ID]).toBeUndefined();
    expect(style.layers.map((l) => l.id)).not.toContain(GAZETTEER_FILL_ID);
  });
  it("draws UNDER the selection highlight, over the data", () => {
    const style = composeStyle({
      theme: "paper",
      basemapStyle: EMPTY_BASEMAP,
      gazetteer: SPEC,
      selection: {
        features: { type: "FeatureCollection", features: [] },
      },
    });
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf(GAZETTEER_LINE_ID)).toBeLessThan(ids.indexOf("selection-fill"));
    expect(LAYER_ORDER.indexOf("gazetteer-line")).toBeLessThan(
      LAYER_ORDER.indexOf("selection-fill"),
    );
  });
  it("hiding the Selection group hides the gazetteer layers with it (same group)", () => {
    const stack = DEFAULT_LAYER_STACK.map((id) => ({
      id,
      visible: id !== "data-places",
      opacity: 1,
    }));
    const style = composeStyle({
      theme: "paper",
      basemapStyle: EMPTY_BASEMAP,
      gazetteer: SPEC,
      layerStack: stack,
    });
    const fill = style.layers.find((l) => l.id === GAZETTEER_FILL_ID)!;
    expect(fill.layout?.visibility).toBe("none");
  });
});
