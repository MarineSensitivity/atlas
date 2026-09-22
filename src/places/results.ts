// places/results.ts -- Deliverable 5: composite / components / species for a custom place, by the
// PUBLISHED zone method (master plan D7/D7b) through the existing SQL twins -- the same numbers a
// Program Area's own page shows, computed over a place's own cell set instead of a zone's. The
// flower/DataTable rendering is `ResultsPanel.svelte`'s job (shared `src/lib/ui/` components, not
// anything belonging to the scores lens); this module is engine-facing and lens-agnostic.
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
 * (`CREATE OR REPLACE`), so calling it more than once for the same place is harmless. */
async function ensurePlaceCells(ctx: DataEngineContext, geometry: AreaGeometry) {
  const cells = placeCells(geometry, ctx.grid);
  await ctx.sources.cellTiles(tilesForCells(cells, ctx.grid));
  await createPlaceCells(ctx.sources.db, cells);
  const nCellsStudyArea = await createStudyAreaCells(ctx.sources.db, ctx.sources.templates);
  return { cells, nCellsStudyArea };
}

/** D7b's coverage + Deliverable 5's composite/components. Requires `ctx.sources.coreTables()` to
 * have already run (`dataEngine.ts`'s `boot()` does this once, before this is ever called). */
export async function computeScoreResults(
  ctx: DataEngineContext,
  boot: unknown,
  geometry: AreaGeometry,
): Promise<ScoreResults> {
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
export async function computeSpeciesResults(
  ctx: DataEngineContext,
  geometry: AreaGeometry,
  onBatch?: (done: number, total: number) => void,
): Promise<SpeciesResults> {
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
}
