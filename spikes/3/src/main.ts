// atlas-0 S3 spike harness page (index.html). Exposes window.__spike3 for the Playwright spec to
// drive -- see spikes/3/e2e/s3.spec.ts. Nothing here runs automatically; every operation is
// triggered explicitly so the spec can isolate "one-time init" network traffic from "per-case
// query" network traffic (a fresh browser context per case keeps the HTTP cache cold).
import { initDuckDB } from "./duckdb-setup";
import { runCandidateA } from "./candidateA";
import { runCandidateB } from "./candidateB";
import { compareCandidates } from "./compare";
import { CASES, type CaseName } from "./cases";

declare global {
  interface Window {
    __spike3: {
      initA(): Promise<void>;
      initB(): Promise<void>;
      runA(caseName: CaseName, rowColOffset?: number): Promise<{ ms: number; rowCount: number; tiles: number[]; fetchedTiles: number[]; sample: unknown[] }>;
      runB(caseName: CaseName, rowColOffset?: number): Promise<{ ms: number; metricCount: number; pixelCount: number }>;
      compare(caseName: CaseName, offsetA?: number, offsetB?: number): ReturnType<typeof compareCandidates>;
    };
  }
}

window.__spike3 = {
  async initA() {
    await initDuckDB();
  },
  async initB() {
    // geotiff has no bootstrap step (pure JS, no wasm/worker) -- kept for a symmetric API.
  },
  async runA(caseName, rowColOffset = 0) {
    const result = await runCandidateA(CASES[caseName], rowColOffset);
    return {
      ms: result.ms,
      rowCount: result.rows.length,
      tiles: result.tiles,
      fetchedTiles: result.fetchedTiles,
      sample: result.rows.slice(0, 5),
    };
  },
  async runB(caseName, rowColOffset = 0) {
    const result = await runCandidateB(CASES[caseName], rowColOffset);
    const pixelCount = result.values.reduce((n, v) => n + v.data.length, 0);
    return { ms: result.ms, metricCount: result.values.length, pixelCount };
  },
  async compare(caseName, offsetA = 0, offsetB = 0) {
    return compareCandidates(CASES[caseName], offsetA, offsetB);
  },
};
