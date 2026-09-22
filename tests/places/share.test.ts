import { describe, expect, it } from "vitest";
import { describeShareSummary, diffSimplification, summarizeShare } from "../../src/places/share";
import { DEFAULT_SEL, type Sel } from "../../src/lib/state/types";
import type { GeomPlace } from "../../src/lib/geo/placeCodec";
import type { GridSpec } from "../../src/lib/grid/grid";

const GRID: GridSpec = {
  gridId: "global05",
  nc: 7200,
  nr: 3600,
  xmin: -180,
  ymax: 90,
  resx: 0.05,
  resy: 0.05,
  lon360: false,
  tileSize: 50,
};

const ZONE: Sel = { ...DEFAULT_SEL, ver: "v9", lens: "scores", lyr: "composite" };

describe("summarizeShare", () => {
  it("reads ver/lens/layer/camera/n places off Sel", () => {
    const sel: Sel = { ...ZONE, map: { lon: -100, lat: 40, zoom: 5 } };
    expect(summarizeShare(sel, [{ kind: "zone", set: "pa", keys: ["GAA"] }])).toEqual({
      ver: "v9",
      lens: "scores",
      layer: "composite",
      hasCamera: true,
      nPlaces: 1,
    });
  });

  it("layer falls back to the species key when lyr is absent", () => {
    const sel: Sel = { ...DEFAULT_SEL, sp: "some-species-key", lens: "species" };
    expect(summarizeShare(sel, []).layer).toBe("some-species-key");
  });

  it("ver/layer are null and hasCamera is false when absent", () => {
    expect(summarizeShare(DEFAULT_SEL, [])).toEqual({
      ver: null,
      lens: "scores",
      layer: null,
      hasCamera: false,
      nPlaces: 0,
    });
  });
});

describe("describeShareSummary", () => {
  it("reads as a sentence naming every carried piece", () => {
    const text = describeShareSummary({
      ver: "v9",
      lens: "scores",
      layer: "composite",
      hasCamera: true,
      nPlaces: 2,
    });
    expect(text).toBe(
      'This link carries release v9, the scores lens, layer "composite", the current map view, 2 places.',
    );
  });

  it("singularizes one place", () => {
    const text = describeShareSummary({
      ver: null,
      lens: "species",
      layer: null,
      hasCamera: false,
      nPlaces: 1,
    });
    expect(text).toContain("1 place.");
    expect(text).not.toContain("1 places");
  });
});

describe("diffSimplification", () => {
  const before: GeomPlace = {
    kind: "geom",
    name: "Before",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-124, 40],
          [-124, 40.5],
          [-124, 41],
          [-123.5, 41],
          [-123, 41],
          [-123, 40],
          [-124, 40],
        ],
      ],
    },
  };
  const after: GeomPlace = {
    kind: "geom",
    name: "After",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-124, 40],
          [-124, 41],
          [-123, 41],
          [-123, 40],
          [-124, 40],
        ],
      ],
    },
  };

  it("reports the vertex count drop and the area change percent", () => {
    const diff = diffSimplification(before, after);
    expect(diff.beforeVertices).toBe(7);
    expect(diff.afterVertices).toBe(5);
    expect(diff.areaChangePct).toBeCloseTo(0, 5); // this simplification happens to be area-neutral
  });

  it("cells before/after are null without a grid", () => {
    const diff = diffSimplification(before, after);
    expect(diff.cellsBefore).toBeNull();
    expect(diff.cellsAfter).toBeNull();
  });

  it("cells before/after are computed when a grid IS supplied", () => {
    const diff = diffSimplification(before, after, GRID);
    expect(diff.cellsBefore).toBeGreaterThan(0);
    expect(diff.cellsAfter).toBeGreaterThan(0);
  });
});
