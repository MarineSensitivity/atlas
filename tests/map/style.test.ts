// composeStyle + the declared layer order + applyStyle. The order table is the gate that replaces
// the Shiny app's `before_id` chain (atlas-4 §2.4/§11.4: "layer order is declared, so a missing
// `before` layer can never cascade").
import { describe, expect, it, vi } from "vitest";
import {
  LAYER_ORDER,
  SELECTION_COLOR,
  applyStyle,
  composeStyle,
  orderLayers,
  type RoledLayer,
} from "../../src/lib/map/style";
import {
  OUTSIDE_PRA_COLORMAP,
  titilerMaskTileTemplate,
  titilerTileTemplate,
} from "../../src/lib/map/layers/titiler";
import { OVERLAY_RASTER_OPACITY, SCORE_RASTER_OPACITY } from "../../src/lib/map/layers/raster";
import type { ZoneUnitSpec } from "../../src/lib/map/types";
import { UNORDERED_ROLED_LAYER } from "../fixtures/map/faults";

const PRA: ZoneUnitSpec = {
  unit: "programarea",
  pmtiles: "https://s3.example/zones/programarea/zones.pmtiles",
  sourceLayer: "programarea",
};
const ECO: ZoneUnitSpec = {
  unit: "ecoregion",
  pmtiles: "https://s3.example/zones/ecoregion/zones.pmtiles",
  sourceLayer: "ecoregion",
};

const SCORE = {
  id: "r_lyr",
  tiles: [
    titilerTileTemplate({
      url: "https://s3.example/cog/usa05/d2.tif",
      colormapName: "spectral_r",
      rescaleMin: 0,
      rescaleMax: 90,
    }),
  ],
  opacity: SCORE_RASTER_OPACITY,
};

describe("orderLayers", () => {
  it("sorts by the declared order regardless of the order layers were built in", () => {
    const roled: RoledLayer[] = [
      { role: "zone-line", layer: { id: "a_ln", type: "line", source: "s" } },
      { role: "background", layer: { id: "bg", type: "background" } },
      { role: "raster", layer: { id: "r", type: "raster", source: "s" } },
    ];
    expect(orderLayers(roled).map((l) => l.id)).toEqual(["bg", "r", "a_ln"]);
  });

  it("is stable within a role (boot's unit order survives)", () => {
    const roled: RoledLayer[] = [
      { role: "zone-line", layer: { id: "programarea_ln", type: "line", source: "s" } },
      { role: "zone-line", layer: { id: "ecoregion_ln", type: "line", source: "s" } },
    ];
    expect(orderLayers(roled).map((l) => l.id)).toEqual(["programarea_ln", "ecoregion_ln"]);
  });

  it("SEEDED FAULT: a layer whose role is not in LAYER_ORDER throws, naming the layer", () => {
    expect(() => orderLayers([UNORDERED_ROLED_LAYER])).toThrowError(/bathymetry/);
  });

  it("the declared order is the documented one (selection on top, background at the bottom)", () => {
    expect(LAYER_ORDER[0]).toBe("background");
    expect(LAYER_ORDER[LAYER_ORDER.length - 1]).toBe("selection-line");
    expect(LAYER_ORDER.indexOf("raster")).toBeLessThan(LAYER_ORDER.indexOf("zone-fill"));
    expect(LAYER_ORDER.indexOf("zone-fill")).toBeLessThan(LAYER_ORDER.indexOf("zone-line"));
    expect(LAYER_ORDER.indexOf("zone-line")).toBeLessThan(LAYER_ORDER.indexOf("zone-label"));
  });
});

describe("composeStyle", () => {
  it("a bare style is background + basemap, in that order, on the theme's basemap", () => {
    const s = composeStyle({ theme: "paper" });
    expect(s.layers.map((l) => l.id)).toEqual(["background", "basemap"]);
    expect(JSON.stringify(s.sources.basemap)).toContain("light_all");
  });

  it("defaults to the globe projection and carries it IN the style (plan atlas-4 §5.3)", () => {
    expect(composeStyle({ theme: "navy" }).projection).toEqual({ type: "globe" });
    expect(composeStyle({ theme: "navy", projection: "mercator" }).projection).toEqual({
      type: "mercator",
    });
  });

  it("removing the raster removes exactly that layer — nothing cascades", () => {
    const withRaster = composeStyle({ theme: "navy", raster: SCORE, zones: [PRA] });
    const without = composeStyle({ theme: "navy", raster: null, zones: [PRA] });
    expect(withRaster.layers.map((l) => l.id)).toEqual([
      "background",
      "basemap",
      "r_lyr",
      "programarea_ln",
    ]);
    expect(without.layers.map((l) => l.id)).toEqual(["background", "basemap", "programarea_ln"]);
  });

  it("orders the full stack: basemap, raster, overlay, fills, lines, labels, selection", () => {
    const s = composeStyle({
      theme: "navy",
      raster: SCORE,
      overlays: [
        {
          id: "outside_pra_lyr",
          tiles: [
            titilerMaskTileTemplate({
              url: "https://s3.example/cog/usa05/mask.tif",
              colormap: OUTSIDE_PRA_COLORMAP,
            }),
          ],
          opacity: OVERLAY_RASTER_OPACITY,
          visible: false,
        },
      ],
      zones: [
        {
          ...PRA,
          fill: {
            keyProperty: "programarea_key",
            stops: [{ key: "GAA", color: "#111111" }],
            defaultColor: "lightgrey",
            opacity: 0.7,
            outlineColor: "white",
          },
          labels: {
            points: { type: "FeatureCollection", features: [] },
            textProperty: "key",
          },
        },
        ECO,
      ],
      selection: { features: { type: "FeatureCollection", features: [] } },
    });
    expect(s.layers.map((l) => l.id)).toEqual([
      "background",
      "basemap",
      "r_lyr",
      "outside_pra_lyr",
      "programarea_fill",
      "programarea_ln",
      "ecoregion_ln",
      "programarea_lbl",
      "selection-fill",
      "selection-line",
    ]);
  });

  it("the selection is #ff00aa and sits above every data layer", () => {
    const s = composeStyle({
      theme: "navy",
      zones: [PRA],
      selection: { features: { type: "FeatureCollection", features: [] } },
    });
    const line = s.layers.find((l) => l.id === "selection-line");
    expect(line && "paint" in line ? line.paint : null).toMatchObject({
      "line-color": SELECTION_COLOR,
    });
    expect(s.layers[s.layers.length - 1].id).toBe("selection-line");
  });

  it("sets `glyphs` only when a label layer really exists (no stray font fetch)", () => {
    expect(composeStyle({ theme: "navy", zones: [PRA] }).glyphs).toBeUndefined();
    const withLabels = composeStyle({
      theme: "navy",
      zones: [
        {
          ...PRA,
          labels: { points: { type: "FeatureCollection", features: [] }, textProperty: "key" },
        },
      ],
    });
    expect(withLabels.glyphs).toContain("{fontstack}");
  });

  it("`basemap: null` composes a map with no basemap at all (the report's print surface)", () => {
    const s = composeStyle({ theme: "paper", basemap: null, zones: [PRA] });
    expect(s.layers.map((l) => l.id)).toEqual(["background", "programarea_ln"]);
    expect(s.sources.basemap).toBeUndefined();
  });

  it("the raster resamples NEAREST, so a probed pixel is the cell's own value", () => {
    const s = composeStyle({ theme: "navy", raster: SCORE });
    const r = s.layers.find((l) => l.id === "r_lyr");
    expect(r && "paint" in r ? r.paint : null).toEqual({
      "raster-opacity": SCORE_RASTER_OPACITY,
      "raster-resampling": "nearest",
    });
  });
});

describe("applyStyle", () => {
  it("calls setStyle(style, {diff:true}) — and nothing else", () => {
    const setStyle = vi.fn();
    const style = composeStyle({ theme: "navy" });
    applyStyle({ setStyle }, style);
    expect(setStyle).toHaveBeenCalledTimes(1);
    expect(setStyle).toHaveBeenCalledWith(style, { diff: true });
  });
});
