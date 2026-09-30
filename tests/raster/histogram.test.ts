// Ben's ask (round-3 review): the popup sparkline's species source -- titiler's `/cog/statistics`,
// the "second sanctioned tile-server read" (plan D4) alongside `raster/point.ts`'s `/cog/point`.
import { describe, expect, it } from "vitest";
import {
  assertHistogramRequest,
  createTitilerHistogramSource,
  parseTitilerStatistics,
  titilerStatisticsUrl,
} from "../../src/lib/raster/histogram";
import { DEFAULT_TITILER_CONFIG } from "../../src/lib/raster/tiles";

describe("assertHistogramRequest", () => {
  it("passes for the species and scores (Raster cells) domains", () => {
    expect(() => assertHistogramRequest({ domain: "species" })).not.toThrow();
    expect(() => assertHistogramRequest({ domain: "scores" })).not.toThrow();
  });

  it("throws for any other domain -- Program-area distributions never read a tile endpoint", () => {
    expect(() => assertHistogramRequest({ domain: "zones" })).toThrow(/plan D4/);
  });
});

describe("titilerStatisticsUrl", () => {
  it("builds the /cog/statistics URL with the encoded cog url and bin count", () => {
    const url = titilerStatisticsUrl(DEFAULT_TITILER_CONFIG, "https://x/y.tif", 20);
    expect(url).toContain("/cog/statistics?url=");
    expect(url).toContain("histogram_bins=20");
    expect(url).toContain(encodeURIComponent("https://x/y.tif"));
  });
});

describe("histogram_range (R4-A: bins line up with the legend ramp)", () => {
  it("is appended to the URL when a range is given, omitted otherwise", () => {
    const withRange = titilerStatisticsUrl(
      DEFAULT_TITILER_CONFIG,
      "https://x/y.tif",
      40,
      [0, 55.5],
    );
    expect(withRange).toContain("&histogram_range=0,55.5");
    expect(titilerStatisticsUrl(DEFAULT_TITILER_CONFIG, "https://x/y.tif", 40)).not.toContain(
      "histogram_range",
    );
  });

  it("the parsed min/max are the bin EDGES (the requested range), not the band's own min/max", () => {
    const raw = {
      b1: {
        min: 3,
        max: 90,
        histogram: [
          [5, 10],
          [0, 50, 100],
        ],
      },
    };
    expect(parseTitilerStatistics(raw)).toEqual({ binCount: 2, counts: [5, 10], min: 0, max: 100 });
  });

  it("the source sends the range and serves the scores domain", async () => {
    let seen = "";
    const source = createTitilerHistogramSource(async (url) => {
      seen = url;
      return { b1: { min: 0, max: 1, histogram: [[1], [0, 1]] } };
    });
    const h = await source.histogram({
      domain: "scores",
      cogUrl: "https://x/y.tif",
      bins: 40,
      range: [0, 80],
    });
    expect(seen).toContain("histogram_range=0,80");
    expect(h?.binCount).toBe(1);
  });
});

describe("parseTitilerStatistics", () => {
  it("a well-formed b1 histogram parses to a Histogram", () => {
    const raw = {
      b1: {
        min: 1,
        max: 100,
        histogram: [
          [5, 10, 3],
          [1, 34, 67, 100],
        ],
      },
    };
    expect(parseTitilerStatistics(raw)).toEqual({
      binCount: 3,
      counts: [5, 10, 3],
      min: 1,
      max: 100,
    });
  });

  it("null/non-object input returns null, never a throw", () => {
    expect(parseTitilerStatistics(null)).toBeNull();
    expect(parseTitilerStatistics(undefined)).toBeNull();
    expect(parseTitilerStatistics("not an object")).toBeNull();
  });

  it("a missing min/max or histogram shape returns null", () => {
    expect(parseTitilerStatistics({ b1: { histogram: [[1, 2]] } })).toBeNull();
    expect(parseTitilerStatistics({ b1: { min: 0, max: 1 } })).toBeNull();
    expect(parseTitilerStatistics({ b1: { min: 0, max: 1, histogram: "nope" } })).toBeNull();
  });

  it("an empty band object returns null", () => {
    expect(parseTitilerStatistics({})).toBeNull();
  });
});

describe("createTitilerHistogramSource", () => {
  it("fetches and parses -- happy path", async () => {
    const source = createTitilerHistogramSource(async () => ({
      b1: {
        min: 0,
        max: 10,
        histogram: [
          [1, 2, 3],
          [0, 3, 7, 10],
        ],
      },
    }));
    const got = await source.histogram({ domain: "species", cogUrl: "https://x/y.tif" });
    expect(got).toEqual({ binCount: 3, counts: [1, 2, 3], min: 0, max: 10 });
  });

  it("a network failure resolves to null, never a throw -- the sparkline just does not render", async () => {
    const source = createTitilerHistogramSource(async () => {
      throw new Error("network down");
    });
    const got = await source.histogram({ domain: "species", cogUrl: "https://x/y.tif" });
    expect(got).toBeNull();
  });

  it("an unavailable endpoint's malformed JSON body resolves to null too", async () => {
    const source = createTitilerHistogramSource(async () => ({ detail: "Not Found" }));
    const got = await source.histogram({ domain: "species", cogUrl: "https://x/y.tif" });
    expect(got).toBeNull();
  });

  it("refuses an unknown domain before ever fetching", async () => {
    let fetched = false;
    const source = createTitilerHistogramSource(async () => {
      fetched = true;
      return {};
    });
    await expect(
      source.histogram({ domain: "zones" as never, cogUrl: "https://x/y.tif" }),
    ).rejects.toThrow(/plan D4/);
    expect(fetched).toBe(false);
  });
});
