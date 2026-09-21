// Why `snapNoise()` exists, and the proof that it is load-bearing (atlas-2 fix round 1).
//
// A drawn rectangle whose coverage of a cell is an exact half of a percent (0.5 %, 2.5 %, 3.5 %)
// is not a contrived case: it is what snapping a corner to a tenth of a cell produces. The
// clipping arithmetic cannot deliver that half exactly — (lon + 180) / 0.05 is inexact for almost
// every lon — so the raw `frac * 100` arrives a few 1e-13 above or below it, and R's round() would
// then be deciding a published `pct` by the last bit of a subtraction. Snapping to 1e-9 first puts
// the number back ON the half, where half-to-even can do its job; the R twin does the same with
// `round(round(x, 9))`.
//
// The four tests/fixtures/places/knife-edge-*.json cases are the red: with the snap removed from
// coverage.ts the loader test fails on all four. This file adds two things the fixtures cannot
// say themselves — that such rectangles are everywhere rather than cherry-picked, and that 1e-9 is
// too small to move a value that is NOT a half.
//
// Regenerate the fixtures (after changing the clipper, say) with:
//   KNIFE_EDGE_WRITE=1 npx vitest run tests/geo/knifeEdge.test.ts && npm run format
// Explore the whole search space with:
//   KNIFE_EDGE_SEARCH=1 npx vitest run tests/geo/knifeEdge.test.ts --reporter=verbose
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { cellFractions, cellsInPolygon } from "../../src/lib/geo/coverage";
import { roundHalfEven, snapNoise } from "../../src/lib/geo/round";
import { gridFromBoot, type GridSpec } from "../../src/lib/grid/grid";
import type { AreaGeometry } from "../../src/lib/geo/types";

const GLOBAL05 = {
  grid_id: "global05",
  grid: {
    nc: 7200,
    nr: 3600,
    xmin: -180,
    ymax: 90,
    resx: 0.05,
    resy: 0.05,
    lon360: false,
    tile: { size: 50 },
  },
};
const USA05 = {
  grid_id: "usa05",
  grid: {
    nc: 3103,
    nr: 2006,
    xmin: 141.1,
    ymax: 82.6,
    resx: 0.05,
    resy: 0.05,
    lon360: true,
    tile: { size: 50 },
  },
};
const global05 = gridFromBoot(GLOBAL05);
const usa05 = gridFromBoot(USA05);

const rect = (x0: number, y0: number, x1: number, y1: number): AreaGeometry => ({
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

// 40000 * w * h = the target percent, for a rectangle hanging off a cell corner
const SHAPES: [number, number, number][] = [];
for (const [target, pairs] of [
  [
    0.5,
    [
      [0.0025, 0.005],
      [0.005, 0.0025],
      [0.00125, 0.01],
      [0.01, 0.00125],
      [0.025, 0.0005],
    ],
  ],
  [
    2.5,
    [
      [0.0125, 0.005],
      [0.005, 0.0125],
      [0.025, 0.0025],
      [0.0025, 0.025],
      [0.00625, 0.01],
    ],
  ],
  [
    3.5,
    [
      [0.0175, 0.005],
      [0.005, 0.0175],
      [0.035, 0.0025],
      [0.0025, 0.035],
      [0.00875, 0.01],
    ],
  ],
] as [number, number[][]][]) {
  for (const [w, h] of pairs) SHAPES.push([target, w, h]);
}

interface Hit {
  target: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  raw: number;
  unsnapped: number;
  snapped: number;
}

/** every rectangle in the sweep whose UNSNAPPED rounding disagrees with the snapped one */
function search(
  grid: GridSpec,
  xs: number[],
  ys: number[],
  lonOut: (x: number) => number,
): { tried: number; hits: Hit[] } {
  const hits: Hit[] = [];
  let tried = 0;
  for (const xb of xs) {
    for (const yb of ys) {
      for (const [target, w, h] of SHAPES) {
        tried++;
        const x0 = lonOut(Number((xb - w).toFixed(6)));
        const x1 = lonOut(xb);
        for (const f of cellFractions(rect(x0, yb, x1, yb + h), grid).values()) {
          const raw = f * 100;
          if (Math.abs(raw - target) > 1e-6) continue;
          const unsnapped = roundHalfEven(raw);
          const snapped = roundHalfEven(snapNoise(raw));
          if (unsnapped !== snapped)
            hits.push({ target, x0, y0: yb, x1, y1: yb + h, raw, unsnapped, snapped });
        }
      }
    }
  }
  return { tried, hits };
}

const seq = (from: number, n: number, step: number) =>
  Array.from({ length: n }, (_, i) => Number((from + i * step).toFixed(4)));

describe("the 1e-9 snap is load-bearing, not a cosmetic tolerance", () => {
  it("exact-half rectangles land on the WRONG side of the half all over the Gulf", () => {
    const g = search(global05, seq(-90, 24, 0.05), seq(27, 24, 0.05), (x) => x);
    const u = search(
      usa05,
      seq(141.1 + 2570 * 0.05, 24, 0.05),
      seq(82.6 - 1110 * 0.05, 24, -0.05),
      (x) => Number((x - 360).toFixed(6)),
    );
    // not a cherry-picked coordinate: roughly half of every exact-half rectangle tried is decided
    // the wrong way by the last bits of the clipping arithmetic
    expect(g.hits.length / g.tried).toBeGreaterThan(0.2);
    expect(u.hits.length / u.tried).toBeGreaterThan(0.2);
    console.log(
      `knife-edge sweep: global05 ${g.hits.length}/${g.tried}, usa05 ${u.hits.length}/${u.tried} rectangles round the wrong way unsnapped`,
    );
  });

  it("1e-9 is too small to move a value that is not a half", () => {
    // nobody may widen the snap: a real 2.4999 must stay 2 and a real 2.5001 must become 3
    expect(roundHalfEven(snapNoise(2.4999))).toBe(2);
    expect(roundHalfEven(snapNoise(2.5001))).toBe(3);
    expect(snapNoise(2.4999)).toBe(2.4999);
    expect(snapNoise(2.5001)).toBe(2.5001);
    // the smallest difference the snap must still respect, either side of the half
    expect(snapNoise(2.5 + 1e-8)).toBe(2.50000001);
    expect(roundHalfEven(snapNoise(2.5 + 1e-8))).toBe(3);
    expect(roundHalfEven(snapNoise(2.5 - 1e-8))).toBe(2);
    // and it only ever moves a number by less than half a snap step
    for (const x of [0.5, 2.5, 3.5, 12.345678901, 99.9999999996]) {
      expect(Math.abs(snapNoise(x) - x)).toBeLessThanOrEqual(5e-10);
    }
  });

  it.runIf(process.env.KNIFE_EDGE_SEARCH)("prints the whole sweep", () => {
    const g = search(global05, seq(-95, 200, 0.05), seq(25, 100, 0.05), (x) => x);
    const u = search(
      usa05,
      seq(141.1 + 2500 * 0.05, 200, 0.05),
      seq(82.6 - 1150 * 0.05, 100, 0.05),
      (x) => Number((x - 360).toFixed(6)),
    );
    console.log(`global05 ${g.hits.length}/${g.tried}; usa05 ${u.hits.length}/${u.tried}`);
    for (const h of [...g.hits.slice(0, 20), ...u.hits.slice(0, 20)]) {
      console.log(
        `target ${h.target} [${h.x0}, ${h.y0}, ${h.x1}, ${h.y1}] raw ${h.raw.toPrecision(17)} unsnapped ${h.unsnapped} snapped ${h.snapped}`,
      );
    }
  });
});

// ---- the committed knife-edge fixtures ---------------------------------------------------------

/** the four human-readable cases kept out of the sweep above */
const CASES = [
  {
    file: "knife-edge-0p5-global05.json",
    boot: GLOBAL05,
    grid: global05,
    r: [-89.9525, 27.05, -89.95, 27.055] as const,
    target: 0.5,
    why: "0.0025 x 0.005 deg in the corner of a cell = exactly 0.5 %. Half-even sends it to 0 and the cell is DROPPED; unsnapped, the raw value sits just above the half and the cell is kept at 1.",
  },
  {
    file: "knife-edge-2p5-global05.json",
    boot: GLOBAL05,
    grid: global05,
    r: [-89.9625, 27.05, -89.95, 27.055] as const,
    target: 2.5,
    why: "0.0125 x 0.005 deg = exactly 2.5 %, which half-even rounds DOWN to 2; unsnapped the raw sits above the half and rounds to 3.",
  },
  {
    file: "knife-edge-3p5-global05.json",
    boot: GLOBAL05,
    grid: global05,
    r: [-89.955, 27.05, -89.95, 27.0675] as const,
    target: 3.5,
    why: "0.005 x 0.0175 deg = exactly 3.5 %, which half-even rounds UP to 4 — and unsnapped the raw sits just BELOW the half and rounds to 3. The error runs both ways, so the snap is not a one-sided fudge.",
  },
  {
    file: "knife-edge-2p5-usa05.json",
    boot: USA05,
    grid: usa05,
    r: [-93.9125, 25.1, -93.9, 25.105] as const,
    target: 2.5,
    why: "the same 2.5 % case in the usa05 frame (lon -93.90 = 266.10 and lat 25.10 are both cell boundaries there), where the polygon is ALSO shifted +360 into 141.10-based longitudes before the clip — more inexact arithmetic, same conclusion.",
  },
];

describe("knife-edge fixtures", () => {
  for (const c of CASES) {
    const geom = rect(c.r[0], c.r[1], c.r[2], c.r[3]);
    // a rectangle whose edge sits ON a cell boundary also touches the cell beyond it by ~1e-16 of
    // a cell, because (lon + 180) / 0.05 is inexact. That dust never survives `pct > 0`; drop it
    // here too, so "which cell is this case about" stays a question with one answer.
    const entries = [...cellFractions(geom, c.grid).entries()].filter(([, f]) => f * 100 > 1e-6);

    it(`${c.file} really is a knife edge`, () => {
      expect(entries).toHaveLength(1);
      const [cellId, f] = entries[0];
      const raw = f * 100;
      expect(Math.abs(raw - c.target)).toBeLessThan(1e-9); // it IS the half, mathematically
      expect(raw).not.toBe(c.target); // but not in floating point
      const unsnapped = roundHalfEven(raw);
      const snapped = roundHalfEven(snapNoise(raw));
      expect(unsnapped).not.toBe(snapped); // and the two rules disagree about it
      expect(cellsInPolygon(geom, c.grid)).toEqual(
        snapped > 0 ? [{ cell_id: cellId, pct: snapped }] : [],
      );
    });

    if (process.env.KNIFE_EDGE_WRITE) {
      const [cellId, f] = entries[0];
      const raw = f * 100;
      const snapped = roundHalfEven(snapNoise(raw));
      writeFileSync(
        new URL(`../fixtures/places/${c.file}`, import.meta.url),
        JSON.stringify(
          {
            id: c.file.replace(".json", ""),
            source: "atlas (found by the sweep in tests/geo/knifeEdge.test.ts)",
            note: c.why,
            grid_id: c.boot.grid_id,
            grid: c.boot.grid,
            geometry: geom,
            expected: snapped > 0 ? [[cellId, snapped]] : [],
            knife_edge: {
              cell_id: cellId,
              exact_pct: c.target,
              raw_pct_unsnapped: raw.toPrecision(17),
              pct_without_snap: roundHalfEven(raw),
              pct_with_snap: snapped,
              rule: "pct = round_half_even(round(frac * 100, 9)); R: round(round(x, 9))",
              note: "raw_pct_unsnapped is this clipper's value, for documentation — another implementation will land a few 1e-13 elsewhere. What both must agree on is pct_with_snap.",
            },
          },
          null,
          2,
        ) + "\n",
      );
    }
  }
});
