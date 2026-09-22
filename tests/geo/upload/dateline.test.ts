// The two spellings of one place across 180 degrees, and the proof they end up as the same place.
//
// Master plan D8 addendum + ruling 2: coverage reads coordinates LITERALLY and guesses nothing, so
// everything the antimeridian needs happens once, at the input boundary. There are exactly two
// spellings a file can arrive in, and they need two different (and both explicit) rules:
//
//   WRAPPED  one ring jumping 178 -> -177          -> unwrapRing(), the shared rule with msens
//   SPLIT    two parts cut at exactly +180/-180    -> seam.ts, framed then stitched
//
// "Read literally" is what makes this test necessary AND what makes it meaningful: the wrapped ring
// covers 7,196 cells on global05 if nobody unwraps it, and the split pair reports a 355-degree bbox
// if nobody joins it.
import { describe, expect, it } from "vitest";
import { cellsInPolygon } from "../../../src/lib/geo/coverage";
import { unwrapPolygon } from "../../../src/lib/geo/unwrap";
import { normalizeUpload } from "../../../src/lib/geo/upload/normalize";
import { hasSeamSplit, stitchSeam, frameSeamSplit } from "../../../src/lib/geo/upload/seam";
import type { AreaGeometry } from "../../../src/lib/geo/types";
import { GRIDS, global05, textBytes } from "./support";
import { aleutianSplit, aleutianWrapped } from "./hostile";

const normalize = async (text: string, name: string) => {
  const r = await normalizeUpload({ name, bytes: textBytes(text) });
  if (!r.ok) throw new Error(`${name}: ${r.refusal.rule} — ${r.refusal.what}`);
  return r.places[0];
};

describe("the Aleutian pair: wrapped and RFC 7946-split are the same place", () => {
  it("normalize to the SAME ring, vertex for vertex", async () => {
    const wrapped = await normalize(aleutianWrapped(), "wrapped.geojson");
    const split = await normalize(aleutianSplit(), "split.geojson");
    expect(split.geometry).toEqual(wrapped.geometry);
    expect(wrapped.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [178, 51],
          [183, 51],
          [183, 53],
          [178, 53],
          [178, 51],
        ],
      ],
    });
  });

  it("cover the SAME cells on BOTH grids", async () => {
    const wrapped = await normalize(aleutianWrapped(), "wrapped.geojson");
    const split = await normalize(aleutianSplit(), "split.geojson");
    for (const [id, grid] of GRIDS) {
      const a = cellsInPolygon(wrapped.geometry, grid);
      const b = cellsInPolygon(split.geometry, grid);
      expect(a.length, id).toBe(4000);
      expect(b, id).toEqual(a);
    }
  });

  it("have the same 5-degree bbox, not the 355-degree one every parser reports", async () => {
    expect((await normalize(aleutianWrapped(), "w.geojson")).bbox).toEqual([178, 51, 183, 53]);
    expect((await normalize(aleutianSplit(), "s.geojson")).bbox).toEqual([178, 51, 183, 53]);
  });

  it("READ LITERALLY, the wrapped ring is the 355-degree complement — which is why the rule exists", () => {
    // 7,100 columns instead of 100, over the same 40 rows: the polygon's own complement, and the
    // measured R-vs-TypeScript disagreement that produced the D8 addendum
    const raw: AreaGeometry = JSON.parse(aleutianWrapped()).features[0].geometry;
    expect(cellsInPolygon(raw, global05).length).toBe((7200 - 100) * 40);
  });

  it("READ LITERALLY, the split pair is already right on cells but wrong on its bbox", () => {
    // this is why the seam rule is about the FRAME, not about the coverage: global05's columns fold
    // modulo nc, so both halves already land where they should — but a 355-degree box would make
    // the map fit the whole world and the codec store a place that spans it
    const raw: AreaGeometry = JSON.parse(aleutianSplit()).features[0].geometry;
    expect(cellsInPolygon(raw, global05).length).toBe(4000);
  });
});

describe("seam.ts fires on the CUT, and on nothing else", () => {
  const poly = (coords: number[][][]): AreaGeometry => ({
    type: "MultiPolygon",
    coordinates: coords.map((r) => [r as [number, number][]]),
  });

  it("recognizes the cut: a vertex at +180 AND one at -180", () => {
    expect(
      hasSeamSplit(
        poly([
          [
            [178, 51],
            [180, 51],
            [180, 53],
            [178, 51],
          ],
          [
            [-180, 51],
            [-177, 51],
            [-177, 53],
            [-180, 51],
          ],
        ]),
      ),
    ).toBe(true);
  });

  it("does NOT fire on a place that merely spans a lot of longitude", () => {
    // -170..170 is 340 degrees wide in naive coordinates and 20 in the 0-360 frame: ambiguous, and
    // therefore left exactly as written rather than guessed at (unwrap.ts documents the same limit)
    const wide = poly([
      [
        [-170, 10],
        [170, 10],
        [170, 12],
        [-170, 10],
      ],
    ]);
    expect(hasSeamSplit(wide)).toBe(false);
    expect(stitchSeam(wide)).toEqual(wide);
  });

  it("does not fire on a MultiPolygon whose parts merely touch each other away from the seam", () => {
    const touching = poly([
      [
        [-93, 26],
        [-92, 26],
        [-92, 28],
        [-93, 26],
      ],
      [
        [-92, 26],
        [-91, 26],
        [-91, 28],
        [-92, 26],
      ],
    ]);
    expect(hasSeamSplit(touching)).toBe(false);
    expect(stitchSeam(touching)).toEqual(touching);
  });

  it("framing is a change of frame, not of shape: only western vertices move, by a whole turn", () => {
    const framed = frameSeamSplit(
      poly([
        [
          [-180, 51],
          [-177, 51],
          [-177, 53],
          [-180, 51],
        ],
      ]),
    ) as AreaGeometry & { type: "MultiPolygon" };
    expect(framed.coordinates[0][0]).toEqual([
      [180, 51],
      [183, 51],
      [183, 53],
      [180, 51],
    ]);
  });

  it("unwrapRing alone cannot repair a split pair — which is why seam.ts exists at all", () => {
    const split: AreaGeometry = JSON.parse(aleutianSplit()).features[0].geometry;
    // every edge in both halves is already short, so the shared rule is a no-op here
    expect(unwrapPolygon(split)).toEqual(split);
  });
});
