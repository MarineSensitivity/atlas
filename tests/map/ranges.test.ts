// atlas-5's PMTiles ranges branch (§6.2): fill #3388ff at 0.5, source-layer from the asset, filter
// on mdl_key. Pure builder tests (layers/ranges.ts) plus composeStyle wiring (the "range" role).
import { describe, expect, it } from "vitest";
import {
  RANGE_FILL_COLOR,
  RANGE_FILL_OPACITY,
  rangeLayer,
  rangeSource,
} from "../../src/lib/map/layers/ranges";
import { LAYER_ORDER, composeStyle } from "../../src/lib/map/style";
import type { RangeLayerSpec } from "../../src/lib/map/types";

const RANGE: RangeLayerSpec = {
  id: "species-range",
  pmtiles: "https://file.marinesensitivity.org/pmtiles/v9/rng_iucn/6494.pmtiles?v=1",
  sourceLayer: "rng_iucn",
  keyProperty: "mdl_key",
  key: "rng_iucn|6494",
  fillColor: RANGE_FILL_COLOR,
  opacity: RANGE_FILL_OPACITY,
};

describe("rangeSource / rangeLayer", () => {
  it("registers a vector source through the pmtiles:// protocol", () => {
    expect(rangeSource(RANGE)).toEqual({
      type: "vector",
      url: `pmtiles://${RANGE.pmtiles}`,
    });
  });

  it("fills #3388ff at 0.5, filtered to the asset's mdl_key, verbatim (§6.2)", () => {
    const layer = rangeLayer(RANGE);
    expect(layer).toMatchObject({
      id: "species-range",
      type: "fill",
      source: "species-range",
      "source-layer": "rng_iucn",
      filter: ["==", ["get", "mdl_key"], "rng_iucn|6494"],
      paint: { "fill-color": "#3388ff", "fill-opacity": 0.5 },
    });
  });
});

describe("composeStyle({range})", () => {
  it("adds exactly one source + layer, positioned between raster and overlay", () => {
    expect(LAYER_ORDER.indexOf("raster")).toBeLessThan(LAYER_ORDER.indexOf("range"));
    expect(LAYER_ORDER.indexOf("range")).toBeLessThan(LAYER_ORDER.indexOf("overlay"));
    const s = composeStyle({ theme: "navy", basemap: null, range: RANGE });
    expect(s.layers.map((l) => l.id)).toEqual(["background", "species-range"]);
    expect(s.sources["species-range"]).toBeDefined();
  });

  it("removing the range removes exactly that layer — nothing cascades", () => {
    const withRange = composeStyle({ theme: "navy", basemap: null, range: RANGE });
    const without = composeStyle({ theme: "navy", basemap: null, range: null });
    expect(withRange.layers.map((l) => l.id)).toContain("species-range");
    expect(without.layers.map((l) => l.id)).not.toContain("species-range");
  });

  it("a raster and a range can coexist (switching representation never leaves a stale layer)", () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      raster: { id: "species-raster", tiles: ["https://example/{z}/{x}/{y}.png"], opacity: 0.8 },
      range: RANGE,
    });
    expect(s.layers.map((l) => l.id)).toEqual(["background", "species-raster", "species-range"]);
  });
});
