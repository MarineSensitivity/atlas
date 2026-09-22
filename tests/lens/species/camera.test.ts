// camera.ts: the antimeridian gate over REAL published extents, the four-step fallback, and
// "re-fit only on species change".
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_PADDING,
  cameraFor,
  centerLon,
  inputBbox,
  lonSpanOf,
  minimalFrame,
  refitNeeded,
  studyAreaView,
  type BoundsCamera,
} from "../../../src/lens/species/data/camera";
import { MERGED_IN } from "../../../src/lens/species/data/resolve";
import type { Bbox } from "../../../src/lens/species/data/shards";
import { CARDS, readFixture, studyAreaFor } from "./fixtures";

/** the release's ecoregion extent, step 3 of section 6.3's chain. */
const ER_BBOX: Bbox = [-180, -60, -50, 75];
const FULL = studyAreaFor("v9");

function bounds(cam: ReturnType<typeof cameraFor>): BoundsCamera {
  if (!cam || cam.kind !== "bounds") throw new Error(`expected a bounds camera, got ${cam?.kind}`);
  return cam;
}

describe("minimalFrame: the three REAL shapes (fix round 1)", () => {
  it("a WRAPPED Pacific extent is re-expressed in the complementary frame", () => {
    // the published shape: 337.4 deg of the wrong ocean if read naively
    expect(minimalFrame([-173.7, -16.05, 163.7, 20.2])).toEqual([163.7, -16.05, 186.3, 20.2]);
    const span = 186.3 - 163.7;
    expect(span).toBeCloseTo(22.6, 6);
  });

  it("an already-unwrapped extent is left exactly as it is (xmax stays above 180)", () => {
    expect(minimalFrame([160, 48, 210, 66])).toEqual([160, 48, 210, 66]);
    expect(minimalFrame([-126.45, 17.6, -64.8, 48.55])).toEqual([-126.45, 17.6, -64.8, 48.55]);
  });

  it("a genuinely circumglobal extent stays wide rather than framing a degenerate sliver", () => {
    expect(minimalFrame([-180, -85, 180, 85])).toEqual([-180, -85, 180, 85]);
  });
});

describe("the 50-sample gate over REAL v9 extents", () => {
  const fixture = readFixture("v9/wide-bboxes.json") as {
    n: number;
    rows: { key: string; sci: string; layer: string; bbox: Bbox }[];
  };

  it("has 50 real rows, each with a naive span wider than 180 deg", () => {
    expect(fixture.n).toBe(50);
    expect(fixture.rows).toHaveLength(50);
    for (const r of fixture.rows) expect(r.bbox[2] - r.bbox[0]).toBeGreaterThan(180);
  });

  it("every fitted span is < 200 deg and every centre lies inside the model's own longitudes", () => {
    const spans: number[] = [];
    for (const row of fixture.rows) {
      const frame = minimalFrame(row.bbox);
      const span = frame[2] - frame[0];
      spans.push(span);
      expect(span, `${row.key} ${row.layer}`).toBeLessThan(200);
      const c = (frame[0] + frame[2]) / 2;
      // inside the frame it produced...
      expect(c).toBeGreaterThan(frame[0]);
      expect(c).toBeLessThan(frame[2]);
      // ...and OUTSIDE the empty naive interval the publisher wrote (that is what "the model's own
      // longitudes" means for a box written wrapped): normalized, the centre must not fall between
      // the published xmin and xmax
      const normalized = ((((c + 180) % 360) + 360) % 360) - 180;
      expect(
        normalized <= row.bbox[0] || normalized >= row.bbox[2],
        `${row.key} ${row.layer}: centre ${normalized} fell inside the empty box`,
      ).toBe(true);
    }
    expect(Math.max(...spans)).toBeLessThan(200);
  });

  it("framing the NAIVE box instead would fail this gate (the fault this gate exists for)", () => {
    const naive = fixture.rows.map((r) => r.bbox[2] - r.bbox[0]);
    expect(Math.max(...naive)).toBeGreaterThan(200);
    expect(naive.filter((s) => s >= 200).length).toBeGreaterThan(40);
  });
});

describe("the antimeridian, through cameraFor", () => {
  it("passes an unwrapped frame through UNCHANGED (xmax may exceed 180)", () => {
    const cam = bounds(cameraFor(CARDS.dateline(), MERGED_IN));
    expect(cam.bounds).toEqual([
      [160, 48],
      [210, 73],
    ]);
    expect(cam.padding).toBe(DEFAULT_CAMERA_PADDING);
  });

  it("the fitted span is < 200 deg and the centre lies inside the model's own longitudes", () => {
    for (const selected of [MERGED_IN, "am"]) {
      const cam = bounds(cameraFor(CARDS.dateline(), selected));
      expect(lonSpanOf(cam)).toBeLessThan(200);
      const c = centerLon(cam);
      expect(c).toBeGreaterThan(cam.bounds[0][0]);
      expect(c).toBeLessThan(cam.bounds[1][0]);
      // the walrus frames the Bering and Chukchi seas, not Iceland: the centre is east of 180
      expect(c).toBeGreaterThan(180);
    }
  });

  it("a normalized centre would land on the WRONG side of the world (what this rule prevents)", () => {
    const cam = bounds(cameraFor(CARDS.dateline(), MERGED_IN));
    const normalized = ((centerLon(cam) + 180) % 360) - 180;
    expect(normalized).toBeLessThan(0); // -175: the Chukchi Sea read as the eastern Pacific
    expect(centerLon(cam)).not.toBe(normalized);
  });
});

describe("the fit target (section 6.3, fix round 1's chain)", () => {
  it("an input uses its OWN extent", () => {
    const cam = bounds(cameraFor(CARDS.dateline(), "am"));
    expect(cam.source).toBe("input");
    expect(cam.bounds).toEqual([
      [165, 51],
      [200, 70],
    ]);
  });

  it("a whole-world input extent is treated as missing and falls back to the merged extent", () => {
    // the wraparound range's own COG honestly reads -180..180 (section 11.10)
    expect(inputBbox(CARDS.dateline(), "rng_iucn")).toEqual([-180, 47, 180, 85]);
    const cam = bounds(cameraFor(CARDS.dateline(), "rng_iucn"));
    expect(cam.source).toBe("merged");
    expect(cam.bounds[1][0]).toBe(210);
  });

  it("a merged extent that spans the globe reaches the ecoregion extent", () => {
    const cam = bounds(cameraFor(CARDS.globe(), MERGED_IN, { fallbackBbox: ER_BBOX }));
    expect(cam.source).toBe("ecoregion");
    expect(cam.bounds).toEqual([
      [-180, -60],
      [-50, 75],
    ]);
  });

  it("a null merged bbox (the published 'spans the globe') also reaches the ecoregion extent", () => {
    expect(CARDS.leatherback().merged?.bbox).toBeNull();
    expect(
      bounds(cameraFor(CARDS.leatherback(), MERGED_IN, { fallbackBbox: ER_BBOX })).source,
    ).toBe("ecoregion");
  });

  it("with no extent at all, the study area frames US waters — never the globe", () => {
    // v7 publishes NO bbox for any of its 16,153 taxa, so this is the v7 path for every species
    const cam = cameraFor(CARDS.walrusV7(), MERGED_IN, { studyArea: studyAreaFor("v7") });
    expect(cam).toEqual({
      kind: "center",
      center: [-101.304, 46.9],
      zoom: 2.16,
      source: "study-area",
    });
  });

  it("the ecoregion extent is preferred over the study area, and the study area over nothing", () => {
    const withBoth = cameraFor(CARDS.whelk(), MERGED_IN, {
      fallbackBbox: ER_BBOX,
      studyArea: FULL,
    });
    expect(withBoth?.source).toBe("ecoregion");
    expect(cameraFor(CARDS.whelk(), MERGED_IN, { studyArea: FULL })?.source).toBe("study-area");
    expect(cameraFor(CARDS.whelk(), MERGED_IN)).toBeNull();
  });

  it("re-frames a WRAPPED published extent rather than obeying it", () => {
    const wrapped = {
      ...CARDS.globe(),
      merged: { ...CARDS.globe().merged!, bbox: [-173.7, -16.05, 163.7, 20.2] as Bbox },
    };
    const cam = bounds(cameraFor(wrapped, MERGED_IN, { studyArea: FULL }));
    expect(cam.source).toBe("merged");
    expect(lonSpanOf(cam)).toBeCloseTo(22.6, 6);
    expect(centerLon(cam)).toBeCloseTo(175, 6);
  });

  it("prefers the asset for the current representation when both carry an extent", () => {
    const walrus = CARDS.walrus();
    expect(inputBbox(walrus, "ax", "native")).toEqual([-177.7, 60.65, -139.15, 79]);
    expect(bounds(cameraFor(walrus, "ax", { rep: "model" })).source).toBe("input");
  });

  it("an input this taxon does not have falls through to the merged extent", () => {
    expect(bounds(cameraFor(CARDS.dateline(), "not_a_dataset")).source).toBe("merged");
  });
});

describe("studyAreaView", () => {
  it("reads boot.study_areas[FULL], and accepts the bare array or the whole boot", () => {
    const rows = readFixture("v9/study-areas.json");
    expect(studyAreaView(rows)).toEqual({ key: "FULL", lon: -101.304, lat: 46.9, zoom: 2.16 });
    expect(studyAreaView({ study_areas: rows })).toEqual(studyAreaView(rows));
    expect(studyAreaView(rows, "AK")?.lat).toBe(63.327);
  });

  it("is null for an absent or malformed row, never a guessed centre", () => {
    expect(studyAreaView(readFixture("v9/study-areas.json"), "NOPE")).toBeNull();
    expect(studyAreaView([{ key: "FULL", lon: "x", lat: 1, zoom: 2 }])).toBeNull();
    expect(studyAreaView(null)).toBeNull();
    expect(studyAreaView({})).toBeNull();
  });
});

describe("refitNeeded", () => {
  it("is true on the first render and when the species changes", () => {
    expect(refitNeeded(null, { sp: "a", in: MERGED_IN })).toBe(true);
    expect(refitNeeded({ sp: "a", in: MERGED_IN }, { sp: "b", in: MERGED_IN })).toBe(true);
  });

  it("is FALSE on a layer switch (section 11.9: compare two models at one camera)", () => {
    expect(refitNeeded({ sp: "a", in: MERGED_IN }, { sp: "a", in: "ax" })).toBe(false);
    expect(refitNeeded({ sp: "a", in: "ax" }, { sp: "a", in: "bl" })).toBe(false);
  });

  it("is FALSE on a representation switch", () => {
    expect(
      refitNeeded({ sp: "a", in: "ax", rep: "native" }, { sp: "a", in: "ax", rep: "model" }),
    ).toBe(false);
  });
});
