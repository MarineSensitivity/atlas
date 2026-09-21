// the TS twin of msens/R/grid.R (+ the cell_model tile key from msens/R/cell_model.R), driven by
// tests/fixtures/grid_cases.json — hand-derived ground truth, one case per rule/branch (atlas-2
// "grid/": port grid.R exactly, reading the spec from boot.grid, never constants).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  gridFromBoot,
  cellFromLonLat,
  cellLonLat,
  tileOf,
  lonSpan,
  lonSpanAgg,
  bboxSpansGlobe,
  gridSpansGlobe,
} from "../../src/lib/grid/grid";

type GridKey = "global05" | "usa05";
interface Fixture {
  grids: Record<GridKey, { grid_id: string; boot: unknown }>;
  cell_from_lonlat: {
    id: string;
    grid: GridKey;
    lon: number;
    lat: number;
    cell_id: number | null;
  }[];
  cell_lonlat: {
    id: string;
    grid: GridKey;
    cell_id: number;
    lon: number;
    lat: number;
    wrap: boolean;
  }[];
  tile_of: { id: string; grid: GridKey; cell_id: number; tile: number }[];
  lon_span: { id: string; lon: (number | null)[]; span: (number | null)[] }[];
  lon_span_agg: { id: string; args: (number | null)[]; span: (number | null)[] }[];
  bbox_spans_globe: { id: string; bb: (number | null)[] | null; spans: boolean }[];
}

const fx: Fixture = JSON.parse(
  readFileSync(new URL("../fixtures/grid_cases.json", import.meta.url), "utf8"),
);
const grids = {
  global05: gridFromBoot(fx.grids.global05.boot),
  usa05: gridFromBoot(fx.grids.usa05.boot),
};
// NaN stands in for R's non-finite input, which JSON cannot express
const num = (v: number | null) => (v === null ? NaN : v);

describe("gridFromBoot", () => {
  it("reads the spec out of a boot.json-shaped object (never a constant in the app)", () => {
    expect(grids.global05).toEqual({
      gridId: "global05",
      nc: 7200,
      nr: 3600,
      xmin: -180,
      ymax: 90,
      resx: 0.05,
      resy: 0.05,
      lon360: false,
      tileSize: 50,
    });
    expect(grids.usa05.nc).toBe(3103);
    expect(grids.usa05.xmin).toBeCloseTo(141.1, 10);
    expect(grids.usa05.lon360).toBe(true);
  });

  it("accepts the bare grid object as well as the whole boot object", () => {
    const bare = gridFromBoot((fx.grids.usa05.boot as { grid: unknown }).grid);
    expect(bare.nc).toBe(grids.usa05.nc);
    expect(bare.xmin).toBe(grids.usa05.xmin);
  });

  it("throws on a missing or non-numeric field rather than defaulting to a constant", () => {
    expect(() => gridFromBoot({ grid: { nc: 7200, nr: 3600, xmin: -180, ymax: 90 } })).toThrow(
      /resx/,
    );
    expect(() => gridFromBoot(null)).toThrow();
    expect(() => gridFromBoot({ grid: { ...(grids.global05 as object), nc: "7200" } })).toThrow();
  });

  it("knows which grid spans the whole globe in longitude", () => {
    expect(gridSpansGlobe(grids.global05)).toBe(true); // 7200 * 0.05 = 360
    expect(gridSpansGlobe(grids.usa05)).toBe(false); // 3103 * 0.05 = 155.15
  });
});

describe("cellFromLonLat (msens::cell_from_lonlat)", () => {
  for (const c of fx.cell_from_lonlat) {
    it(c.id, () => {
      expect(cellFromLonLat(c.lon, c.lat, grids[c.grid])).toBe(c.cell_id);
    });
  }
});

describe("cellLonLat (msens::cell_lonlat)", () => {
  for (const c of fx.cell_lonlat) {
    it(`${c.id} (wrap=${c.wrap})`, () => {
      const p = cellLonLat(c.cell_id, grids[c.grid], c.wrap);
      expect(p.lon).toBeCloseTo(c.lon, 9);
      expect(p.lat).toBeCloseTo(c.lat, 9);
    });
  }

  it("round-trips every cell_from_lonlat case", () => {
    for (const c of fx.cell_from_lonlat) {
      if (c.cell_id === null) continue;
      const p = cellLonLat(c.cell_id, grids[c.grid], true);
      expect(cellFromLonLat(p.lon, p.lat, grids[c.grid])).toBe(c.cell_id);
    }
  });
});

describe("tileOf (msens::cell_model_tile_sql)", () => {
  for (const c of fx.tile_of) {
    it(c.id, () => {
      expect(tileOf(c.cell_id, grids[c.grid])).toBe(c.tile);
    });
  }

  it("uses THIS grid's nc: the same cell id tiles differently on usa05 and global05", () => {
    // a wrong nc is still a valid tile id, so the query just silently returns nothing
    // (msens/R/cell_model.R:30-33) — the whole reason the width is read from the grid spec
    expect(tileOf(1909113, grids.usa05)).not.toBe(tileOf(1909113, grids.global05));
  });

  it("refuses to guess a tile size that boot.grid does not carry", () => {
    const noTile = gridFromBoot({
      grid: { nc: 7200, nr: 3600, xmin: -180, ymax: 90, resx: 0.05, resy: 0.05, lon360: false },
    });
    expect(noTile.tileSize).toBeNull();
    expect(() => tileOf(1, noTile)).toThrow(/tile/i);
  });
});

describe("lonSpan / lonSpanAgg / bboxSpansGlobe (msens::lon_span etc.)", () => {
  for (const c of fx.lon_span) {
    it(`lonSpan ${c.id}`, () => {
      const got = lonSpan(c.lon.map(num));
      expect(got.map((v) => (Number.isNaN(v) ? null : v))).toEqual(c.span);
    });
  }

  for (const c of fx.lon_span_agg) {
    it(`lonSpanAgg ${c.id}`, () => {
      const [x0, x1, w0, w1] = c.args.map(num);
      const got = lonSpanAgg(x0, x1, w0, w1);
      expect(got.map((v) => (Number.isNaN(v) ? null : v))).toEqual(c.span);
    });
  }

  for (const c of fx.bbox_spans_globe) {
    it(`bboxSpansGlobe ${c.id}`, () => {
      expect(bboxSpansGlobe(c.bb === null ? null : c.bb.map(num))).toBe(c.spans);
    });
  }
});
