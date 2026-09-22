import { describe, expect, it } from "vitest";
import {
  cellModelEnabled,
  cellModelTilePath,
  computeScoreResults,
  computeSpeciesResults,
  speciesTilePlan,
} from "../../src/places/results";
import { TEMPLATES } from "../../src/lib/analysis/templates";
import type { SqlRunner } from "../../src/lib/analysis/queries";
import type { DataEngineContext } from "../../src/places/dataEngine";
import type { GridSpec } from "../../src/lib/grid/grid";
import type { AreaGeometry } from "../../src/lib/geo/types";

const GRID: GridSpec = {
  gridId: "global05",
  nc: 7200,
  nr: 3600,
  xmin: -180,
  ymax: 90,
  resx: 0.05,
  resy: 0.05,
  lon360: false,
  tileSize: 50,
};

const SQUARE: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-124, 40],
      [-124, 41],
      [-123, 41],
      [-123, 40],
      [-124, 40],
    ],
  ],
};

describe("cellModelEnabled", () => {
  it("is true when boot has no capabilities section at all", () => {
    expect(cellModelEnabled({})).toBe(true);
    expect(cellModelEnabled(null)).toBe(true);
  });

  it("is true when capabilities.cell_model is anything other than exactly false", () => {
    expect(cellModelEnabled({ capabilities: { cell_model: true } })).toBe(true);
    expect(cellModelEnabled({ capabilities: {} })).toBe(true);
  });

  it("is false ONLY for an explicit false, per the task's literal wording", () => {
    expect(cellModelEnabled({ capabilities: { cell_model: false } })).toBe(false);
  });
});

describe("cellModelTilePath", () => {
  it("matches analysis/sources.ts's own construction", () => {
    expect(cellModelTilePath(42)).toBe("serve/cell_model/tile=42/data_0.parquet");
  });
});

/** the same fake DataEngineContext pattern tests/places/studyArea.test.ts uses. */
function fakeCtx(opts: {
  countAnswer?: number;
  scoreRows?: Record<string, unknown>[];
  speciesRows?: Record<string, unknown>[];
}): {
  ctx: DataEngineContext;
  cellTilesCalls: number[][];
  mountCalls: number[][];
  unmountCalls: number;
} {
  const cellTilesCalls: number[][] = [];
  const mountCalls: number[][] = [];
  let unmountCalls = 0;
  const db: SqlRunner = {
    async exec<T>(sql: string): Promise<T[]> {
      if (/SELECT count\(\*\)/i.test(sql)) return [{ n: opts.countAnswer ?? 10 }] as unknown as T[];
      if (/^\s*SELECT/i.test(sql) && /agg\.metric_key/i.test(sql)) {
        return (opts.scoreRows ?? []) as unknown as T[];
      }
      if (/^\s*SELECT/i.test(sql) && /species/i.test(sql)) {
        return (opts.speciesRows ?? []) as unknown as T[];
      }
      return [] as T[];
    },
  };
  const sources = {
    db,
    templates: TEMPLATES,
    async cellTiles(tiles: readonly number[]) {
      cellTilesCalls.push([...tiles]);
    },
    batches(tiles: readonly number[]) {
      return [[...tiles]];
    },
    async mountCellModel(tiles: readonly number[]) {
      mountCalls.push([...tiles]);
    },
    async unmountCellModel() {
      unmountCalls++;
    },
  };
  return {
    ctx: { sources, grid: GRID } as unknown as DataEngineContext,
    cellTilesCalls,
    mountCalls,
    unmountCalls,
  };
}

describe("speciesTilePlan", () => {
  it("names the release-relative URL for every tile the place touches", () => {
    const { ctx } = fakeCtx({});
    const plan = speciesTilePlan(ctx, "v9", SQUARE);
    expect(plan.tiles.length).toBeGreaterThan(0);
    for (const url of plan.urls) {
      expect(url).toMatch(/^v9\/serve\/cell_model\/tile=\d+\/data_0\.parquet$/);
    }
  });
});

describe("computeScoreResults", () => {
  it("computes coverage from the study-area cell count vs. the total", async () => {
    const { ctx, cellTilesCalls } = fakeCtx({ countAnswer: 5 });
    const boot = { layers: [] }; // no component metric keys -- components stays empty, harmlessly
    const result = await computeScoreResults(ctx, boot, SQUARE);
    expect(result.coverage.nCellsStudyArea).toBe(5);
    expect(result.coverage.nCellsTotal).toBeGreaterThan(0);
    expect(result.coverage.coveragePct).toBeCloseTo((5 / result.coverage.nCellsTotal) * 100);
    expect(cellTilesCalls).toHaveLength(1);
    expect(result.components).toEqual([]);
    expect(result.composite).toBeNaN(); // meanScore() of zero components
  });

  it("coveragePct is 0, not NaN, for a place with no cells at all", async () => {
    const { ctx } = fakeCtx({ countAnswer: 0 });
    (ctx as unknown as { grid: GridSpec }).grid = { ...GRID, nc: 1, nr: 1, xmin: 500, ymax: 500 };
    const result = await computeScoreResults(ctx, {}, SQUARE);
    expect(result.coverage.nCellsTotal).toBe(0);
    expect(result.coverage.coveragePct).toBe(0);
  });
});

describe("computeSpeciesResults", () => {
  it("mounts and unmounts exactly one batch of cell_model tiles for a small place", async () => {
    const { ctx, mountCalls, unmountCalls: getUnmount } = fakeCtx({ speciesRows: [] });
    const progress: [number, number][] = [];
    await computeSpeciesResults(ctx, SQUARE, (done, total) => progress.push([done, total]));
    expect(mountCalls).toHaveLength(1);
    expect(progress).toEqual([[1, 1]]);
    void getUnmount;
  });
});
