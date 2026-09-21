// The coverage fixtures written by the R twin (`msens::cells_in_polygon_grid()`), adopted here byte
// for byte. What this file guards that the loader in coverage.test.ts cannot:
//
//  1. DRIFT. Each adopted file's sha256 is pinned in tests/fixtures/places.sha256.json. The same
//     bytes live in msens inst/fixtures/places/, so an edit on either side is visible: a changed
//     pct here goes red BOTH in the loader (the numbers no longer match) and in the hash (the file
//     is no longer the one msens has).
//  2. The INPUT CONVENTION the two repos settled on (plan D8 addendum, 2026-09-21). There is no
//     disputed list any more — the two antimeridian fixtures were rewritten UNWRAPPED and the
//     wrapped cases moved to the `normalize-*` fixtures, so what is asserted here is that they
//     stayed that way: a coverage fixture carrying a > 180 deg step would mean msens had quietly
//     gone back to guessing at the antimeridian inside coverage.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cellsInPolygon } from "../../src/lib/geo/coverage";
import { isUnwrapped, unwrapPolygon } from "../../src/lib/geo/unwrap";
import { gridFromBoot } from "../../src/lib/grid/grid";
import type { AreaGeometry } from "../../src/lib/geo/types";

const dir = new URL("../fixtures/places/", import.meta.url);
const manifest: { files: Record<string, string>; owed_to_msens: string[] } = JSON.parse(
  readFileSync(new URL("../fixtures/places.sha256.json", import.meta.url), "utf8"),
);

describe("fixtures shared with msens", () => {
  it("pins nineteen files: nine originals, seven msens normalize-*, three written here", () => {
    expect(Object.keys(manifest.files)).toHaveLength(19);
    expect(manifest.files).toHaveProperty("programarea_gaa.json");
    expect(Object.keys(manifest.files).filter((f) => f.startsWith("normalize-"))).toHaveLength(10);
  });

  it("names the files msens still owes an adoption of, and they exist", () => {
    // the copy went the other way for these three: the 180-degree threshold was pinned by no
    // fixture in either language (msens stays green with it set to 90 AND to 270), and neither was
    // usa05's per-vertex 141.10 frame shift
    expect(manifest.owed_to_msens).toHaveLength(3);
    for (const name of manifest.owed_to_msens) {
      expect(manifest.files).toHaveProperty(name);
      expect(JSON.parse(readFileSync(new URL(name, dir), "utf8")).source).toContain("atlas");
    }
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

describe("the antimeridian convention, now settled with msens", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("every coverage fixture's `geometry` is written UNWRAPPED, normalize-* excepted", () => {
    // normalize-* fixtures carry the wrapped ring ON PURPOSE — that is what they are for — and
    // state the unwrapped one beside it. Every other fixture is coverage input, and coverage input
    // is unwrapped by contract.
    for (const name of files) {
      const fx = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
      const geom = (fx.geometry ?? fx.polygon) as AreaGeometry;
      if (name.startsWith("normalize-")) {
        expect(isUnwrapped(fx.unwrapped as AreaGeometry), `${name}.unwrapped`).toBe(true);
        continue;
      }
      expect(isUnwrapped(geom), `${name} carries a > 180 deg longitude step`).toBe(true);
    }
  });

  it("the two antimeridian fixtures and normalize-box-180 describe the SAME ground", () => {
    // the rewritten antimeridian fixture is the unwrapped box; the normalize fixture is the same
    // box written wrapped. Unwrapping the second must reproduce the first's cells on both grids.
    for (const grid_id of ["global05", "usa05"]) {
      const anti = JSON.parse(readFileSync(new URL(`antimeridian_${grid_id}.json`, dir), "utf8"));
      const norm = JSON.parse(
        readFileSync(new URL(`normalize-box-180-${grid_id}.json`, dir), "utf8"),
      );
      const grid = gridFromBoot(anti.grid);
      const got = cellsInPolygon(unwrapPolygon(norm.geometry), grid).map((c) => [c.cell_id, c.pct]);
      expect(got).toEqual(anti.expected.map((e: [number, number]) => [e[0], e[1]]));
      expect(got).toHaveLength(4);
    }
  });
});
