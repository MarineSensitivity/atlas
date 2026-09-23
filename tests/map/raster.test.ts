// 0.10.21 fix 2 — the owner's report: titiler 404s a WebMercatorQuad tile outside a COG's real
// extent (phone console: z3 x∈{0,1,7} y=5, all south of usa05's real latitude range), because the
// raster SOURCE carried no `bounds` at all — MapLibre requests every tile covering the viewport
// regardless. These pin the exact bounds `rasterBoundsForGrid()` computes per grid, and that
// `rasterSource()` only adds `bounds` to the MapLibre source spec when the caller supplies one.
import { describe, expect, it } from "vitest";
import {
  RASTER_TILE_SIZE,
  rasterBoundsForGrid,
  rasterSource,
} from "../../src/lib/map/layers/raster";
import { gridFromBoot, type GridSpec } from "../../src/lib/grid/grid";

/** usa05 (v1-v7), exactly `tests/lens/scores/fixtures.ts`'s `BOOT_V7.grid` — 3103 x 2006 from
 * xmin 141.10 on a 0-360 frame, ymax 82.6. */
const USA05: GridSpec = gridFromBoot({
  grid_id: "usa05",
  grid: { nc: 3103, nr: 2006, xmin: 141.1, ymax: 82.6, resx: 0.05, resy: 0.05, lon360: true },
});

/** global05 (v8+), exactly `tests/lens/scores/fixtures.ts`'s `BOOT_V9.grid` — 7200 x 3600 from
 * -180, ymax 90. */
const GLOBAL05: GridSpec = gridFromBoot({
  grid_id: "global05",
  grid: { nc: 7200, nr: 3600, xmin: -180, ymax: 90, resx: 0.05, resy: 0.05, lon360: false },
});

describe("rasterBoundsForGrid", () => {
  it("usa05: the antimeridian-crossing span becomes the full [-180,180] longitude range, latitude tightened", () => {
    // south = ymax - nr*resy = 82.6 - 2006*0.05 = 82.6 - 100.3 = -17.7 (floating point, so
    // toBeCloseTo on the one computed field rather than toEqual on the whole tuple).
    const [west, south, east, north] = rasterBoundsForGrid(USA05);
    expect(west).toBe(-180);
    expect(south).toBeCloseTo(-17.7, 9);
    expect(east).toBe(180);
    expect(north).toBe(82.6);
  });

  it("global05: already spans the whole globe — same [-180,180] shape, full latitude range too", () => {
    // south = 90 - 3600*0.05 = 90 - 180 = -90
    expect(rasterBoundsForGrid(GLOBAL05)).toEqual([-180, -90, 180, 90]);
  });

  // seeded-fault regression: a naive box built straight from the grid's OWN (0-360) xmin/xmax
  // without checking for the antimeridian wrap would emit `west=141.1, east=-63.75` — numerically
  // west > east. MapLibre's TileBounds.contains() computes `minX/maxX` from those two literally
  // and requires `tileX >= minX && tileX < maxX`; with west > east that is `minX > maxX`, which is
  // never true for ANY tile, so the raster would never paint at all (worse than the 404 this fix
  // exists to silence). This pins that the real function never returns a wrapped box.
  it("never returns a box whose west exceeds its east (the wraparound MapLibre cannot express)", () => {
    const [west, , east] = rasterBoundsForGrid(USA05);
    expect(west).toBeLessThanOrEqual(east);
  });

  it("a grid entirely in one hemisphere, no wrap, keeps its own narrow longitude range", () => {
    // a hypothetical release-shaped grid west of the antimeridian only (never actually published,
    // but exercises the "no wrap" branch with a non-trivial box rather than the full globe).
    const NARROW: GridSpec = gridFromBoot({
      grid: { nc: 1000, nr: 1000, xmin: -170, ymax: 60, resx: 0.05, resy: 0.05, lon360: false },
    });
    // east = -170 + 1000*0.05 = -170 + 50 = -120; south = 60 - 1000*0.05 = 10
    expect(rasterBoundsForGrid(NARROW)).toEqual([-170, 10, -120, 60]);
  });
});

describe("rasterSource", () => {
  const base = { id: "r_lyr", tiles: ["https://titiler.example/{z}/{x}/{y}.png"], opacity: 0.6 };

  it("omits `bounds` when the spec carries none (unchanged behavior)", () => {
    const source = rasterSource(base);
    expect(source).toEqual({ type: "raster", tiles: base.tiles, tileSize: RASTER_TILE_SIZE });
    expect("bounds" in source).toBe(false);
  });

  it("passes `bounds` through verbatim when the spec carries one", () => {
    const bounds: [number, number, number, number] = [-180, -17.7, 180, 82.6];
    const source = rasterSource({ ...base, bounds });
    expect(source).toMatchObject({ bounds });
  });
});
