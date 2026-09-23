// places/results.ts -- Deliverable 5: composite / components / species for a custom place, by the
// PUBLISHED zone method (master plan D7/D7b) through the existing SQL twins -- the same numbers a
// Program Area's own page shows, computed over a place's own cell set instead of a zone's. The
// flower/DataTable rendering is `ResultsPanel.svelte`'s job (shared `src/lib/ui/` components, not
// anything belonging to the scores lens); this module is engine-facing and lens-agnostic.
import { exclusive } from "../lib/analysis/exclusive";
import { placeCells, tilesForCells } from "../lib/analysis/place";
import {
  componentMetricKeys,
  createPlaceCells,
  createStudyAreaCells,
  meanScore,
  scoresForCells,
  speciesForCells,
  type ComponentScore,
  type SpeciesRow,
} from "../lib/analysis/queries";
import type { DataEngineContext } from "./dataEngine";
import type { AreaGeometry } from "../lib/geo/types";
import type { CellCoverage } from "../lib/geo/coverage";

export interface CoverageSummary {
  /** cells this place's geometry overlaps, before any study-area clip. */
  nCellsTotal: number;
  /** D7b: touched cells that are inside the release's study area -- what scores/species/area are
   * actually computed over. */
  nCellsStudyArea: number;
  /** `nCellsStudyArea / nCellsTotal * 100`; 0 for a place with no cells at all. */
  coveragePct: number;
}

export interface ScoreResults {
  coverage: CoverageSummary;
  components: ComponentScore[];
  /** `msens::mean_score()` -- NaN when the place has no scored cell at all. */
  composite: number;
}

/** `boot.capabilities.cell_model` (schema TBD, atlas-1): `false` is the ONLY value that turns
 * species off -- absent/unknown fails OPEN here (species is attempted; a real fetch failure is
 * caught and surfaced separately), matching the task's literal "capabilities.cell_model = false". */
export function cellModelEnabled(boot: unknown): boolean {
  const caps = (boot as { capabilities?: { cell_model?: unknown } } | null | undefined)
    ?.capabilities;
  return caps?.cell_model !== false;
}

/** the `place_cell`/`place_cell_sa` setup every result below depends on -- idempotent
 * (`CREATE OR REPLACE`), so calling it more than once for the same place is harmless.
 *
 * usability B1: ONLY ever called inside `exclusive()` (`lib/analysis/exclusive.ts`), together with
 * the reads that depend on it. Between this function's statements and the scores/species query
 * after it, nothing else may touch `cell`/`place_cell`/`place_cell_sa` -- on 0.10.21 a second
 * analysis did, and a place read 200 % coverage or another place's scores. */
async function ensurePlaceCells(ctx: DataEngineContext, geometry: AreaGeometry) {
  const cells = placeCells(geometry, ctx.grid);
  await ctx.sources.cellTiles(tilesForCells(cells, ctx.grid));
  await createPlaceCells(ctx.sources.db, cells);
  const nCellsStudyArea = await createStudyAreaCells(ctx.sources.db, ctx.sources.templates);
  return { cells, nCellsStudyArea };
}

/** D7b's coverage + Deliverable 5's composite/components. Requires `ctx.sources.coreTables()` to
 * have already run (`dataEngine.ts`'s `boot()` does this once, before this is ever called). */
export function computeScoreResults(
  ctx: DataEngineContext,
  boot: unknown,
  geometry: AreaGeometry,
): Promise<ScoreResults> {
  // usability B1: the cell set and the scores read over it are ONE unit on this engine
  return exclusive(ctx.sources.db, async () => {
    const { cells, nCellsStudyArea } = await ensurePlaceCells(ctx, geometry);
    const coverage: CoverageSummary = {
      nCellsTotal: cells.length,
      nCellsStudyArea,
      coveragePct: cells.length ? (nCellsStudyArea / cells.length) * 100 : 0,
    };
    const metricKeys = componentMetricKeys(boot);
    const components = metricKeys.length
      ? await scoresForCells(ctx.sources.db, ctx.sources.templates, { metricKeys })
      : [];
    return { coverage, components, composite: meanScore(components) };
  });
}

/**
 * D7b's CLIPPED cell set -- the actual rows `place_cell_sa` holds (`sql/cells_in_study_area.sql`),
 * never the raw, unclipped `geo/coverage.ts#cellsInPolygon()` result. Fix round 1 (Opus review):
 * "show analysis cells" was painting the unclipped set (14,238 squares for a place whose analysis
 * only touches 14,165 cells) because it called `cellsInPolygon` directly instead of asking the
 * engine for the SAME clip `computeScoreResults` already runs. This is that clip, exposed so the
 * toggle can paint exactly what D7b says drives scores/species/area/N cells -- nothing else.
 */
export function placeCellsInStudyArea(
  ctx: DataEngineContext,
  geometry: AreaGeometry,
): Promise<CellCoverage[]> {
  // usability B1: the toggle running beside the SAME place's scores is how 0.10.21 doubled
  // `place_cell` -- both inserted into one table between two `CREATE OR REPLACE`s
  return exclusive(ctx.sources.db, async () => {
    await ensurePlaceCells(ctx, geometry);
    return ctx.sources.db.exec<CellCoverage>(
      "SELECT cell_id, pct_covered AS pct FROM place_cell_sa ORDER BY cell_id;",
    );
  });
}

/** the `serve/cell_model` tile path a release publishes -- mirrors `analysis/sources.ts`'s own
 * (private) construction of it, so the fetch-plan estimate and the actual mount agree on the URL. */
export const cellModelTilePath = (tile: number): string =>
  `serve/cell_model/tile=${tile}/data_0.parquet`;

/** the tiles a place's species table needs, and their `cell_model` URLs -- what
 * `places/fetchPlan.ts` measures BEFORE anything is fetched. */
export function speciesTilePlan(
  ctx: DataEngineContext,
  ver: string,
  geometry: AreaGeometry,
): { tiles: number[]; urls: string[] } {
  const cells = placeCells(geometry, ctx.grid);
  const tiles = tilesForCells(cells, ctx.grid);
  return { tiles, urls: tiles.map((t) => `${ver}/${cellModelTilePath(t)}`) };
}

export interface SpeciesResults {
  rows: SpeciesRow[];
  tilesUsed: number;
}

/**
 * The species table, fetched in <= `MAX_CELL_MODEL_TILES`-tile batches (bounded memory, plan
 * `engine/`) -- called only after the fetch plan was shown and (if over the threshold) accepted.
 * `onBatch` fires after each batch's buffers are dropped, for a progress readout.
 */
export function computeSpeciesResults(
  ctx: DataEngineContext,
  geometry: AreaGeometry,
  onBatch?: (done: number, total: number) => void,
): Promise<SpeciesResults> {
  // usability B1: every batch mounts `cell_model`/`cell_model_key` and reads `place_cell_sa`, and
  // the combine replaces `species_agg`/`species_sel` -- the whole walk is one unit on this engine
  return exclusive(ctx.sources.db, async () => {
    await ensurePlaceCells(ctx, geometry);
    const cells = placeCells(geometry, ctx.grid);
    const tiles = tilesForCells(cells, ctx.grid);
    const batches = ctx.sources.batches(tiles);
    let done = 0;
    const rows = await speciesForCells(ctx.sources.db, ctx.sources.templates, {
      batches,
      mount: (batchTiles) => ctx.sources.mountCellModel(batchTiles),
      unmount: async (batchTiles) => {
        await ctx.sources.unmountCellModel();
        void batchTiles;
        done++;
        onBatch?.(done, batches.length);
      },
    });
    return { rows, tilesUsed: tiles.length };
  });
}
