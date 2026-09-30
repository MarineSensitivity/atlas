// Ben's ask (round 4, R4-A): the legend histogram's ONE small interface, `distributionFor()`, plus
// its concrete sources. See src/lib/map/distribution.ts's own header.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDistributionCache,
  distributionFor,
  layerHistogramFor,
  layerHistogramKey,
  speciesRasterDistribution,
  valueListDistribution,
} from "../../../src/lib/map/distribution";
import type { HistogramSource } from "../../../src/lib/raster/histogram";

afterEach(() => {
  clearDistributionCache();
});

describe("distributionFor (the cache wrapper)", () => {
  it("calls the fetcher once per key, even across repeated calls", async () => {
    const fetcher = vi.fn(async () => ({ binCount: 1, counts: [1], min: 0, max: 1 }));
    await distributionFor("k1", fetcher);
    await distributionFor("k1", fetcher);
    await distributionFor("k1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("different keys call the fetcher separately", async () => {
    const fetcher = vi.fn(async () => ({ binCount: 1, counts: [1], min: 0, max: 1 }));
    await distributionFor("a", fetcher);
    await distributionFor("b", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("a rejected fetcher caches null, never a broken promise re-thrown on the next call", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    });
    const first = await distributionFor("k2", fetcher);
    const second = await distributionFor("k2", fetcher);
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("valueListDistribution (scores, Program areas)", () => {
  it("bins a value list", () => {
    const h = valueListDistribution([10, 20, 30, 40], 4);
    expect(h?.min).toBe(10);
    expect(h?.max).toBe(40);
  });

  it("an empty list returns null, never an empty-but-truthy histogram", () => {
    expect(valueListDistribution([])).toBeNull();
  });
});

describe("speciesRasterDistribution (species)", () => {
  it("delegates to the injected HistogramSource, domain 'species'", async () => {
    const source: HistogramSource = {
      histogram: vi.fn(async () => ({ binCount: 2, counts: [1, 2], min: 0, max: 1 })),
    };
    const h = await speciesRasterDistribution(source, "https://x/y.tif", 20);
    expect(h?.counts).toEqual([1, 2]);
    expect(source.histogram).toHaveBeenCalledWith({
      domain: "species",
      cogUrl: "https://x/y.tif",
      bins: 20,
      range: undefined,
    });
  });

  it("a source returning null (vector input, unavailable endpoint) passes null through", async () => {
    const source: HistogramSource = { histogram: async () => null };
    expect(await speciesRasterDistribution(source, "https://x/y.tif")).toBeNull();
  });
});

describe("layerHistogramFor (whole-layer COG histogram, scores Raster cells + species)", () => {
  const args = {
    ver: "v9",
    lens: "scores" as const,
    layer: "score",
    cogUrl: "https://x/score.tif",
    range: [0, 96] as const,
  };
  const hist = { binCount: 2, counts: [3, 9], min: 0, max: 96 };

  it("asks the source for the layer's own COG with histogram_range = the ramp's rescale", async () => {
    const source: HistogramSource = { histogram: vi.fn(async () => hist) };
    expect(await layerHistogramFor(source, args)).toBe(hist);
    expect(source.histogram).toHaveBeenCalledWith({
      domain: "scores",
      cogUrl: "https://x/score.tif",
      bins: 40,
      range: [0, 96],
    });
  });

  // regression `legend-histogram-stable-across-clicks` (Ben, 2026-09-30): "the histogram should
  // represent the density of values across the whole layer ... and so not vary across clicks of
  // the same layer, just the vertical line". The cache key is the LAYER's identity; two clicks on
  // different cells must resolve to the identical histogram object from one fetch.
  it("legend-histogram-stable-across-clicks: two clicks on different cells share one histogram", async () => {
    const source: HistogramSource = { histogram: vi.fn(async () => ({ ...hist })) };
    const a = await layerHistogramFor(source, { ...args, click: "cell:3350704" });
    const b = await layerHistogramFor(source, { ...args, click: "cell:9911223" });
    expect(b).toBe(a);
    expect(source.histogram).toHaveBeenCalledTimes(1);
    expect(layerHistogramKey({ ...args, click: 1 })).toBe(layerHistogramKey({ ...args, click: 2 }));
  });

  it("a different layer, release, lens or range is a different histogram", async () => {
    const source: HistogramSource = { histogram: vi.fn(async () => ({ ...hist })) };
    await layerHistogramFor(source, args);
    await layerHistogramFor(source, { ...args, layer: "other" });
    await layerHistogramFor(source, { ...args, ver: "v10" });
    await layerHistogramFor(source, { ...args, lens: "species" });
    await layerHistogramFor(source, { ...args, range: [0, 50] });
    expect(source.histogram).toHaveBeenCalledTimes(5);
  });

  it("a failing or down tiler resolves to null (the legend draws the ramp alone)", async () => {
    const throwing: HistogramSource = {
      histogram: async () => {
        throw new Error("500");
      },
    };
    expect(await layerHistogramFor(throwing, args)).toBeNull();
    const nothing: HistogramSource = { histogram: async () => null };
    expect(await layerHistogramFor(nothing, { ...args, layer: "b" })).toBeNull();
  });
});
