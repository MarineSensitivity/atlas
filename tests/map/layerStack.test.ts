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
  normalizeLayerStack,
  parseLayerStack,
  scaleOpacity,
  type LayerStackEntry,
  type StyleLikeLayer,
} from "../../src/lib/map/layerStack";

// B1 (blocker, Opus 5.5 review): `applyLayerGroupStyling` used to REPLACE a layer's existing
// opacity paint value with the stack's own opacity, instead of scaling it -- painting every zone's
// invisible `fill-opacity: 0` query fill (B3, 0.10.26) visible at any dimmed opacity, collapsing a
// per-cell `["get","opacity"]` selection expression to one flat number, and making the raster
// non-monotonic (0.6 at 100% opacity, but 0.95 at a 95% SLIDER value). One fixture per shape
// `scaleOpacity` must handle, per the review's own enumeration.
describe("scaleOpacity (B1 fix)", () => {
  it("k=1 is a pure no-op — returns the SAME reference, not just an equal value", () => {
    const expr = ["interpolate", ["linear"], ["zoom"], 0, 0.2, 10, 0.8];
    expect(scaleOpacity(undefined, 1)).toBeUndefined();
    expect(scaleOpacity(0.6, 1)).toBe(0.6);
    expect(scaleOpacity(expr, 1)).toBe(expr); // reference-equal
  });

  it("undefined (no existing opacity key) scales to exactly k — MapLibre's own default is 1", () => {
    expect(scaleOpacity(undefined, 0.5)).toBe(0.5);
    expect(scaleOpacity(undefined, 0.25)).toBe(0.25);
  });

  it("a plain number multiplies", () => {
    expect(scaleOpacity(0.6, 0.25)).toBeCloseTo(0.15);
    expect(scaleOpacity(0.9, 0.3)).toBeCloseTo(0.27);
    expect(scaleOpacity(0, 0.5)).toBe(0); // B1's own query-fill regression: 0 x k stays 0
  });

  it("a {stops} legacy style function scales every stop's value, keeping the zoom breakpoints", () => {
    expect(
      scaleOpacity(
        {
          stops: [
            [0, 0.2],
            [10, 1],
          ],
        },
        0.5,
      ),
    ).toEqual({
      stops: [
        [0, 0.1],
        [10, 0.5],
      ],
    });
  });

  it("an interpolate expression scales every OUTPUT, leaving the interpolation/input/stops alone", () => {
    const expr = ["interpolate", ["linear"], ["zoom"], 0, 0.2, 10, 0.8];
    expect(scaleOpacity(expr, 0.5)).toEqual(["interpolate", ["linear"], ["zoom"], 0, 0.1, 10, 0.4]);
  });

  it("a step expression scales every output INCLUDING the base (output0), leaving stops alone", () => {
    const expr = ["step", ["zoom"], 0.2, 5, 0.6, 10, 1];
    expect(scaleOpacity(expr, 0.5)).toEqual(["step", ["zoom"], 0.1, 5, 0.3, 10, 0.5]);
  });

  it('any other expression is wrapped as ["*", existing, k] — MapLibre\'s own runtime multiply', () => {
    expect(scaleOpacity(["get", "opacity"], 0.5)).toEqual(["*", ["get", "opacity"], 0.5]);
    expect(scaleOpacity(["case", ["==", ["get", "x"], 1], 0.8, 0.2], 0.4)).toEqual([
      "*",
      ["case", ["==", ["get", "x"], 1], 0.8, 0.2],
      0.4,
    ]);
  });
});

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

// m10 (review round 1): `style.ts#composeStyle` takes `layerStack` directly, not only through
// `parseLayerStack`'s own repair of a URL string -- a hand-built, incomplete array used to make
// `orderLayers` throw ("has a role ... which is not in the declared stack order") the moment a
// layer in the missing group's roles was composed.
describe("normalizeLayerStack", () => {
  it("a complete stack passes through UNCHANGED (same array reference)", () => {
    const def = defaultLayerStackEntries();
    expect(normalizeLayerStack(def)).toBe(def);
  });

  it("a stack missing ONE group gets it appended, default visible/opacity, at the END", () => {
    const partial = defaultLayerStackEntries().filter((e) => e.id !== "data-places");
    const out = normalizeLayerStack(partial);
    expect(out.map((e) => e.id)).toEqual([...partial.map((e) => e.id), "data-places"]);
    expect(out.at(-1)).toEqual({ id: "data-places", visible: true, opacity: 1 });
  });

  it("a stack missing SEVERAL groups gets all of them appended, in DEFAULT_LAYER_STACK's own relative order", () => {
    const partial = defaultLayerStackEntries().filter(
      (e) => e.id !== "data-places" && e.id !== "basemap-bathymetry",
    );
    const out = normalizeLayerStack(partial);
    expect(out.map((e) => e.id)).toEqual([
      ...partial.map((e) => e.id),
      "basemap-bathymetry",
      "data-places",
    ]);
  });

  it("an empty stack normalises to exactly the default stack", () => {
    expect(normalizeLayerStack([])).toEqual(defaultLayerStackEntries());
  });

  it("a REORDERED but complete stack is left alone (normalising is about MISSING groups, not order)", () => {
    const def = defaultLayerStackEntries();
    const reordered = [def[1], def[0], ...def.slice(2)];
    expect(normalizeLayerStack(reordered)).toBe(reordered);
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

  // B1 fix (Opus 5.5 review): the group opacity SCALES the layer's own existing opacity key, it
  // never REPLACES it — 0.9 (existing) x 0.3 (stack) = 0.27, never the bare 0.3 the old (replacing)
  // behaviour produced. `fill-color` (a non-opacity key) survives untouched either way.
  it("existing paint keys survive an opacity override, and the opacity key is SCALED, not replaced (0.9 x 0.3 = 0.27)", () => {
    const out = applyLayerGroupStyling(
      layer("fill", { paint: { "fill-color": "#112233", "fill-opacity": 0.9 } }),
      { visible: true, opacity: 0.3 },
    );
    expect(out.paint).toEqual({ "fill-color": "#112233", "fill-opacity": 0.27 });
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

  // M2 fix (Opus 5.5 review): a partial token used to bury its own named group at the very BOTTOM
  // of the stack (array index 0), with every OTHER group appended ABOVE it -- so naming only
  // `data-raster` put it UNDER every basemap group, including the opaque land fill, making the
  // raster invisible. The fix inserts each missing id right after its own nearest earlier DEFAULT
  // predecessor, so a partial token reconstructs the FULL default order around the one entry it
  // customizes -- `data-raster` keeps its OWN default position (after all five basemap groups),
  // not the front of the array.
  it("a KNOWN group missing from the token is inserted at its OWN default relative position, not appended at the array's end", () => {
    const parsed = parseLayerStack("data-raster:o50")!;
    expect(parsed.map((e) => e.id)).toEqual(DEFAULT_LAYER_STACK);
    expect(parsed.find((e) => e.id === "data-raster")).toEqual({
      id: "data-raster",
      visible: true,
      opacity: 0.5,
    });
  });

  it("a partial token naming a LATE group still reconstructs every earlier default id in order", () => {
    // only "data-places" is named -- every basemap group AND data-raster/data-zones must land
    // BEFORE it, in their own default order, not all piled after it.
    const parsed = parseLayerStack("data-places:h")!;
    expect(parsed.map((e) => e.id)).toEqual(DEFAULT_LAYER_STACK);
    expect(parsed.find((e) => e.id === "data-places")?.visible).toBe(false);
  });

  it("two non-adjacent named groups: the ones between them still land in default order", () => {
    // basemap-land and data-zones named, in DEFAULT order already -- everything else (bathymetry,
    // boundaries, roads, labels, data-raster, data-places) must reconstruct around them correctly.
    const parsed = parseLayerStack("basemap-land:o80,data-zones:h")!;
    expect(parsed.map((e) => e.id)).toEqual(DEFAULT_LAYER_STACK);
    expect(parsed.find((e) => e.id === "basemap-land")?.opacity).toBe(0.8);
    expect(parsed.find((e) => e.id === "data-zones")?.visible).toBe(false);
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

  it("moves one (non-data-places) entry, leaving the rest in relative order", () => {
    const entries = defaultLayerStackEntries();
    const moved = moveLayerStackEntry(entries, 0, 4); // basemap-land above basemap-labels
    expect(ids(moved)).toEqual([
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
      "basemap-labels",
      "basemap-land",
      "data-raster",
      "data-zones",
      "data-places",
    ]);
  });

  it("clamps an out-of-range destination instead of throwing", () => {
    const entries = defaultLayerStackEntries();
    expect(() => moveLayerStackEntry(entries, 0, 999)).not.toThrow();
    expect(() => moveLayerStackEntry(entries, 0, -50)).not.toThrow();
    expect(ids(moveLayerStackEntry(entries, 0, -50))[0]).toBe("basemap-land");
  });

  it("an out-of-range `from` returns a copy, unchanged", () => {
    const entries = defaultLayerStackEntries();
    expect(moveLayerStackEntry(entries, 99, 0)).toEqual(entries);
  });

  // --- M7 fix (Opus 5.5 review): data-places pinned, data-raster<data-zones<data-places fixed ----

  it("data-places can never be moved — any attempt to move IT returns entries unchanged", () => {
    const entries = defaultLayerStackEntries();
    const placesIdx = entries.findIndex((e) => e.id === "data-places");
    expect(moveLayerStackEntry(entries, placesIdx, 0)).toEqual(entries);
    expect(moveLayerStackEntry(entries, placesIdx, 3)).toEqual(entries);
  });

  it("nothing else can move TO OR PAST data-places' own position — it stays topmost", () => {
    const entries = defaultLayerStackEntries();
    // try to move basemap-land (index 0) all the way to the top (past data-places) --
    // clamped to just BELOW data-places, never past it.
    const moved = moveLayerStackEntry(entries, 0, 999);
    expect(ids(moved)[ids(moved).length - 1]).toBe("data-places");
    expect(ids(moved)[ids(moved).length - 2]).toBe("basemap-land");
  });

  it("a move that would invert data-raster/data-zones' relative order is rejected outright", () => {
    const entries = defaultLayerStackEntries();
    const zonesIdx = entries.findIndex((e) => e.id === "data-zones");
    const rasterIdx = entries.findIndex((e) => e.id === "data-raster");
    // move data-zones to BEFORE data-raster's own position -- would invert the fixed pair.
    expect(moveLayerStackEntry(entries, zonesIdx, rasterIdx - 1)).toEqual(entries);
  });

  it("basemap groups can still move freely relative to data-raster/data-zones (only DATA-vs-DATA is fixed)", () => {
    const entries = defaultLayerStackEntries();
    // basemap-labels (index 4) above data-raster (index 5) -- Ben's own example move, still legal.
    const moved = moveLayerStackEntry(entries, 4, 5);
    expect(ids(moved)).toEqual([
      "basemap-land",
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
      "data-raster",
      "basemap-labels",
      "data-zones",
      "data-places",
    ]);
  });
});
