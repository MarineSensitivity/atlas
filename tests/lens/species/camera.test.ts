// camera.ts: the antimeridian gate, the three-step fallback, and "re-fit only on species change".
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_PADDING,
  cameraFor,
  centerLon,
  inputBbox,
  lonSpanOf,
  refitNeeded,
} from "../../../src/lens/species/data/camera";
import { MERGED_IN } from "../../../src/lens/species/data/resolve";
import type { Bbox } from "../../../src/lens/species/data/shards";
import { CARDS } from "./fixtures";

/** the release's ecoregion extent, the last resort of section 6.3. */
const ER_BBOX: Bbox = [-180, -60, -50, 75];

describe("the antimeridian gate", () => {
  it("passes the 0-360 frame through UNCHANGED (xmax may exceed 180)", () => {
    const cam = cameraFor(CARDS.dateline(), MERGED_IN);
    expect(cam?.bounds).toEqual([
      [160, 48],
      [210, 73],
    ]);
    expect(cam?.padding).toBe(DEFAULT_CAMERA_PADDING);
  });

  it("the fitted span is < 200 deg and the centre lies inside the model's own longitudes", () => {
    for (const selected of [MERGED_IN, "am"]) {
      const cam = cameraFor(CARDS.dateline(), selected);
      if (!cam) throw new Error(`no camera for ${selected}`);
      expect(lonSpanOf(cam)).toBeLessThan(200);
      const c = centerLon(cam);
      expect(c).toBeGreaterThan(cam.bounds[0][0]);
      expect(c).toBeLessThan(cam.bounds[1][0]);
      // the walrus frames the Bering and Chukchi seas, not Iceland: the centre is east of 180
      expect(c).toBeGreaterThan(180);
    }
  });

  it("a normalized centre would land on the WRONG side of the world (what this rule prevents)", () => {
    const cam = cameraFor(CARDS.dateline(), MERGED_IN)!;
    const normalized = ((centerLon(cam) + 180) % 360) - 180;
    expect(normalized).toBeLessThan(0); // -175: the Chukchi Sea read as the eastern Pacific
    expect(centerLon(cam)).not.toBe(normalized);
  });
});

describe("the fit target (section 6.3)", () => {
  it("an input uses its OWN extent", () => {
    const cam = cameraFor(CARDS.dateline(), "am");
    expect(cam?.source).toBe("input");
    expect(cam?.bounds).toEqual([
      [165, 51],
      [200, 70],
    ]);
  });

  it("a whole-world input extent is treated as missing and falls back to the merged extent", () => {
    // the wraparound range's own COG honestly reads -180..180 (section 11.10)
    expect(inputBbox(CARDS.dateline(), "rng_iucn")).toEqual([-180, 47, 180, 85]);
    const cam = cameraFor(CARDS.dateline(), "rng_iucn");
    expect(cam?.source).toBe("merged");
    expect(cam?.bounds[1][0]).toBe(210);
  });

  it("a taxon whose merged extent spans the globe frames the supplied fallback", () => {
    const cam = cameraFor(CARDS.globe(), MERGED_IN, { fallbackBbox: ER_BBOX });
    expect(cam?.source).toBe("fallback");
    expect(cam?.bounds).toEqual([
      [-180, -60],
      [-50, 75],
    ]);
  });

  it("a null merged bbox (the published 'spans the globe') also reaches the fallback", () => {
    expect(CARDS.leatherback().merged?.bbox).toBeNull();
    expect(cameraFor(CARDS.leatherback(), MERGED_IN, { fallbackBbox: ER_BBOX })?.source).toBe(
      "fallback",
    );
  });

  it("with nothing framable at all, there is no camera (the map is left alone)", () => {
    expect(cameraFor(CARDS.leatherback(), MERGED_IN)).toBeNull();
    expect(cameraFor(CARDS.whelk(), MERGED_IN)).toBeNull();
  });

  it("prefers the asset for the current representation when both carry an extent", () => {
    const walrus = CARDS.walrus();
    expect(inputBbox(walrus, "ax", "native")).toEqual([-177.7, 60.65, -139.15, 79]);
    expect(cameraFor(walrus, "ax", { rep: "model" })?.source).toBe("input");
  });

  it("an input this taxon does not have falls through to the merged extent", () => {
    expect(cameraFor(CARDS.dateline(), "not_a_dataset")?.source).toBe("merged");
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
