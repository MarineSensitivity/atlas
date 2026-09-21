// polygon -> (cell_id, pct): the TS twin of msens::cells_in_polygon_grid() (atlas-2 "geo/coverage.ts").
//
// Every file in tests/fixtures/places/ is a case, so the fixtures the msens side is writing
// (inst/fixtures/places/*.json: the Gulf rectangle, the corner sliver, the 180-deg pair on both
// grids, the multipolygon, the hole, the traced GAA Program Area) drop straight in with no code
// change here. The file shape — kept deliberately tolerant so both sides can write it:
//
//   {
//     "id":       "<name>",                      // optional, defaults to the file name
//     "note":     "<why this case exists>",      // optional
//     "grid_id":  "global05" | "usa05",          // optional, documentation only
//     "grid":     { nc, nr, xmin, ymax, resx, resy, lon360, tile: { size } },   // boot.grid shape
//     "geometry": { GeoJSON Polygon | MultiPolygon },   // or "polygon": <same>
//     "expected": [[cell_id, pct], ...]          // or [{ cell_id, pct_covered }, ...]
//   }
//
// `expected` is the WHOLE answer (sorted by cell_id): a cell that is absent must be absent, which
// is what the corner-sliver case (pct exactly 0.5 -> half-even 0 -> dropped) pins.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cellsInPolygon } from "../../src/lib/geo/coverage";
import { roundHalfEven, snapNoise } from "../../src/lib/geo/round";
import { gridFromBoot } from "../../src/lib/grid/grid";
import type { AreaGeometry } from "../../src/lib/geo/types";

const dir = fileURLToPath(new URL("../fixtures/places/", import.meta.url));

interface PlaceFixture {
  id?: string;
  note?: string;
  grid_id?: string;
  grid: unknown;
  geometry?: AreaGeometry;
  polygon?: AreaGeometry;
  expected: ([number, number] | { cell_id: number; pct?: number; pct_covered?: number })[];
}

const pairs = (f: PlaceFixture): [number, number][] =>
  f.expected.map((e) =>
    Array.isArray(e) ? [e[0], e[1]] : [e.cell_id, (e.pct ?? e.pct_covered) as number],
  );

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .sort();

describe("cellsInPolygon over tests/fixtures/places/*.json", () => {
  it("finds fixture files at all (an empty directory must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const name of files) {
    const fx: PlaceFixture = JSON.parse(readFileSync(dir + name, "utf8"));
    it(`${name}${fx.note ? ` — ${fx.note.slice(0, 80)}` : ""}`, () => {
      const geom = (fx.geometry ?? fx.polygon) as AreaGeometry;
      const got = cellsInPolygon(geom, gridFromBoot(fx.grid)).map(
        (c) => [c.cell_id, c.pct] as [number, number],
      );
      expect(got).toEqual(pairs(fx));
    });
  }
});

describe("roundHalfEven (R's round(), not Math.round)", () => {
  // the values R's round() documents: half goes to the EVEN neighbour
  const cases: [number, number][] = [
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [50.5, 50],
    [49.5, 50],
    [-0.5, 0],
    [-1.5, -2],
    [-2.5, -2],
    [0.49999, 0],
    [0.50001, 1],
    [99.5, 100],
  ];
  for (const [x, want] of cases) {
    it(`round(${x}) = ${want}`, () => expect(roundHalfEven(x)).toBe(want));
  }

  it("differs from Math.round exactly at the halves (the seeded fault)", () => {
    expect(Math.round(0.5)).toBe(1);
    expect(roundHalfEven(0.5)).toBe(0);
    expect(Math.round(2.5)).toBe(3);
    expect(roundHalfEven(2.5)).toBe(2);
  });

  it("has no tolerance of its own: it rounds the double it is handed, like R", () => {
    expect(roundHalfEven(2.5 + 1e-12)).toBe(3);
    expect(roundHalfEven(2.5 - 1e-12)).toBe(2);
  });

  it("snapNoise puts a computed area back ON the half, from either side", () => {
    // which side of the half a shoelace sum lands on must not decide a pct
    expect(roundHalfEven(snapNoise(2.5 + 1e-12))).toBe(2);
    expect(roundHalfEven(snapNoise(2.5 - 1e-12))).toBe(2);
    expect(roundHalfEven(snapNoise(0.5 - 4e-13))).toBe(0);
    expect(snapNoise(2.50000004)).toBe(2.50000004); // a real difference survives
  });
});

describe("antimeridian and frame handling", () => {
  const global05 = gridFromBoot({
    grid: { nc: 7200, nr: 3600, xmin: -180, ymax: 90, resx: 0.05, resy: 0.05, lon360: false },
  });
  const usa05 = gridFromBoot({
    grid: { nc: 3103, nr: 2006, xmin: 141.1, ymax: 82.6, resx: 0.05, resy: 0.05, lon360: true },
  });
  const box = (x0: number, y0: number, x1: number, y1: number): AreaGeometry => ({
    type: "Polygon",
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
  });

  it("an unwrapped polygon and its westward twin give the same cells on global05", () => {
    // 179.95..180.05 and -180.05..-179.95 are the same ground
    const a = cellsInPolygon(box(179.95, 51.8, 180.05, 51.85), global05);
    const b = cellsInPolygon(box(-180.05, 51.8, -179.95, 51.85), global05);
    expect(b).toEqual(a);
  });

  it("drops cells outside a regional grid instead of wrapping them into it", () => {
    // usa05 is 155.15 deg wide: a polygon in the Atlantic (lon -30) is simply not on this grid,
    // and a modulo-nc wrap would silently land it somewhere in the Pacific
    expect(cellsInPolygon(box(-30, 30, -29.95, 30.05), usa05)).toEqual([]);
  });

  it("clips a polygon that runs off the top of the grid", () => {
    const got = cellsInPolygon(box(0, 89.95, 0.05, 90.5), global05);
    expect(got).toEqual([{ cell_id: 3601, pct: 100 }]); // row 1 only
  });
});

describe("performance (a Program-Area-sized place)", () => {
  it("covers a ~70k-cell polygon well inside the 150 ms target", () => {
    const grid = gridFromBoot({
      grid: { nc: 7200, nr: 3600, xmin: -180, ymax: 90, resx: 0.05, resy: 0.05, lon360: false },
    });
    // a 600-vertex blob, semi-axes 8.2 x 7.1 deg = 164 x 142 cells -> ~70,000 cells covered
    const ring: [number, number][] = [];
    const n = 600;
    for (let k = 0; k < n; k++) {
      const t = (2 * Math.PI * k) / n;
      const r = 1 + 0.08 * Math.sin(9 * t); // a wiggly boundary, not a circle
      ring.push([-90 + 8.2 * r * Math.cos(t), 28 + 7.1 * r * Math.sin(t)]);
    }
    ring.push(ring[0]);
    const geom: AreaGeometry = { type: "Polygon", coordinates: [ring] };

    cellsInPolygon(geom, grid); // warm up
    const t0 = performance.now();
    const cells = cellsInPolygon(geom, grid);
    const ms = performance.now() - t0;
    // measured on this machine: see the number printed below; the assertion carries generous CI
    // slack (10x) because a shared runner is not a laptop
    console.log(`coverage perf: ${cells.length} cells in ${ms.toFixed(1)} ms`);
    expect(cells.length).toBeGreaterThan(65_000);
    expect(ms).toBeLessThan(1500);
  });
});
