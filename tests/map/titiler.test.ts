// The tile URL is a byte-for-byte cache key (atlas-refs/"parity scores app.md" §11: titiler/Varnish
// key on the literal query string), so every rule below is asserted on the exact string.
import { describe, expect, it } from "vitest";
import {
  OUTSIDE_PRA_COLORMAP,
  STUDY_AREA_KEYS,
  tileUrlLeaksStudyArea,
  titilerMaskTileTemplate,
  titilerTileTemplate,
} from "../../src/lib/map/layers/titiler";
import { LEAKY_TILE_URL, LEAKY_TILE_URL_BY_VALUE } from "../fixtures/map/faults";

const COG =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/usa05/d2.tif";

describe("titilerTileTemplate", () => {
  const url = titilerTileTemplate({
    url: COG,
    colormapName: "spectral_r",
    rescaleMin: 0,
    rescaleMax: 90,
  });

  it("carries MapLibre's literal {z}/{x}/{y} placeholders, unencoded", () => {
    expect(url).toContain("/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png");
  });

  it("passes rescale through VERBATIM, comma unescaped", () => {
    expect(url).toContain("&rescale=0,90");
    expect(url).not.toContain("%2C");
  });

  it("keeps a fractional rescale exactly as the manifest gave it (never re-rounded)", () => {
    const u = titilerTileTemplate({
      url: COG,
      colormapName: "viridis",
      rescaleMin: 0.01,
      rescaleMax: 2648.03,
    });
    expect(u).toContain("&rescale=0.01,2648.03");
  });

  it("names the colormap and fully escapes the COG url", () => {
    expect(url).toContain("&colormap_name=spectral_r");
    expect(url).toContain("?url=https%3A%2F%2Fs3.us-east-1.amazonaws.com");
  });

  it("writes url, colormap_name, rescale in that order (the cache key's order)", () => {
    expect(url.indexOf("?url=")).toBeLessThan(url.indexOf("&colormap_name="));
    expect(url.indexOf("&colormap_name=")).toBeLessThan(url.indexOf("&rescale="));
  });
});

describe("titilerMaskTileTemplate (the _outside_pra overlay)", () => {
  const url = titilerMaskTileTemplate({ url: COG, colormap: OUTSIDE_PRA_COLORMAP });

  it('is `{"1":[34,34,34,255]}`, escaped, with NO colormap_name and NO rescale', () => {
    expect(OUTSIDE_PRA_COLORMAP).toEqual({ "1": [34, 34, 34, 255] });
    expect(url).toContain("&colormap=%7B%221%22%3A%5B34%2C34%2C34%2C255%5D%7D");
    expect(url).not.toContain("colormap_name");
    expect(url).not.toContain("rescale");
  });
});

describe("tileUrlLeaksStudyArea — no study-area key ever reaches a URL", () => {
  it("passes a clean score template", () => {
    const url = titilerTileTemplate({
      url: COG,
      colormapName: "spectral_r",
      rescaleMin: 0,
      rescaleMax: 90,
    });
    expect(tileUrlLeaksStudyArea(url)).toBeNull();
  });

  it("passes a clean mask template", () => {
    expect(
      tileUrlLeaksStudyArea(titilerMaskTileTemplate({ url: COG, colormap: OUTSIDE_PRA_COLORMAP })),
    ).toBeNull();
  });

  it("SEEDED FAULT: flags `area=AK`", () => {
    expect(tileUrlLeaksStudyArea(LEAKY_TILE_URL)).toBe("area=AK");
  });

  it("SEEDED FAULT: flags a study-area key used as any parameter's VALUE", () => {
    expect(tileUrlLeaksStudyArea(LEAKY_TILE_URL_BY_VALUE)).toBe("subregion_key=GA");
  });

  it("does not false-positive on a content-addressed COG whose hash spells a key", () => {
    // the `url=` value is opaque and exempt from the value rule, on purpose (see the doc comment):
    // a gate that fires on a hash collision is a gate people switch off.
    const u = titilerTileTemplate({
      url: "https://example.com/cog/usa05/GA.tif",
      colormapName: "magma",
      rescaleMin: 0,
      rescaleMax: 1,
    });
    expect(tileUrlLeaksStudyArea(u)).toBeNull();
  });

  it("knows the five study areas", () => {
    expect(STUDY_AREA_KEYS).toEqual(["FULL", "AK", "AT", "GA", "PA"]);
  });
});
