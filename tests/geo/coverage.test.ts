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
//
//     // a `normalize-*` fixture additionally carries (plan D8 addendum):
//     "unwrapped": { GeoJSON },                  // what unwrapRing() must make of `geometry`
//     "cells_if_read_literally": <n>             // how many cells `geometry` covers UNUNWRAPPED
//   }
//
// `expected` is the WHOLE answer (sorted by cell_id): a cell that is absent must be absent, which
// is what the corner-sliver case (pct exactly 0.5 -> half-even 0 -> dropped) pins. On a
// `normalize-*` fixture it is the coverage of the UNWRAPPED ring, so the loader unwraps first —
// and `cells_if_read_literally` is there so that unwrapping quietly moving INSIDE coverage.ts (the
// one thing the addendum forbids) cannot pass: the wrapped ring must still read as written.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cellsInPolygon } from "../../src/lib/geo/coverage";
import { roundHalfEven, snapNoise } from "../../src/lib/geo/round";
import { normalizeForAnalysis, unwrapPolygon } from "../../src/lib/geo/unwrap";
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
  unwrapped?: AreaGeometry;
  cells_if_read_literally?: number;
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
    expect(files.length).toBeGreaterThanOrEqual(33);
    expect(files).toContain("programarea_gaa.json"); // the R-made Program Area
    // the ten shared normalize-* vectors, without which the unwrap rule is untested: seven from
    // msens, plus the three written here (both threshold cases and usa05's 141.10 seam)
    expect(files.filter((f) => f.startsWith("normalize-"))).toHaveLength(10);
  });

  for (const name of files) {
    const fx: PlaceFixture = JSON.parse(readFileSync(dir + name, "utf8"));
    const label = `${name}${fx.note ? ` — ${fx.note.slice(0, 80)}` : ""}`;
    const geom = (fx.geometry ?? fx.polygon) as AreaGeometry;

    // a normalize-* fixture pins the WHOLE boundary contract, in three separate assertions so a
    // failure names which half broke: the rule, the math, or the separation between them
    if (fx.unwrapped) {
      describe(label, () => {
        it("unwrap(wrapped) is the fixture's unwrapped ring, exactly", () => {
          expect(unwrapPolygon(geom)).toEqual(fx.unwrapped);
          expect(normalizeForAnalysis(geom)).toEqual(fx.unwrapped); // the composed entry point too
        });

        it("coverage(unwrapped) is the fixture's cells", () => {
          const got = cellsInPolygon(fx.unwrapped as AreaGeometry, gridFromBoot(fx.grid)).map(
            (c) => [c.cell_id, c.pct] as [number, number],
          );
          expect(got).toEqual(pairs(fx));
        });

        it("coverage(wrapped) still reads the ring LITERALLY — unwrap is never inside coverage", () => {
          const got = cellsInPolygon(geom, gridFromBoot(fx.grid));
          expect(got.length).toBe(fx.cells_if_read_literally);
        });
      });
      continue;
    }

    it(label, () => {
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

  // the ruling of 2026-09-21: coverage.ts frames a `lon360` grid's coordinates PER VERTEX, the
  // twin of msens `.frame_ring()` (place.R:130-133), rather than shifting the whole polygon by the
  // turns its westernmost vertex needs. The two rules agree on every UNWRAPPED fixture — which is
  // why the disagreement survived a whole round — and differ on everything else, so they cannot
  // both be the twin. The numbers below are what settles it.
  describe("the per-vertex frame shift on a lon360 grid", () => {
    it("reads a WRAPPED box on usa05 as 4 cells, as R does (a whole-polygon shift said 2,323)", () => {
      // usa05's frame is cut at 141.10 E, not at 180, so per vertex 179.9 stays and -179.9 becomes
      // 180.1: the ring is contiguous here even though it is wrapped. Under the old whole-polygon
      // shift the SAME ring became 180.1..539.9 and covered 2,323 cells of the window.
      const got = cellsInPolygon(box(179.9, 50, -179.9, 50.05), usa05);
      expect(got).toEqual([
        { cell_id: 2020830, pct: 100 },
        { cell_id: 2020831, pct: 100 },
        { cell_id: 2020832, pct: 100 },
        { cell_id: 2020833, pct: 100 },
      ]);
      // and global05, which has no frame to shift into, still reads the complement literally
      expect(cellsInPolygon(box(179.9, 50, -179.9, 50.05), global05)).toHaveLength(7196);
    });

    it("tears a ring that crosses the 141.10 seam itself, identically on both sides", () => {
      // 140 is west of usa05's window start, so it frames to 500 while 142 stays: the ring spans
      // 142..500 and the grid keeps columns 19..3103 of row 652. The old whole-polygon shift moved
      // the WHOLE box to 500..502 and returned nothing at all, which is the other way to be wrong.
      const got = cellsInPolygon(box(140, 50, 142, 50.05), usa05);
      expect(got).toHaveLength(3085);
      expect(got[0]).toEqual({ cell_id: 651 * 3103 + 19, pct: 100 });
      expect(got[got.length - 1]).toEqual({ cell_id: 651 * 3103 + 3103, pct: 100 });
      expect(got.every((c) => c.pct === 100)).toBe(true);
    });

    it("uses R's floor-division modulus, not fmod: the Gulf frames to 270 on usa05", () => {
      // -90 IS 270 on a window that starts at 141.10 E. `((x % 360) + 360) % 360` would answer
      // 1.4e-14 deg away from R here, which is exactly the size that moves a knife-edge cell.
      expect(cellsInPolygon(box(-90, 27, -89.95, 27.05), usa05)).toEqual(
        cellsInPolygon(box(270, 27, 270.05, 27.05), usa05),
      );
    });
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

  it("covers the traced GAA Program Area (many cells is cheap; many VERTICES is not)", () => {
    // the R-made fixture: 14,238 cells from a 63,417-vertex outline. Cost here is dominated by the
    // vertex count, not the cell count — the scanline walks every segment once per row — so this
    // gets its own budget line: measured median 124.9 ms against the subplan's 150 ms, where the
    // 74k-CELL blob above (600 vertices) takes 37 ms. See the report: bucketing segments by row
    // would cut it, and is deliberately NOT done in this close-out round.
    const fx: PlaceFixture = JSON.parse(readFileSync(dir + "programarea_gaa.json", "utf8"));
    const grid = gridFromBoot(fx.grid);
    const geom = (fx.geometry ?? fx.polygon) as AreaGeometry;
    cellsInPolygon(geom, grid); // warm up
    const t0 = performance.now();
    const cells = cellsInPolygon(geom, grid);
    const ms = performance.now() - t0;
    console.log(
      `coverage perf (GAA, 63,417 vertices): ${cells.length} cells in ${ms.toFixed(1)} ms`,
    );
    expect(cells.length).toBe(14_238);
    expect(ms).toBeLessThan(2000); // generous CI slack over the ~125 ms measured here
  });
});
