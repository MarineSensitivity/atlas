// atlas-2 Step 3b: the browser half of the parity gate.
//
// NOT app code. It boots the REAL `Engine` (a real same-origin worker, a real WASM module, the
// same-origin extension mirror) and drives the REAL `src/lib/analysis/{sources,queries}.ts` over
// the REAL `sql/*.sql` twins against a release served the way the bucket serves it -- so the one
// thing `scripts/parity/run.mjs` cannot prove (that DuckDB-WASM answers what the DuckDB CLI
// answers, over `registerFileBuffer` rather than a local file path) is proved here, in three
// engines, with `extensions.duckdb.org` blocked by the spec.
import { AnalysisSources } from "../../../src/lib/analysis/sources";
import {
  cellComponents,
  componentMetricKeys,
  composition,
  createPlaceCells,
  createStudyAreaCells,
  meanScore,
  scoresForCells,
  speciesForCells,
  speciesForZone,
} from "../../../src/lib/analysis/queries";
import { TEMPLATES } from "../../../src/lib/analysis/templates";
import { placeCells, tilesForCells } from "../../../src/lib/analysis/place";
import { createRealDuckDB } from "../../../src/lib/engine/bundles";
import { Engine } from "../../../src/lib/engine/engine";
import type { AreaGeometry } from "../../../src/lib/geo/types";
import type { GridSpec } from "../../../src/lib/grid/grid";

export interface RunOptions {
  /** the release data root, laid out like the bucket (`scripts/parity/serve.mjs`, port 4441). */
  base: string;
  ver: string;
  zone: { fld: string; value: string };
  cellId: number;
  place: { geometry: AreaGeometry };
}

export interface RunResult {
  ok: boolean;
  error?: string;
  engineVersion?: string;
  idField?: string;
  speciesZone?: unknown[];
  speciesCell?: unknown[];
  scores?: unknown[];
  composite?: number;
  cellComponents?: unknown[];
  composition?: unknown[];
  nCells?: number;
  nCellsStudyArea?: number;
  nCellModelBatches?: number;
}

function gridOf(boot: Record<string, unknown>): GridSpec {
  const g = boot.grid as Record<string, number & boolean & { size: number }>;
  return {
    gridId: String((g as unknown as { grid_id: string }).grid_id),
    nc: Number(g.nc),
    nr: Number(g.nr),
    xmin: Number(g.xmin),
    ymax: Number(g.ymax),
    resx: Number(g.resx),
    resy: Number(g.resy),
    lon360: (g as unknown as { lon360: boolean }).lon360 === true,
    tileSize: Number((g as unknown as { tile: { size: number } }).tile.size),
  };
}

async function run(opts: RunOptions): Promise<RunResult> {
  const engine = new Engine({ createDb: () => createRealDuckDB() });
  try {
    const url = (p: string) => new URL(`${opts.ver}/${p}`, opts.base).href;
    const boot = (await (await fetch(url("app/boot.json"))).json()) as Record<string, unknown>;
    const grid = gridOf(boot);
    const metricKeys = componentMetricKeys(boot);
    const src = new AnalysisSources(engine, { url, boot, templates: TEMPLATES });
    await src.coreTables();

    // --- one species-for-zone (the precomputed zone_taxon path)
    const speciesZone = await speciesForZone(src.db, TEMPLATES, {
      zoneFld: opts.zone.fld,
      zoneValue: opts.zone.value,
    });
    // --- one composition (the taxonomy join, over that same selection)
    const comp = await composition(src.db, TEMPLATES);

    // --- one scores-for-cells over a real place fixture
    const cells = placeCells(opts.place.geometry, grid);
    await src.cellTiles(tilesForCells(cells, grid));
    await createPlaceCells(src.db, cells);
    const nSa = await createStudyAreaCells(src.db, TEMPLATES);
    const scores = await scoresForCells(src.db, TEMPLATES, { metricKeys });

    // --- one cell-components (the click popup)
    const cellTile = tilesForCells([{ cell_id: opts.cellId, pct: 100 }], grid);
    await src.cellTiles(cellTile);
    const comps = await cellComponents(src.db, TEMPLATES, { cellId: opts.cellId, metricKeys });

    // --- one species-for-cells through the batched, bounded-memory path
    await createPlaceCells(src.db, [{ cell_id: opts.cellId, pct: 100 }]);
    await createStudyAreaCells(src.db, TEMPLATES);
    const batches = src.batches(cellTile);
    const speciesCell = await speciesForCells(src.db, TEMPLATES, {
      batches,
      mount: (tiles) => src.mountCellModel(tiles),
      unmount: () => src.unmountCellModel(),
    });

    return {
      ok: true,
      engineVersion: engine.engineVersion,
      idField: src.idField,
      speciesZone,
      speciesCell,
      scores,
      composite: meanScore(scores),
      cellComponents: comps,
      composition: comp,
      nCells: cells.length,
      nCellsStudyArea: nSa,
      nCellModelBatches: batches.length,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await engine.dispose();
  }
}

declare global {
  interface Window {
    __parityTest: { run: (opts: RunOptions) => Promise<RunResult> };
  }
}

window.__parityTest = { run };
