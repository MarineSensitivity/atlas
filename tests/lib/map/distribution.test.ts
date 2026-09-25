// Ben's ask (round-3 review): the popup sparkline's ONE small interface, `distributionFor()`, plus
// its three concrete sources. See src/lib/map/distribution.ts's own header.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDistributionCache,
  distributionFor,
  rasterCellDistribution,
  speciesRasterDistribution,
  valueListDistribution,
} from "../../../src/lib/map/distribution";
import { TEMPLATES } from "../../../src/lib/analysis/templates";
import type { SqlRunner } from "../../../src/lib/analysis/queries";
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

function fakeDb(rows: Record<string, unknown>[]): SqlRunner {
  return {
    async exec<T>(): Promise<T[]> {
      return rows as unknown as T[];
    },
  };
}

describe("rasterCellDistribution (scores, Raster cells)", () => {
  it("queries and bins the mounted cell tile's column", async () => {
    const db = fakeDb([{ val: 10 }, { val: 20 }, { val: 30 }]);
    const h = await rasterCellDistribution(db, TEMPLATES, "score");
    expect(h?.min).toBe(10);
    expect(h?.max).toBe(30);
  });

  it("no mounted tiles -> null, never a throw", async () => {
    const db = fakeDb([]);
    expect(await rasterCellDistribution(db, TEMPLATES, "score")).toBeNull();
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
    });
  });

  it("a source returning null (vector input, unavailable endpoint) passes null through", async () => {
    const source: HistogramSource = { histogram: async () => null };
    expect(await speciesRasterDistribution(source, "https://x/y.tif")).toBeNull();
  });
});
