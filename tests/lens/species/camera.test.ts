// camera.ts: the antimeridian gate over REAL published extents, the four-step fallback, and
// "re-fit only on species change".
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_PADDING,
  WIDE_RANGE_SPAN_DEG,
  anyInputBbox,
  cameraFor,
  centerLon,
  cogUrlForBoundsFallback,
  inputBbox,
  intersectBbox,
  lonSpanOf,
  minimalFrame,
  refitNeeded,
  studyAreaBboxFallback,
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

  // D8 (Opus 5.5 eyes-on, 2026-09-24): `?lens=species&mdl_seq=54383` (walrus) selecting the `am`
  // input used to fall all the way to the study-area default (the range read as "a sliver on the
  // globe's limb") because NEITHER `am` NOR `card.merged` publish a bbox — even though the SAME
  // taxon's `ax` input does. `anyInputBbox`/the "sibling" chain step below fix it.
  describe("D8: a sibling input's bbox (anyInputBbox)", () => {
    it("the walrus `am` input has no bbox of its own, and neither does merged", () => {
      const walrus = CARDS.walrus();
      expect(inputBbox(walrus, "am")).toBeNull();
      expect(walrus.merged?.bbox ?? null).toBeNull();
    });

    it("anyInputBbox finds the walrus's `ax` sibling's extent", () => {
      expect(anyInputBbox(CARDS.walrus())).toEqual([-177.7, 60.65, -139.15, 79]);
    });

    it("cameraFor selecting `am` frames the SIBLING extent, not the whole study area", () => {
      const cam = bounds(cameraFor(CARDS.walrus(), "am", { studyArea: FULL }));
      expect(cam.source).toBe("sibling");
      expect(cam.bounds).toEqual([
        [-177.7, 60.65],
        [-139.15, 79],
      ]);
    });

    it("a taxon with no bbox on ANY input (v7: assets always []) still falls all the way to the study area", () => {
      expect(anyInputBbox(CARDS.walrusV7())).toBeNull();
      const cam = cameraFor(CARDS.walrusV7(), MERGED_IN, { studyArea: studyAreaFor("v7") });
      expect(cam?.source).toBe("study-area");
    });

    // P6c (orchestrator, real-CI regression, 2026-09-24): `anyInputBbox` used to NOT filter mask
    // inputs, on the theory that the caller's ecoregion fallback (tried first) would always catch
    // a taxon like this before the mask bbox mattered. In practice `state.svelte.ts` never supplies
    // an ecoregion bbox at all, so that theory never held: the leatherback's `ch_fws` critical-
    // habitat mask (`[-64.95, 17.65, -64.85, 17.7]`, 0.1 x 0.05 deg — a single reef off Puerto
    // Rico) was picked up as if it were "the species' own ground" and flew the WHOLE-taxon default
    // camera there, stranding `e2e/species.smoke.spec.ts`'s PMTiles range gate (real CI regression,
    // all three engines). Masks are now skipped entirely (see `anyInputBbox`'s own header) — a
    // taxon with bboxes on ONLY its mask inputs now behaves exactly like one with no bbox anywhere.
    it("a critical-habitat MASK's bbox is never used as the sibling extent — only a real distribution model's is", () => {
      // the leatherback's OWN merged bbox is null (spans the globe); its only non-null bboxes are
      // on MASK inputs (`ch_fws`/`ch_nmfs`/`rng_fws`) — its two real distribution models (`am`/
      // `ax`) publish none, so `anyInputBbox` must find nothing to fly to.
      expect(CARDS.leatherback().merged?.bbox).toBeNull();
      expect(inputBbox(CARDS.leatherback(), "am")).toBeNull();
      expect(inputBbox(CARDS.leatherback(), "ax")).toBeNull();
      expect(inputBbox(CARDS.leatherback(), "ch_fws")).not.toBeNull(); // the mask DOES carry one
      expect(anyInputBbox(CARDS.leatherback())).toBeNull();
      // WITH an ecoregion supplied, that is still what's used (unaffected by the mask filter).
      const withEcoregion = bounds(
        cameraFor(CARDS.leatherback(), MERGED_IN, { fallbackBbox: ER_BBOX }),
      );
      expect(withEcoregion.source).toBe("ecoregion");
      // and WITHOUT one, the taxon now falls all the way to the study area (a "center" camera,
      // never a mask sliver).
      const withoutEcoregion = cameraFor(CARDS.leatherback(), MERGED_IN, { studyArea: FULL });
      expect(withoutEcoregion?.source).toBe("study-area");
    });
  });

  // D8's true last resort: mdl_seq 54383 (walrus, v7) publishes NO bbox anywhere (assets: []) —
  // camera.ts stays network-free by contract, so this is the pure "what COG should the caller ask
  // titiler's /cog/bounds about" half; state.svelte.ts does the actual fetch.
  describe("D8: cogUrlForBoundsFallback (the COG-bounds last resort)", () => {
    it("the v7 walrus (mdl_seq 54383) has no bbox on the merged surface, but its `merged.url` IS a real COG", () => {
      const card = CARDS.walrusV7();
      expect(card.merged?.bbox ?? null).toBeNull();
      expect(card.merged?.type).toBe("cog");
      expect(cogUrlForBoundsFallback(card, MERGED_IN)).toBe(card.merged?.url);
    });

    it("a selected INPUT (not merged) resolves to that input's own COG url, rep-preferred", () => {
      const walrus = CARDS.walrus();
      const ax = walrus.inputs.find((i) => i.dsKey === "ax")!;
      const nativeAsset = ax.assets.find((a) => a.rep === "native")!;
      expect(cogUrlForBoundsFallback(walrus, "ax", "native")).toBe(nativeAsset.url);
    });

    it("a pmtiles-only input (no COG of its own) falls through to the merged COG, same as cameraFor's own chain", () => {
      const walrus = CARDS.walrus();
      // rng_iucn is pmtiles-only on this fixture — see tests/fixtures/species/v9/taxon/75.json
      expect(cogUrlForBoundsFallback(walrus, "rng_iucn")).toBe(walrus.merged?.url);
    });

    it("a pmtiles-only input AND no merged COG resolves to null (nothing left to ask titiler about)", () => {
      const leatherback = CARDS.leatherback();
      // rng_iucn is pmtiles-only, and this taxon's merged bbox test already proves merged is present
      // but let's use a taxon whose merged surface is null outright: v1 residual (whelk).
      expect(cogUrlForBoundsFallback(CARDS.whelk(), "rng_iucn")).toBeNull();
      // and confirm the leatherback case IS the merged-fallback, not a coincidental null:
      expect(cogUrlForBoundsFallback(leatherback, "rng_iucn")).toBe(leatherback.merged?.url);
    });

    it("no matching input at all falls through to the merged COG url (never a throw)", () => {
      const walrus = CARDS.walrus();
      expect(cogUrlForBoundsFallback(walrus, "not_a_dataset")).toBe(walrus.merged?.url);
    });

    it("no matching input AND no merged COG resolves to null", () => {
      // v1 residual: merged is null entirely (see CARDS.whelk's own comment)
      expect(cogUrlForBoundsFallback(CARDS.whelk(), "not_a_dataset")).toBeNull();
    });
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

// R3-A1 (round-3 plan, Ben 2026-09-25): wide-range models (the SWOT leatherback — nesting near
// Oceania, foraging to Alaska) frame their IN-US portion by default. Three things to prove: the
// THRESHOLD (a span at/under WIDE_RANGE_SPAN_DEG is untouched), the INTERSECTION (dateline-aware,
// on both real inputs AND on the derived study-area fallback), and the FALLBACK when the
// intersection comes back empty (keep the whole-range fit — narrowing to nothing is worse than not
// narrowing).
describe("R3-A1: intersectBbox — dateline-aware bbox intersection", () => {
  it("overlapping boxes in the SAME frame intersect normally (no shift needed)", () => {
    expect(intersectBbox([0, 0, 10, 10], [5, 5, 15, 15])).toEqual([5, 5, 10, 10]);
  });

  it("disjoint boxes in the same frame: no intersection", () => {
    expect(intersectBbox([0, 0, 10, 10], [20, 0, 30, 10])).toBeNull();
  });

  it("dateline-aware: a model written 160..220 (continuous) and a study area written -170..-140 (the SAME ground, a different frame) still intersect", () => {
    // -170..-140 shifted +360 is 190..220 — overlaps 160..220 at 190..220.
    const intersection = intersectBbox([160, 10, 220, 50], [-170, 20, -140, 40]);
    expect(intersection).toEqual([190, 20, 220, 40]);
  });

  it("picks whichever shift gives the WIDEST overlap, not just the first that matches", () => {
    // b as-is overlaps a in [50,60] (10 deg); shifted +360, b (370..380) does not overlap a at all;
    // shifted -360, b (-350..-340) does not either — so the un-shifted 10-deg overlap must win.
    const a: Bbox = [0, 0, 60, 10];
    const b: Bbox = [50, 0, 70, 10];
    expect(intersectBbox(a, b)).toEqual([50, 0, 60, 10]);
  });

  it("a real, wide FULL-study-area-shaped box (spanning past -180) intersects a Pacific-crossing model", () => {
    // studyAreaBboxFallback(FULL) below is the exact box this exercises end-to-end; this fixture
    // pins the raw math independent of that derivation.
    const usLike: Bbox = [-201.99, -9.65, -0.61, 75];
    const wideModel: Bbox = [130, 10, 260, 65]; // ~130 deg, 130E across the Pacific to 100W
    const intersection = intersectBbox(wideModel, usLike);
    expect(intersection).not.toBeNull();
    // narrows the WEST edge (drops the Oceania-ish portion outside the study-area box) but keeps
    // the model's own east edge and latitude band.
    expect(intersection![0]).toBeGreaterThan(wideModel[0]);
    expect(intersection![2]).toBe(wideModel[2]);
  });
});

describe("R3-A1: studyAreaBboxFallback", () => {
  it("prefers a real published bbox on the study-area row when present", () => {
    const withBbox = { ...FULL, bbox: [-170, 10, -60, 60] as Bbox };
    expect(studyAreaBboxFallback(withBbox)).toEqual([-170, 10, -60, 60]);
  });

  it("derives from the SAME camera the desktop default view renders when no bbox is published (today's real data — see fixtures/*/study-areas.json)", () => {
    const bbox = studyAreaBboxFallback(FULL);
    // wide (the desktop default view at this zoom shows most of the globe — camera.ts's own
    // header), centred near the FULL preset's own longitude, and continuous (west may cross -180
    // rather than wrap).
    expect(bbox[2] - bbox[0]).toBeGreaterThan(150);
    expect(bbox[0]).toBeLessThan(-180);
  });
});

describe("R3-A1: the threshold and the fallback chain, through cameraFor", () => {
  // a synthetic wide taxon: CARDS.globe()'s own shape (has a real `am` input to override) with a
  // merged bbox we control precisely, so the threshold boundary is exact rather than incidental.
  function wideCard(mergedBbox: Bbox) {
    const base = CARDS.globe();
    return { ...base, merged: { ...base.merged!, bbox: mergedBbox } };
  }

  it("a span AT the threshold is untouched (strictly GREATER THAN, not >=)", () => {
    const atThreshold = wideCard([100, 10, 100 + WIDE_RANGE_SPAN_DEG, 50]);
    const cam = bounds(cameraFor(atThreshold, MERGED_IN, { studyArea: FULL }));
    expect(cam.bounds).toEqual([
      [100, 10],
      [100 + WIDE_RANGE_SPAN_DEG, 50],
    ]);
    expect(cam.wholeRangeBounds).toBeUndefined();
  });

  it("a span just OVER the threshold, with a real overlap, is narrowed to the US intersection", () => {
    const wide = wideCard([130, 10, 260, 65]); // ~130 deg, matches the intersectBbox fixture above
    const cam = bounds(cameraFor(wide, MERGED_IN, { studyArea: FULL }));
    expect(cam.source).toBe("merged");
    expect(cam.wholeRangeBounds).toEqual([
      [130, 10],
      [260, 65],
    ]);
    // the narrowed bounds are a real subset of the whole range, not equal to it.
    expect(cam.bounds).not.toEqual(cam.wholeRangeBounds);
    expect(cam.bounds[0][0]).toBeGreaterThan(130);
    // and the centre genuinely lands INSIDE the US intersection, not merely inside the whole range.
    const usBbox = studyAreaBboxFallback(FULL);
    const cx = centerLon(cam);
    expect(cx).toBeGreaterThanOrEqual(Math.max(130, usBbox[0]));
  });

  it("a wide span whose intersection comes back EMPTY keeps the whole-range fit (narrowing to nothing is worse than not narrowing)", () => {
    // entirely inside the ~0.6..158 deg gap the FULL study-area box's own longitude does NOT cover
    // (see the studyAreaBboxFallback test above) — span 140, over the threshold, but no overlap.
    const noOverlap = wideCard([10, -10, 150, 10]);
    expect(intersectBbox([10, -10, 150, 10], studyAreaBboxFallback(FULL))).toBeNull();
    const cam = bounds(cameraFor(noOverlap, MERGED_IN, { studyArea: FULL }));
    expect(cam.bounds).toEqual([
      [10, -10],
      [150, 10],
    ]);
    expect(cam.wholeRangeBounds).toBeUndefined();
  });

  it("a wide span with NO study area supplied is also left whole (nothing to intersect against)", () => {
    const wide = wideCard([130, 10, 260, 65]);
    const cam = bounds(cameraFor(wide, MERGED_IN, {}));
    expect(cam.bounds).toEqual([
      [130, 10],
      [260, 65],
    ]);
    expect(cam.wholeRangeBounds).toBeUndefined();
  });

  it("applies the SAME narrowing to an INPUT's own extent, not just the merged surface", () => {
    const base = CARDS.dateline();
    const wideInput = {
      ...base,
      inputs: base.inputs.map((i) =>
        i.dsKey === "am"
          ? { ...i, assets: i.assets.map((a) => ({ ...a, bbox: [130, 10, 260, 65] as Bbox })) }
          : i,
      ),
    };
    const cam = bounds(cameraFor(wideInput, "am", { studyArea: FULL }));
    expect(cam.source).toBe("input");
    expect(cam.wholeRangeBounds).toEqual([
      [130, 10],
      [260, 65],
    ]);
  });

  it("a COMPACT model (under the threshold) is completely unaffected by this feature", () => {
    // the existing dateline fixture's `am` input (35 deg span) — same assertion the pre-existing
    // fit-target tests already make, re-asserted here to pin "compact models keep the whole-range
    // fit" as this feature's own regression case.
    const cam = bounds(cameraFor(CARDS.dateline(), "am", { studyArea: FULL }));
    expect(lonSpanOf(cam)).toBeLessThan(WIDE_RANGE_SPAN_DEG);
    expect(cam.wholeRangeBounds).toBeUndefined();
  });
});
