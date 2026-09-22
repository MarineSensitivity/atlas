// composeStyle + the declared layer order + applyStyle. The order table is the gate that replaces
// the Shiny app's `before_id` chain (atlas-4 §2.4/§11.4: "layer order is declared, so a missing
// `before` layer can never cascade").
import { describe, expect, it, vi } from "vitest";
import {
  LAYER_ORDER,
  SELECTION_COLOR,
  SELECTION_FILL_OPACITY_DEFAULT,
  applyStyle,
  composeStyle,
  layersControlItems,
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

  // atlas-6 Deliverable 2's "show analysis cells" toggle: a data-driven fill-opacity instead of
  // the flat default, so a lightly-covered cell paints fainter than a fully-covered one.
  it("selection-fill's fill-opacity is the flat default without `cellOpacity`", () => {
    const s = composeStyle({
      theme: "navy",
      selection: { features: { type: "FeatureCollection", features: [] } },
    });
    const fill = s.layers.find((l) => l.id === "selection-fill");
    expect(fill && "paint" in fill ? fill.paint : null).toMatchObject({
      "fill-opacity": SELECTION_FILL_OPACITY_DEFAULT,
    });
  });

  it("selection-fill's fill-opacity reads each feature's own `opacity` property when `cellOpacity` is set", () => {
    const s = composeStyle({
      theme: "navy",
      selection: { features: { type: "FeatureCollection", features: [] }, cellOpacity: true },
    });
    const fill = s.layers.find((l) => l.id === "selection-fill");
    expect(fill && "paint" in fill ? fill.paint : null).toMatchObject({
      "fill-opacity": ["get", "opacity"],
    });
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

// atlas-4 fix round 2: the ported Shiny app's known bug (parity doc §6.4) hardcoded its layers
// control to `pra_ln`, `pra_lbl`, `er_ln`, `r_lyr`, `outside_pra_lyr` while the layers it actually
// created were `programarea_ln`/`programarea_lbl`/`ecoregion_ln`/… -- three of five switches were
// dead. This app's architecture already avoids that class of bug (composeStyle is the ONE place
// layer ids are decided, and every id used elsewhere is one of its own exported id functions), but
// had no NAMED test proving the control itself cannot regress to a hardcoded, stale id list.
// `layersControlItems` derives its output FROM the style, so this is that test.
describe("layersControlItems", () => {
  const FULL_STACK = composeStyle({
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
        labels: { points: { type: "FeatureCollection", features: [] }, textProperty: "key" },
      },
      ECO,
    ],
    selection: { features: { type: "FeatureCollection", features: [] } },
  });

  it("the three historically dead ids never appear (pra_ln, pra_lbl, er_ln)", () => {
    const ids = layersControlItems(FULL_STACK).map((i) => i.id);
    expect(ids).not.toContain("pra_ln");
    expect(ids).not.toContain("pra_lbl");
    expect(ids).not.toContain("er_ln");
  });

  it("every real composed data layer DOES appear", () => {
    const ids = layersControlItems(FULL_STACK).map((i) => i.id);
    expect(ids).toEqual([
      "r_lyr",
      "outside_pra_lyr",
      "programarea_fill",
      "programarea_ln",
      "ecoregion_ln",
      "programarea_lbl",
    ]);
  });

  it("excludes page chrome and the click-driven selection ring (never user-toggleable)", () => {
    const ids = layersControlItems(FULL_STACK).map((i) => i.id);
    expect(ids).not.toContain("background");
    expect(ids).not.toContain("basemap");
    expect(ids).not.toContain("selection-fill");
    expect(ids).not.toContain("selection-line");
  });

  it("labels the well-known raster/overlay ids exactly as the ported app named them", () => {
    const items = layersControlItems(FULL_STACK);
    expect(items.find((i) => i.id === "r_lyr")?.label).toBe("Raster cell values");
    expect(items.find((i) => i.id === "outside_pra_lyr")?.label).toBe(
      "Cells outside Program Areas",
    );
  });

  it("a bare background+basemap style (nothing selected yet) lists no items", () => {
    expect(layersControlItems(composeStyle({ theme: "navy" }))).toEqual([]);
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
