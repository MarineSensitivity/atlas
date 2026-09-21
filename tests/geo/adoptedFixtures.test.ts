// The coverage fixtures written by the R twin (`msens::cells_in_polygon_grid()`), adopted here byte
// for byte (atlas-2 fix round 2). Two things this file guards that the loader in coverage.test.ts
// cannot:
//
//  1. DRIFT. Each adopted file's sha256 is pinned in tests/fixtures/places.sha256.json. The same
//     bytes live in msens inst/fixtures/places/, so an edit on either side is visible: a changed
//     pct here goes red BOTH in the loader (the numbers no longer match) and in the hash (the file
//     is no longer the one msens has).
//  2. The ONE disagreement with msens, recorded rather than papered over — the reasoning is in
//     ./disputed.ts, and the two tests at the bottom state BOTH answers so either side changing is
//     immediately visible.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cellsInPolygon } from "../../src/lib/geo/coverage";
import { gridFromBoot } from "../../src/lib/grid/grid";
import type { AreaGeometry } from "../../src/lib/geo/types";
import { DISPUTED } from "./disputed";

const dir = new URL("../fixtures/places/", import.meta.url);
const manifest: { files: Record<string, string> } = JSON.parse(
  readFileSync(new URL("../fixtures/places.sha256.json", import.meta.url), "utf8"),
);

describe("fixtures adopted from msens", () => {
  it("pins nine files, including the Program Area", () => {
    expect(Object.keys(manifest.files)).toHaveLength(9);
    expect(manifest.files).toHaveProperty("programarea_gaa.json");
  });

  for (const [name, want] of Object.entries(manifest.files)) {
    it(`${name} is byte-identical to the msens copy`, () => {
      const got = createHash("sha256")
        .update(readFileSync(new URL(name, dir)))
        .digest("hex");
      expect(got, `${name} has drifted from msens inst/fixtures/places/${name}`).toBe(want);
    });
  }
});

const UNWRAPPED: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [179.9, 50],
      [180.1, 50],
      [180.1, 50.05],
      [179.9, 50.05],
      [179.9, 50],
    ],
  ],
};

describe("the antimeridian convention (the one open disagreement with msens)", () => {
  for (const name of DISPUTED) {
    const fx = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    const grid = gridFromBoot(fx.grid);

    it(`${name}: the SAME box written unwrapped reproduces the msens answer exactly`, () => {
      const got = cellsInPolygon(UNWRAPPED, grid).map((c) => [c.cell_id, c.pct]);
      expect(got).toEqual(fx.expected.map((e: [number, number]) => [e[0], e[1]]));
    });

    it(`${name}: read literally, the fixture's wrapped ring is the complement`, () => {
      // the numbers both sides currently produce, so a change on either side shows up here
      const got = cellsInPolygon(fx.geometry, grid);
      expect(got.length).toBe(name.includes("global05") ? 7196 : 2323);
      expect(fx.expected).toHaveLength(4);
      expect(got.every((c) => c.pct === 100)).toBe(true);
    });
  }
});
