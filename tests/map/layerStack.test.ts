// R3 layer stack model (round-2 plan §5 U4/§10, `docs/usability.md` §7 R3). Pure logic, no DOM/
// MapLibre — CLAUDE.md "Testing pyramid": one fixture per rule, not one broad end-to-end check.
import { describe, expect, it } from "vitest";
import {
  ALL_LAYER_GROUPS,
  applyLayerGroupStyling,
  classifyBasemapLayer,
  DEFAULT_LAYER_STACK,
  defaultLayerStackEntries,
  formatLayerStack,
  isDefaultLayerStack,
  isLayerGroupId,
  moveLayerStackEntry,
  parseLayerStack,
  type LayerStackEntry,
  type StyleLikeLayer,
} from "../../src/lib/map/layerStack";

describe("defaultLayerStackEntries / isDefaultLayerStack", () => {
  it("every group appears exactly once, all visible at full opacity", () => {
    const entries = defaultLayerStackEntries();
    expect(entries.map((e) => e.id)).toEqual([...DEFAULT_LAYER_STACK]);
    expect(entries.every((e) => e.visible && e.opacity === 1)).toBe(true);
    expect(new Set(entries.map((e) => e.id)).size).toBe(ALL_LAYER_GROUPS.length);
  });

  it("the default stack equals ALL_LAYER_GROUPS as a set (no group left out of the draw order)", () => {
    expect(new Set(DEFAULT_LAYER_STACK)).toEqual(new Set(ALL_LAYER_GROUPS));
  });

  it("basemap sub-roles sit contiguously before every data group (today's rendering, unchanged)", () => {
    const order = DEFAULT_LAYER_STACK;
    const lastBasemap = Math.max(
      ...order.map((id, i) => (id.startsWith("basemap-") ? i : -1)).filter((i) => i >= 0),
    );
    const firstData = order.findIndex((id) => id.startsWith("data-"));
    expect(lastBasemap).toBeLessThan(firstData);
  });

  it("isDefaultLayerStack: true for the default, false for any single deviation", () => {
    const def = defaultLayerStackEntries();
    expect(isDefaultLayerStack(def)).toBe(true);
    expect(isDefaultLayerStack(def.map((e, i) => (i === 0 ? { ...e, visible: false } : e)))).toBe(
      false,
    );
    expect(isDefaultLayerStack(def.map((e, i) => (i === 3 ? { ...e, opacity: 0.5 } : e)))).toBe(
      false,
    );
    expect(isDefaultLayerStack([def[1], def[0], ...def.slice(2)])).toBe(false); // reordered
  });
});

describe("isLayerGroupId", () => {
  it("accepts every real group and rejects garbage", () => {
    for (const id of ALL_LAYER_GROUPS) expect(isLayerGroupId(id)).toBe(true);
    expect(isLayerGroupId("basemap-seafloor-mystery")).toBe(false);
    expect(isLayerGroupId("")).toBe(false);
  });
});

describe("classifyBasemapLayer", () => {
  // a representative sample of CARTO basemap-styles' well-known layer ids (the openmaptiles
  // schema every CARTO GL style — dark-matter and positron alike — is built from), one per bucket,
  // covering the property under test: EVERY layer classifies into exactly one group, never throws,
  // never falls through unassigned.
  const CASES: Array<[{ id: string; type: string }, ReturnType<typeof classifyBasemapLayer>]> = [
    [{ id: "background", type: "background" }, "basemap-land"],
    [{ id: "water", type: "fill" }, "basemap-land"],
    [{ id: "waterway", type: "line" }, "basemap-land"],
    [{ id: "landuse", type: "fill" }, "basemap-land"],
    [{ id: "landcover", type: "fill" }, "basemap-land"],
    [{ id: "park", type: "fill" }, "basemap-land"],
    [{ id: "boundary_country_outline", type: "line" }, "basemap-boundaries"],
    [{ id: "boundary_state", type: "line" }, "basemap-boundaries"],
    [{ id: "boundary_county", type: "line" }, "basemap-boundaries"],
    [{ id: "road_major", type: "line" }, "basemap-roads"],
    [{ id: "road_minor", type: "line" }, "basemap-roads"],
    [{ id: "bridge_major", type: "line" }, "basemap-roads"],
    [{ id: "tunnel_minor", type: "line" }, "basemap-roads"],
    [{ id: "building", type: "fill" }, "basemap-roads"],
    [{ id: "railway", type: "line" }, "basemap-roads"],
    [{ id: "aeroway_line", type: "line" }, "basemap-roads"],
    [{ id: "place_label", type: "symbol" }, "basemap-labels"],
    [{ id: "water_label", type: "symbol" }, "basemap-labels"],
    [{ id: "road_major_label", type: "symbol" }, "basemap-labels"], // symbol wins over the "road" keyword
    [{ id: "poi_label", type: "symbol" }, "basemap-labels"],
    [{ id: "housenum_label", type: "symbol" }, "basemap-labels"],
    [{ id: "hillshade", type: "fill" }, "basemap-bathymetry"],
    [{ id: "contour", type: "line" }, "basemap-bathymetry"],
    [{ id: "some-future-layer-nobody-has-seen-yet", type: "fill" }, "basemap-land"], // unknown -> land
  ];

  it.each(CASES)("%o -> %s", (layer, expected) => {
    expect(classifyBasemapLayer(layer)).toBe(expected);
  });

  it("is TOTAL — never throws, for any id/type pair", () => {
    expect(() => classifyBasemapLayer({ id: "", type: "" })).not.toThrow();
    expect(() => classifyBasemapLayer({ id: "🤷", type: "circle" })).not.toThrow();
  });
});

describe("applyLayerGroupStyling", () => {
  // a bare `{ type }` literal infers a TYPE with no `layout`/`paint` KEY at all, so a later
  // `.layout`/`.paint` read on the (generic, type-preserving) return value would not type-check —
  // this factory just gives every fixture the full `StyleLikeLayer` shape up front.
  const layer = (type: string, extra: Partial<StyleLikeLayer> = {}): StyleLikeLayer => ({
    type,
    ...extra,
  });

  it("opacity 1, visible true: no-op (never touches paint/layout — a CARTO zoom expression survives)", () => {
    const l = layer("fill", { paint: { "fill-color": ["interpolate", ["linear"], ["zoom"]] } });
    const out = applyLayerGroupStyling(l, { visible: true, opacity: 1 });
    expect(out).toEqual(l);
    expect(out.paint).toBe(l.paint); // reference-equal: untouched
  });

  it("visible: false sets layout.visibility=none regardless of type", () => {
    for (const type of ["fill", "line", "symbol", "raster", "background", "circle"]) {
      const out = applyLayerGroupStyling(layer(type), { visible: true, opacity: 1 });
      expect(out.layout).toBeUndefined();
      const hidden = applyLayerGroupStyling(layer(type), { visible: false, opacity: 1 });
      expect(hidden.layout).toEqual({ visibility: "none" });
    }
  });

  it("opacity override sets the right paint key per type", () => {
    expect(applyLayerGroupStyling(layer("raster"), { visible: true, opacity: 0.5 }).paint).toEqual({
      "raster-opacity": 0.5,
    });
    expect(applyLayerGroupStyling(layer("fill"), { visible: true, opacity: 0.5 }).paint).toEqual({
      "fill-opacity": 0.5,
    });
    expect(applyLayerGroupStyling(layer("line"), { visible: true, opacity: 0.25 }).paint).toEqual({
      "line-opacity": 0.25,
    });
    expect(
      applyLayerGroupStyling(layer("background"), { visible: true, opacity: 0.9 }).paint,
    ).toEqual({ "background-opacity": 0.9 });
    expect(applyLayerGroupStyling(layer("circle"), { visible: true, opacity: 0.4 }).paint).toEqual({
      "circle-opacity": 0.4,
    });
    // symbol: BOTH icon and text opacity are set (a label-only or icon-only layer just ignores
    // whichever key it doesn't use — costs nothing, see the module's own header).
    expect(applyLayerGroupStyling(layer("symbol"), { visible: true, opacity: 0.6 }).paint).toEqual({
      "icon-opacity": 0.6,
      "text-opacity": 0.6,
    });
  });

  it("existing paint keys survive an opacity override (only the opacity key(s) are added/replaced)", () => {
    const out = applyLayerGroupStyling(
      layer("fill", { paint: { "fill-color": "#112233", "fill-opacity": 0.9 } }),
      { visible: true, opacity: 0.3 },
    );
    expect(out.paint).toEqual({ "fill-color": "#112233", "fill-opacity": 0.3 });
  });

  it("hidden AND dimmed: both applied together", () => {
    const out = applyLayerGroupStyling(layer("line"), { visible: false, opacity: 0.2 });
    expect(out.layout).toEqual({ visibility: "none" });
    expect(out.paint).toEqual({ "line-opacity": 0.2 });
  });

  it("a type this table does not name is left untouched by opacity, never throws", () => {
    expect(() =>
      applyLayerGroupStyling(layer("heatmap"), { visible: true, opacity: 0.5 }),
    ).not.toThrow();
    expect(
      applyLayerGroupStyling(layer("heatmap"), { visible: true, opacity: 0.5 }).paint,
    ).toBeUndefined();
  });

  it("is pure: never mutates the input layer", () => {
    const l = layer("fill", { paint: { "fill-opacity": 1 } });
    const frozen = JSON.parse(JSON.stringify(l));
    applyLayerGroupStyling(l, { visible: false, opacity: 0.3 });
    expect(l).toEqual(frozen);
  });
});

describe("parseLayerStack / formatLayerStack (layers= round trip)", () => {
  it("null/empty -> null (the default stack)", () => {
    expect(parseLayerStack(null)).toBeNull();
    expect(parseLayerStack("")).toBeNull();
    expect(parseLayerStack("   ")).toBeNull();
  });

  it("formatLayerStack omits the key for null/undefined/the exact default", () => {
    expect(formatLayerStack(null)).toBeNull();
    expect(formatLayerStack(undefined)).toBeNull();
    expect(formatLayerStack(defaultLayerStackEntries())).toBeNull();
  });

  it("a hidden group round-trips", () => {
    const entries = defaultLayerStackEntries().map((e) =>
      e.id === "basemap-labels" ? { ...e, visible: false } : e,
    );
    const token = formatLayerStack(entries);
    expect(token).toContain("basemap-labels:h");
    expect(parseLayerStack(token)).toEqual(entries);
  });

  it("an opacity round-trips at 2-digit percent precision", () => {
    const entries = defaultLayerStackEntries().map((e) =>
      e.id === "data-raster" ? { ...e, opacity: 0.6 } : e,
    );
    const token = formatLayerStack(entries);
    expect(token).toContain("data-raster:o60");
    expect(parseLayerStack(token)).toEqual(entries);
  });

  it("hidden AND dimmed on the same group writes both flags, order-stable", () => {
    const entries = defaultLayerStackEntries().map((e) =>
      e.id === "basemap-roads" ? { ...e, visible: false, opacity: 0.4 } : e,
    );
    const token = formatLayerStack(entries)!;
    expect(token).toContain("basemap-roads:h:o40");
    expect(parseLayerStack(token)).toEqual(entries);
  });

  it("a reordered stack round-trips (order is draw order, bottom to top)", () => {
    const entries = moveLayerStackEntry(defaultLayerStackEntries(), 4, 5); // basemap-labels above data-raster
    expect(entries.map((e) => e.id)).toEqual([
      "basemap-land",
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
      "data-raster",
      "basemap-labels",
      "data-zones",
      "data-places",
    ]);
    const token = formatLayerStack(entries)!;
    expect(parseLayerStack(token)).toEqual(entries);
  });

  it("an unknown group id in the token is dropped, never thrown", () => {
    expect(() => parseLayerStack("bogus-group,data-raster:o50")).not.toThrow();
    const parsed = parseLayerStack("bogus-group,data-raster:o50")!;
    expect(parsed.find((e) => (e.id as string) === "bogus-group")).toBeUndefined();
    expect(parsed.find((e) => e.id === "data-raster")?.opacity).toBe(0.5);
  });

  it("a KNOWN group missing from the token is appended at its default relative position (forward-compat: an old link naming only some groups still names every group once a new one ships)", () => {
    const parsed = parseLayerStack("data-raster:o50")!;
    expect(parsed[0]).toEqual({ id: "data-raster", visible: true, opacity: 0.5 });
    // every OTHER group present, in DEFAULT_LAYER_STACK's own relative order
    const rest = parsed.slice(1).map((e) => e.id);
    expect(rest).toEqual(DEFAULT_LAYER_STACK.filter((id) => id !== "data-raster"));
  });

  it("a garbage opacity flag is ignored (falls back to 1), never thrown", () => {
    const parsed = parseLayerStack("data-raster:o150,basemap-land:oxx")!;
    expect(parsed.find((e) => e.id === "data-raster")?.opacity).toBe(1);
    expect(parsed.find((e) => e.id === "basemap-land")?.opacity).toBe(1);
  });

  it("a duplicated id in the token keeps only the first occurrence", () => {
    const parsed = parseLayerStack("data-raster:h,data-raster:o50")!;
    expect(parsed.filter((e) => e.id === "data-raster")).toHaveLength(1);
    expect(parsed.find((e) => e.id === "data-raster")).toEqual({
      id: "data-raster",
      visible: false,
      opacity: 1,
    });
  });

  it("a token that parses to exactly the default (e.g. every flag redundant) formats back to null", () => {
    expect(parseLayerStack("basemap-land,basemap-bathymetry,basemap-boundaries")).toBeNull();
  });
});

describe("moveLayerStackEntry", () => {
  const ids = (e: readonly LayerStackEntry[]) => e.map((x) => x.id);

  it("moves one entry, leaving the rest in relative order", () => {
    const entries = defaultLayerStackEntries();
    const moved = moveLayerStackEntry(entries, 7, 0); // data-places to the very bottom
    expect(ids(moved)).toEqual([
      "data-places",
      "basemap-land",
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
      "basemap-labels",
      "data-raster",
      "data-zones",
    ]);
  });

  it("clamps an out-of-range destination instead of throwing", () => {
    const entries = defaultLayerStackEntries();
    expect(() => moveLayerStackEntry(entries, 0, 999)).not.toThrow();
    expect(ids(moveLayerStackEntry(entries, 0, 999))[entries.length - 1]).toBe("basemap-land");
    expect(() => moveLayerStackEntry(entries, 0, -50)).not.toThrow();
    expect(ids(moveLayerStackEntry(entries, 0, -50))[0]).toBe("basemap-land");
  });

  it("an out-of-range `from` returns a copy, unchanged", () => {
    const entries = defaultLayerStackEntries();
    expect(moveLayerStackEntry(entries, 99, 0)).toEqual(entries);
  });
});
