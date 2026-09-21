import { describe, expect, it } from "vitest";
import {
  createTitilerRasterSource,
  DEFAULT_TITILER_CONFIG,
  DEFAULT_TITILER_HOST,
  titilerTileUrl,
  type TitilerConfig,
} from "../../src/lib/raster/tiles";

const COG_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/global05/a3a8eb5ab4bec53b.tif";

describe("titilerTileUrl (byte-for-byte: parity scores app.md §6.3 / parity species app.md §2.4)", () => {
  it("builds the exact stock titiler /cog/tiles URL, byte for byte", () => {
    const url = titilerTileUrl(DEFAULT_TITILER_CONFIG, 5, 10, 12, {
      url: COG_URL,
      colormapName: "spectral_r",
      rescaleMin: 0,
      rescaleMax: 100,
    });
    expect(url).toBe(
      `${DEFAULT_TITILER_HOST}/cog/tiles/WebMercatorQuad/5/10/12.png` +
        `?url=https%3A%2F%2Fs3.us-east-1.amazonaws.com%2Foceanmetrics.io-public%2Fmarine-atlas%2Fcog%2Fglobal05%2Fa3a8eb5ab4bec53b.tif` +
        `&colormap_name=spectral_r` +
        `&rescale=0,100`,
    );
  });

  it("does not URL-encode the rescale comma (matches the R-generated literal template)", () => {
    const url = titilerTileUrl(DEFAULT_TITILER_CONFIG, 0, 0, 0, {
      url: COG_URL,
      colormapName: "viridis",
      rescaleMin: 1,
      rescaleMax: 100,
    });
    expect(url).toContain("&rescale=1,100");
    expect(url).not.toContain("%2C");
  });

  it("keeps parameter order url -> colormap_name -> rescale", () => {
    const url = titilerTileUrl(DEFAULT_TITILER_CONFIG, 1, 2, 3, {
      url: COG_URL,
      colormapName: "cividis",
      rescaleMin: 0,
      rescaleMax: 1,
    });
    const urlIdx = url.indexOf("?url=");
    const cmapIdx = url.indexOf("&colormap_name=");
    const rescaleIdx = url.indexOf("&rescale=");
    expect(urlIdx).toBeGreaterThan(-1);
    expect(cmapIdx).toBeGreaterThan(urlIdx);
    expect(rescaleIdx).toBeGreaterThan(cmapIdx);
  });

  it("host is configuration, read off TitilerConfig, never a second hardcoded literal", () => {
    const config: TitilerConfig = { host: "https://titiler.example.test" };
    const url = titilerTileUrl(config, 0, 0, 0, {
      url: COG_URL,
      colormapName: "magma",
      rescaleMin: 0,
      rescaleMax: 1,
    });
    expect(url.startsWith("https://titiler.example.test/cog/tiles/")).toBe(true);
  });

  // seeded fault: a titiler URL whose parameter order or encoding differs from the byte-for-byte
  // expectation. This asserts the CURRENT behavior stays byte-identical to the documented template;
  // flip `titilerTileUrl` to use plain `encodeURIComponent`, or swap the param order, and this test
  // (and the one above pinning param order) goes red.
  it("seeded fault: a naive encodeURIComponent would differ from URLencode(reserved=TRUE) on reserved sub-delims", () => {
    const cogUrlWithParens = "https://example.test/a(b)c!.tif";
    const url = titilerTileUrl(DEFAULT_TITILER_CONFIG, 0, 0, 0, {
      url: cogUrlWithParens,
      colormapName: "spectral_r",
      rescaleMin: 0,
      rescaleMax: 1,
    });
    const naive = `?url=${encodeURIComponent(cogUrlWithParens)}`;
    expect(url).not.toContain(naive);
    expect(url).toContain("%28b%29c%21");
  });
});

describe("createTitilerRasterSource (the RasterSource seam)", () => {
  it("delegates tileUrl() to titilerTileUrl with the configured host", () => {
    const source = createTitilerRasterSource({ host: "https://titiler.example.test" });
    const url = source.tileUrl(2, 3, 4, {
      url: COG_URL,
      colormapName: "spectral_r",
      rescaleMin: 0,
      rescaleMax: 1,
    });
    expect(url).toBe(
      "https://titiler.example.test/cog/tiles/WebMercatorQuad/2/3/4.png" +
        `?url=${encodeURIComponent(COG_URL)}` +
        "&colormap_name=spectral_r&rescale=0,1",
    );
  });

  it("defaults to DEFAULT_TITILER_CONFIG", () => {
    const source = createTitilerRasterSource();
    const url = source.tileUrl(0, 0, 0, {
      url: COG_URL,
      colormapName: "spectral_r",
      rescaleMin: 0,
      rescaleMax: 1,
    });
    expect(url.startsWith(DEFAULT_TITILER_HOST)).toBe(true);
  });
});
