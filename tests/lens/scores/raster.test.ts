import { describe, expect, it } from "vitest";
import { layerByKey } from "../../../src/lens/scores/boot";
import {
  OUTSIDE_PRA_OVERLAY_ID,
  SCORE_RASTER_ID,
  outsidePraOverlaySpec,
  rasterLegend,
  scoreRasterSpec,
} from "../../../src/lens/scores/raster";
import { tileUrlLeaksStudyArea } from "../../../src/lib/map/layers/titiler";
import { BOOT_V7, MANIFEST_OVERLAYS_V7 } from "./fixtures";

const primprod = layerByKey(BOOT_V7, "primprod")!;

describe("scoreRasterSpec", () => {
  it("builds the FULL-COG titiler tile template, rescale verbatim, opacity 0.6", () => {
    const spec = scoreRasterSpec(primprod, "spectral_r")!;
    expect(spec.id).toBe(SCORE_RASTER_ID);
    expect(spec.opacity).toBe(0.6);
    expect(spec.tiles[0]).toContain("rescale=35.1489,11033.6953");
    expect(spec.tiles[0]).toContain("colormap_name=spectral_r");
    expect(spec.tiles[0]).toContain(encodeURIComponent(primprod.by_subregion!.FULL.cog!));
  });

  it("null layer: null, never a throw (an unknown ?lyr= must fall back)", () => {
    expect(scoreRasterSpec(null, "spectral_r")).toBeNull();
  });

  it("a layer with no FULL cog: null", () => {
    expect(
      scoreRasterSpec({ metric_key: "x", category: "raw", order: 1 }, "spectral_r"),
    ).toBeNull();
  });

  it("never leaks a study-area key (D7/apps#13-14: the raster is always the FULL COG)", () => {
    const spec = scoreRasterSpec(primprod, "spectral_r")!;
    expect(tileUrlLeaksStudyArea(spec.tiles[0])).toBeNull();
  });
});

describe("outsidePraOverlaySpec", () => {
  it("the explicit colormap, opacity 0.55, off by default", () => {
    const spec = outsidePraOverlaySpec(MANIFEST_OVERLAYS_V7, false)!;
    expect(spec.id).toBe(OUTSIDE_PRA_OVERLAY_ID);
    expect(spec.opacity).toBe(0.55);
    expect(spec.visible).toBe(false);
    expect(spec.tiles[0]).toContain(encodeURIComponent('{"1":[34,34,34,255]}'));
  });

  it("no manifest overlays published: null", () => {
    expect(outsidePraOverlaySpec(null, false)).toBeNull();
    expect(outsidePraOverlaySpec([], false)).toBeNull();
  });
});

describe("rasterLegend", () => {
  it("endpoints are signif(rescale, 3), stops from boot.palettes", () => {
    const legend = rasterLegend(BOOT_V7, primprod, "spectral_r");
    expect(legend.unavailable).toBe(false);
    expect(legend.stops).toHaveLength(11);
    expect(legend.stops[0].value).toBeCloseTo(35.1); // signif(35.1489, 3)
    expect(legend.stops[10].value).toBeCloseTo(11000); // signif(11033.6953, 3)
  });

  it("unavailable when the release has not published this palette's stops (today: viridis/cividis/magma)", () => {
    const legend = rasterLegend(BOOT_V7, primprod, "viridis");
    expect(legend.unavailable).toBe(true);
    expect(legend.stops).toEqual([]);
  });
});
