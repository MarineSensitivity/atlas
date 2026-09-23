// composeStyle + the declared layer order + applyStyle. The order table is the gate that replaces
// the Shiny app's `before_id` chain (atlas-4 §2.4/§11.4: "layer order is declared, so a missing
// `before` layer can never cascade").
//
// composeStyle stays SYNCHRONOUS (atlas-map basemap fix): the default basemap reads whatever
// `layers/basemap.ts#loadBasemapStyle()` has already cached for the theme, never awaiting the
// fetch inline (style.ts's own header explains the measured regression that made this the rule).
// Every test below that is not itself ABOUT the basemap passes `basemap: null` so it never touches
// the cache/network at all (CLAUDE.md "Testing pyramid": unit tests are "no DOM and no network");
// the tests that ARE about the basemap inject a `basemapStyle` fixture instead of the real fetch.
import { describe, expect, it, vi } from "vitest";
import {
  BASEMAP_LAYER_PREFIX,
  LAYER_ORDER,
  SELECTION_COLOR,
  SELECTION_FILL_OPACITY_DEFAULT,
  applyStyle,
  cartoStyleHasSymbolLayer,
  composeStyle,
  layersControlItems,
  mergeCartoStyle,
  orderLayers,
  type RoledLayer,
} from "../../src/lib/map/style";
import type { CartoStyleLike } from "../../src/lib/map/layers/basemap";
import { zoneUnitsWithOutline } from "../../src/lib/map/layers/zones";
import {
  OUTSIDE_PRA_COLORMAP,
  titilerMaskTileTemplate,
  titilerTileTemplate,
} from "../../src/lib/map/layers/titiler";
import { OVERLAY_RASTER_OPACITY, SCORE_RASTER_OPACITY } from "../../src/lib/map/layers/raster";
import type { SourceSpecification, ZoneUnitSpec } from "../../src/lib/map/types";
import { MISTAGGED_BASEMAP_LAYER, UNORDERED_ROLED_LAYER } from "../fixtures/map/faults";

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

/** a minimal CARTO-shaped style — one background layer (id "background", colliding with
 * composeStyle's OWN synthetic background layer on purpose) and one "water" fill on the "carto"
 * vector source, plus a sprite/glyphs pair — enough to exercise the real merge without a fetch. */
const FAKE_CARTO_STYLE: CartoStyleLike = {
  sources: { carto: { type: "vector", url: "https://tiles.example/tiles.json" } },
  sprite: "https://tiles.example/gl/dark-matter-gl-style/sprite",
  glyphs: "https://tiles.example/fonts/{fontstack}/{range}.pbf",
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#101820" } },
    { id: "water", type: "fill", source: "carto", "source-layer": "water", paint: {} },
  ],
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

  it("SEEDED FAULT: a basemap layer mistagged with a later role sorts AFTER the zone data it should sit under", () => {
    const roled: RoledLayer[] = [
      { role: "basemap", layer: { id: "basemap-background", type: "background" } },
      MISTAGGED_BASEMAP_LAYER,
      { role: "zone-fill", layer: { id: "programarea_fill", type: "fill", source: "s" } },
    ];
    const ids = orderLayers(roled).map((l) => l.id);
    // proves the order gate has teeth: if composeStyle's merge loop ever tagged a CARTO layer with
    // the wrong role, it would land AFTER the zone data instead of under it — exactly the "CARTO
    // layers placed after the zone layers" regression this fixture stands in for.
    expect(ids.indexOf("basemap-water")).toBeGreaterThan(ids.indexOf("programarea_fill"));
  });

  it("the declared order is the documented one (basemap first, selection on top, background at the bottom)", () => {
    expect(LAYER_ORDER[0]).toBe("background");
    expect(LAYER_ORDER[1]).toBe("basemap");
    expect(LAYER_ORDER[LAYER_ORDER.length - 1]).toBe("selection-line");
    expect(LAYER_ORDER.indexOf("basemap")).toBeLessThan(LAYER_ORDER.indexOf("raster"));
    expect(LAYER_ORDER.indexOf("raster")).toBeLessThan(LAYER_ORDER.indexOf("zone-fill"));
    expect(LAYER_ORDER.indexOf("zone-fill")).toBeLessThan(LAYER_ORDER.indexOf("zone-line"));
    expect(LAYER_ORDER.indexOf("zone-line")).toBeLessThan(LAYER_ORDER.indexOf("zone-label"));
  });
});

describe("mergeCartoStyle", () => {
  it("namespaces every source id with the basemap prefix and rewrites layers' `source` to match", () => {
    const sources: Record<string, SourceSpecification> = {};
    const merged = mergeCartoStyle(FAKE_CARTO_STYLE, sources);
    expect(Object.keys(sources)).toEqual([`${BASEMAP_LAYER_PREFIX}carto`]);
    const water = merged.layers.find((l) => l.id === `${BASEMAP_LAYER_PREFIX}water`);
    expect(water && "source" in water ? water.source : null).toBe(`${BASEMAP_LAYER_PREFIX}carto`);
  });

  it("prefixes every layer id — including CARTO's own literal \"background\", which would otherwise collide with composeStyle's synthetic background layer", () => {
    const merged = mergeCartoStyle(FAKE_CARTO_STYLE, {});
    expect(merged.layers.map((l) => l.id)).toEqual([
      `${BASEMAP_LAYER_PREFIX}background`,
      `${BASEMAP_LAYER_PREFIX}water`,
    ]);
  });

  it("namespaces around a real id collision instead of overwriting the existing source", () => {
    const taken = { type: "raster", tiles: [] } as unknown as SourceSpecification;
    const sources: Record<string, SourceSpecification> = {
      [`${BASEMAP_LAYER_PREFIX}carto`]: taken,
    };
    mergeCartoStyle(FAKE_CARTO_STYLE, sources);
    expect(sources[`${BASEMAP_LAYER_PREFIX}carto`]).toBe(taken); // untouched
    expect(sources[`${BASEMAP_LAYER_PREFIX}carto-x`]).toBeDefined(); // the CARTO source landed here
  });

  it("carries sprite/glyphs over verbatim", () => {
    const merged = mergeCartoStyle(FAKE_CARTO_STYLE, {});
    expect(merged.sprite).toBe(FAKE_CARTO_STYLE.sprite);
    expect(merged.glyphs).toBe(FAKE_CARTO_STYLE.glyphs);
  });

  it("an empty (fallback) CARTO style merges in zero sources/layers", () => {
    const sources: Record<string, SourceSpecification> = {};
    const merged = mergeCartoStyle({ sources: {}, layers: [] }, sources);
    expect(Object.keys(sources)).toEqual([]);
    expect(merged.layers).toEqual([]);
  });
});

describe("cartoStyleHasSymbolLayer", () => {
  it("false for a style with no symbol layer", () => {
    expect(cartoStyleHasSymbolLayer(FAKE_CARTO_STYLE)).toBe(false);
  });

  it("true once a symbol layer is present", () => {
    expect(
      cartoStyleHasSymbolLayer({
        ...FAKE_CARTO_STYLE,
        layers: [...(FAKE_CARTO_STYLE.layers ?? []), { id: "place_label", type: "symbol" }],
      }),
    ).toBe(true);
  });
});

describe("composeStyle", () => {
  it("a bare style (basemap: null) is background only", () => {
    const s = composeStyle({ theme: "paper", basemap: null });
    expect(s.layers.map((l) => l.id)).toEqual(["background"]);
    expect(s.sources).toEqual({});
  });

  it("the default basemap merges CARTO's sources/sprite/glyphs/layers, FIRST in the basemap slot", () => {
    const s = composeStyle({ theme: "navy", basemapStyle: FAKE_CARTO_STYLE });
    expect(s.layers.map((l) => l.id)).toEqual([
      "background",
      `${BASEMAP_LAYER_PREFIX}background`,
      `${BASEMAP_LAYER_PREFIX}water`,
    ]);
    expect(s.sources[`${BASEMAP_LAYER_PREFIX}carto`]).toBeDefined();
    expect(s.sprite).toBe(FAKE_CARTO_STYLE.sprite);
  });

  it("an un-warmed basemap (no `basemapStyle` override, nothing cached yet) falls back to background only", () => {
    // no network in a unit test: the default theme's real cache is never warmed here, so this
    // exercises the SAME fallback path a live app takes before loadBasemapStyle() resolves.
    const s = composeStyle({ theme: "navy" });
    expect(s.layers.map((l) => l.id)).toEqual(["background"]);
  });

  it("`basemap: null` still composes with zones/raster — the report's print surface", () => {
    const s = composeStyle({ theme: "paper", basemap: null, zones: [PRA] });
    expect(s.layers.map((l) => l.id)).toEqual(["background", "programarea_ln"]);
    expect(s.sources.basemap).toBeUndefined();
  });

  it("defaults to the globe projection and carries it IN the style (plan atlas-4 §5.3)", () => {
    expect(composeStyle({ theme: "navy", basemap: null }).projection).toEqual({ type: "globe" });
    expect(
      composeStyle({ theme: "navy", basemap: null, projection: "mercator" }).projection,
    ).toEqual({ type: "mercator" });
  });

  it("removing the raster removes exactly that layer — nothing cascades", () => {
    const withRaster = composeStyle({ theme: "navy", basemap: null, raster: SCORE, zones: [PRA] });
    const without = composeStyle({ theme: "navy", basemap: null, raster: null, zones: [PRA] });
    expect(withRaster.layers.map((l) => l.id)).toEqual(["background", "r_lyr", "programarea_ln"]);
    expect(without.layers.map((l) => l.id)).toEqual(["background", "programarea_ln"]);
  });

  it("orders the full stack: basemap, raster, overlay, fills, lines, labels, selection", () => {
    const s = composeStyle({
      theme: "navy",
      basemapStyle: FAKE_CARTO_STYLE,
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
      "basemap-background",
      "basemap-water",
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
      basemap: null,
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
      basemap: null,
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
      basemap: null,
      selection: { features: { type: "FeatureCollection", features: [] }, cellOpacity: true },
    });
    const fill = s.layers.find((l) => l.id === "selection-fill");
    expect(fill && "paint" in fill ? fill.paint : null).toMatchObject({
      "fill-opacity": ["get", "opacity"],
    });
  });

  it("no basemap and no zone labels: glyphs is undefined (no stray font fetch)", () => {
    expect(composeStyle({ theme: "navy", basemap: null, zones: [PRA] }).glyphs).toBeUndefined();
  });

  it("a zone label alone sets glyphs, even with no basemap", () => {
    const withLabels = composeStyle({
      theme: "navy",
      basemap: null,
      zones: [
        {
          ...PRA,
          labels: { points: { type: "FeatureCollection", features: [] }, textProperty: "key" },
        },
      ],
    });
    expect(withLabels.glyphs).toContain("{fontstack}");
  });

  const CARTO_WITH_LABELS: CartoStyleLike = {
    ...FAKE_CARTO_STYLE,
    layers: [...(FAKE_CARTO_STYLE.layers ?? []), { id: "place_label", type: "symbol" }],
  };

  it("the basemap alone sets glyphs (CARTO's own place/road labels), even with no zone labels", () => {
    const s = composeStyle({ theme: "navy", basemapStyle: CARTO_WITH_LABELS, zones: [PRA] });
    expect(s.glyphs).toBe(CARTO_WITH_LABELS.glyphs);
  });

  it("a basemap with NO symbol layer of its own sets no glyphs (no stray font fetch)", () => {
    const s = composeStyle({ theme: "navy", basemapStyle: FAKE_CARTO_STYLE });
    expect(s.glyphs).toBeUndefined();
  });

  it("a `glyphs` override wins over the basemap's own", () => {
    const s = composeStyle({
      theme: "navy",
      basemapStyle: CARTO_WITH_LABELS,
      glyphs: "https://override.example/{fontstack}/{range}.pbf",
    });
    expect(s.glyphs).toBe("https://override.example/{fontstack}/{range}.pbf");
  });

  it("`basemap: null` composes a map with no basemap at all (the report's print surface)", () => {
    const s = composeStyle({ theme: "paper", basemap: null, zones: [PRA] });
    expect(s.layers.map((l) => l.id)).toEqual(["background", "programarea_ln"]);
    expect(s.sources.basemap).toBeUndefined();
  });

  it("the raster resamples NEAREST, so a probed pixel is the cell's own value", () => {
    const s = composeStyle({ theme: "navy", basemap: null, raster: SCORE });
    const r = s.layers.find((l) => l.id === "r_lyr");
    expect(r && "paint" in r ? r.paint : null).toEqual({
      "raster-opacity": SCORE_RASTER_OPACITY,
      "raster-resampling": "nearest",
    });
  });
});

// G-25 fix (docs/parity.html): `Sel.out` used to round-trip in the URL with nothing reading it --
// `out=none` still drew the Program-Area outline. `Shell.svelte` now runs every `zones` array
// through `zoneUnitsWithOutline()` before it reaches `composeStyle()` (rule-level cases live in
// tests/map/zones.test.ts); this is the integration proof, on the REAL composed style, of the
// task's own acceptance rule: "out=none -> no zone line layer (or visibility: none), the default
// -> present".
describe("composeStyle + zoneUnitsWithOutline (G-25: Sel.out reaches the rendered style)", () => {
  it('out="none": the zone-line layer is present in the style but visibility: "none" (never removed -- CLAUDE.md: no addLayer/setLayoutProperty after the fact)', () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      zones: zoneUnitsWithOutline([PRA], "none"),
    });
    const line = s.layers.find((l) => l.id === "programarea_ln");
    expect(line).toBeDefined();
    expect(line && "layout" in line ? line.layout : null).toEqual({ visibility: "none" });
  });

  it('the default outline ("programarea" for the scores lens) renders the line, visible', () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      zones: zoneUnitsWithOutline([PRA], "programarea"),
    });
    const line = s.layers.find((l) => l.id === "programarea_ln");
    expect(line).toBeDefined();
    expect(line && "layout" in line ? line.layout : null).toEqual({ visibility: "visible" });
  });

  it("a hidden outline never hides the SAME unit's choropleth fill (a separate layer/paint property)", () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      zones: zoneUnitsWithOutline(
        [
          {
            ...PRA,
            fill: {
              keyProperty: "programarea_key",
              stops: [{ key: "GAA", color: "#111111" }],
              defaultColor: "lightgrey",
              opacity: 0.7,
              outlineColor: "white",
            },
          },
        ],
        "none",
      ),
    });
    const fill = s.layers.find((l) => l.id === "programarea_fill");
    const line = s.layers.find((l) => l.id === "programarea_ln");
    expect(fill).toBeDefined();
    expect(line && "layout" in line ? line.layout : null).toEqual({ visibility: "none" });
  });

  it('out="ecoregion" on a release that only publishes programarea: the SAME hidden-line result as "none" -- not a bug, plan D17 (no release ever publishes a second, ecoregion-outline unit)', () => {
    const s = composeStyle({
      theme: "navy",
      basemap: null,
      zones: zoneUnitsWithOutline([PRA], "ecoregion"),
    });
    const line = s.layers.find((l) => l.id === "programarea_ln");
    expect(line).toBeDefined();
    expect(line && "layout" in line ? line.layout : null).toEqual({ visibility: "none" });
    // no ecoregion unit was ever IN `zones` to begin with -- nothing composed, not merely hidden.
    expect(s.layers.some((l) => l.id === "ecoregion_ln")).toBe(false);
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
  function fullStack() {
    return composeStyle({
      theme: "navy",
      basemapStyle: FAKE_CARTO_STYLE,
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
  }

  it("the three historically dead ids never appear (pra_ln, pra_lbl, er_ln)", () => {
    const ids = layersControlItems(fullStack()).map((i) => i.id);
    expect(ids).not.toContain("pra_ln");
    expect(ids).not.toContain("pra_lbl");
    expect(ids).not.toContain("er_ln");
  });

  it("every real composed data layer DOES appear", () => {
    const ids = layersControlItems(fullStack()).map((i) => i.id);
    expect(ids).toEqual([
      "r_lyr",
      "outside_pra_lyr",
      "programarea_fill",
      "programarea_ln",
      "ecoregion_ln",
      "programarea_lbl",
    ]);
  });

  it("excludes page chrome, EVERY merged CARTO basemap layer, and the click-driven selection ring (never user-toggleable)", () => {
    const ids = layersControlItems(fullStack()).map((i) => i.id);
    expect(ids).not.toContain("background");
    expect(ids.some((id) => id.startsWith(BASEMAP_LAYER_PREFIX))).toBe(false);
    expect(ids).not.toContain("selection-fill");
    expect(ids).not.toContain("selection-line");
  });

  it("labels the well-known raster/overlay ids exactly as the ported app named them", () => {
    const items = layersControlItems(fullStack());
    expect(items.find((i) => i.id === "r_lyr")?.label).toBe("Raster cell values");
    expect(items.find((i) => i.id === "outside_pra_lyr")?.label).toBe(
      "Cells outside Program Areas",
    );
  });

  it("a bare background+basemap style (nothing selected yet) lists no items", () => {
    expect(
      layersControlItems(composeStyle({ theme: "navy", basemapStyle: FAKE_CARTO_STYLE })),
    ).toEqual([]);
  });
});

describe("applyStyle", () => {
  it("calls setStyle(style, {diff:true}) — and nothing else", () => {
    const setStyle = vi.fn();
    const style = composeStyle({ theme: "navy", basemap: null });
    applyStyle({ setStyle }, style);
    expect(setStyle).toHaveBeenCalledTimes(1);
    expect(setStyle).toHaveBeenCalledWith(style, { diff: true });
  });
});
