// atlas-0 S3 spike: aligns candidate (a) rows and candidate (b) pixel windows by GEOGRAPHIC
// position only (never by "which side got an offset") -- so a deliberately misaligned candidate
// (b) window (see spikes/3/e2e/s3.spec.ts, SPIKE3_FAULT_OFFSET) produces a real, large delta
// instead of being silently re-aligned away. That is the seeded fault the Review checklist and the
// S3 gate require: "a spec asserting (a) and (b) agree ... must FAIL when one side is deliberately
// offset by one cell (proof the comparison can see a misalignment)."
import { bboxToRowColRange, rowColFromCellId } from "./grid";
import { runCandidateA } from "./candidateA";
import { runCandidateB, type CandidateBResult } from "./candidateB";
import type { Case } from "./cases";

export interface DeltaStats {
  n: number;
  maxAbsDelta: number;
  meanAbsDelta: number;
  p50AbsDelta: number;
  p99AbsDelta: number;
  maxAt: { cellId: number; metricSeq: number; aVal: number; bVal: number } | null;
}

export interface CompareResult {
  aMs: number;
  bMs: number;
  aRows: number;
  stats: DeltaStats;
}

export async function compareCandidates(kase: Case, offsetA = 0, offsetB = 0): Promise<CompareResult> {
  const [a, b] = await Promise.all([runCandidateA(kase, offsetA), runCandidateB(kase, offsetB)]);
  const stats = computeDeltaStats(kase, a.rows, b);
  return { aMs: a.ms, bMs: b.ms, aRows: a.rows.length, stats };
}

function computeDeltaStats(
  kase: Case,
  aRows: { cell_id: number; metric_seq: number; val: number }[],
  b: CandidateBResult,
): DeltaStats {
  const range = bboxToRowColRange(kase.lonMin, kase.lonMax, kase.latMin, kase.latMax);
  const byMetric = new Map(b.values.map((v) => [v.metricSeq, v]));
  let n = 0;
  let sum = 0;
  let maxAbs = -Infinity;
  let maxAt: DeltaStats["maxAt"] = null;
  const deltas: number[] = [];
  for (const row of aRows) {
    const bv = byMetric.get(row.metric_seq);
    if (!bv) continue;
    const { row0, col0 } = rowColFromCellId(row.cell_id);
    const relRow = row0 - range.rowMin;
    const relCol = col0 - range.colMin;
    if (relRow < 0 || relRow >= bv.heightPx || relCol < 0 || relCol >= bv.widthPx) continue;
    const bVal = bv.data[relRow * bv.widthPx + relCol];
    // -9999 is the COG's nodata sentinel (titiler `/cog/info` -> nodata_value: -9999.0), not a
    // real score -- a cell candidate (a) has (scored) but candidate (b)'s pixel reads as nodata
    // would otherwise register as a huge, meaningless "delta".
    if (!Number.isFinite(bVal) || bVal <= -9998) continue;
    const delta = Math.abs(row.val - bVal);
    n++;
    sum += delta;
    deltas.push(delta);
    if (delta > maxAbs) {
      maxAbs = delta;
      maxAt = { cellId: row.cell_id, metricSeq: row.metric_seq, aVal: row.val, bVal };
    }
  }
  deltas.sort((x, y) => x - y);
  const pct = (p: number) => (deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))] : NaN);
  return {
    n,
    maxAbsDelta: n ? maxAbs : NaN,
    meanAbsDelta: n ? sum / n : NaN,
    p50AbsDelta: pct(0.5),
    p99AbsDelta: pct(0.99),
    maxAt,
  };
}
