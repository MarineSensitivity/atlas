// atlas-0 S3 spike, candidate (a): DuckDB-WASM over a tiled `cell_metric` -- whole-object `fetch`
// + `registerFileBuffer` per tile (plan S3 paragraph), never httpfs range reads (CLAUDE.md
// "numbers never come from the tile server" / v1 has no httpfs range reads).
import { initDuckDB } from "./duckdb-setup";
import { bboxToRowColRange, tilesForRowColRange, NC } from "./grid";
import { RESCALED_METRIC_SEQS } from "./metrics";
import type { Case } from "./cases";

const registered = new Set<string>();

function tileFileName(tile: number): string {
  return `tile_${tile}.parquet`;
}

function tileUrl(tile: number): string {
  return `/app/cell/tile=${tile}/data_0.parquet`;
}

export interface CandidateAResult {
  ms: number;
  tiles: number[];
  fetchedTiles: number[]; // tiles actually fetched this call (excludes ones already registered)
  rows: { cell_id: number; metric_seq: number; val: number }[];
}

// registers whatever tiles this case's bbox needs that are not already registered in this
// AsyncDuckDB instance -- returns only the tiles it actually had to fetch, so the caller can tell
// a cold multi-tile query from a warm cache hit.
async function ensureTilesRegistered(db: Awaited<ReturnType<typeof initDuckDB>>, tiles: number[]): Promise<number[]> {
  const fetched: number[] = [];
  for (const tile of tiles) {
    const name = tileFileName(tile);
    if (registered.has(name)) continue;
    const resp = await fetch(tileUrl(tile));
    if (!resp.ok) continue; // tile has no scored cells for our metric set -- not written by make_tiles.sql
    const buf = new Uint8Array(await resp.arrayBuffer());
    await db.registerFileBuffer(name, buf);
    registered.add(name);
    fetched.push(tile);
  }
  return fetched;
}

export async function runCandidateA(kase: Case, rowColOffset = 0): Promise<CandidateAResult> {
  const db = await initDuckDB();
  const conn = await db.connect();
  try {
    const range = bboxToRowColRange(kase.lonMin, kase.lonMax, kase.latMin, kase.latMax);
    // seeded-fault knob (spikes/3/e2e/s3.spec.ts): shifts the row window by N cells so the
    // agreement-with-candidate-(b) gate can be proven to catch a one-cell misalignment.
    const rowMin = range.rowMin + rowColOffset;
    const rowMax = range.rowMax + rowColOffset;
    const tiles = tilesForRowColRange({ ...range, rowMin, rowMax });
    const t0 = performance.now();
    const fetchedTiles = await ensureTilesRegistered(db, tiles);
    const registeredNow = tiles.filter((t) => registered.has(tileFileName(t)));
    if (registeredNow.length === 0) {
      return { ms: performance.now() - t0, tiles, fetchedTiles, rows: [] };
    }
    const fileList = registeredNow.map((t) => `'${tileFileName(t)}'`).join(", ");
    const metricList = RESCALED_METRIC_SEQS.join(", ");
    const sql = `
      SELECT cell_id, metric_seq, val
      FROM read_parquet([${fileList}])
      WHERE ((cell_id - 1) // ${NC}) BETWEEN ${rowMin} AND ${rowMax}
        AND ((cell_id - 1) % ${NC}) BETWEEN ${range.colMin} AND ${range.colMax}
        AND metric_seq IN (${metricList})
      ORDER BY cell_id, metric_seq
    `;
    const result = await conn.query(sql);
    const rows = result.toArray().map((r) => ({
      cell_id: Number(r.cell_id),
      metric_seq: Number(r.metric_seq),
      val: Number(r.val),
    }));
    const ms = performance.now() - t0;
    return { ms, tiles, fetchedTiles, rows };
  } finally {
    await conn.close();
  }
}
