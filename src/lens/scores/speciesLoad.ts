// atlas-4 step 2 — orchestrates the engine calls behind the species table / composition treemap,
// so `TablePanel.svelte` stays wiring. The three paths (parity doc §7.3): nothing selected ->
// `species_for_zone(subregion_key, zoneAllKey)`; a zone -> `species_for_zone(<unit>_key, key)`; a
// cell -> the study-area-clipped, batched `species_for_cells` path (D7b). `coreTables()` (taxon,
// zone_taxon, taxonomy) is fetched ONCE per release, memoised here — every later call, whichever
// path it takes, reuses it.
import { getAnalysisSources } from "./engine";
import {
  composition,
  createPlaceCells,
  createStudyAreaCells,
  speciesForCells,
  speciesForZone,
  type SpeciesRow,
} from "../../lib/analysis/queries";
import type { CompositionRow } from "./composition";
import { gridFromBoot, tileOf } from "../../lib/grid/grid";
import { zoneKeyProperty } from "../../lib/map/layers/zones";
import type { ScoresSelection } from "./selection";

let coreLoadedFor: string | null = null;

async function ensureCore(ver: string, boot: Record<string, unknown>) {
  const sources = await getAnalysisSources(ver, boot);
  if (coreLoadedFor !== ver) {
    await sources.coreTables();
    coreLoadedFor = ver;
  }
  return sources;
}

export interface SpeciesLoadOptions {
  selection: ScoresSelection;
  zoneAllKey: string;
}

/**
 * The species table's rows for the current selection. Throws (never silently returns `[]`) on a
 * genuine failure — the caller (`TablePanel.svelte`) turns that into the "unavailable" header the
 * parity doc's `tryCatch` branch shows, rather than an empty-looking table.
 */
export async function loadSpeciesRows(
  ver: string,
  boot: Record<string, unknown>,
  opts: SpeciesLoadOptions,
): Promise<SpeciesRow[]> {
  const sources = await ensureCore(ver, boot);
  if (!opts.selection) {
    return speciesForZone(sources.db, sources.templates, {
      zoneFld: "subregion_key",
      zoneValue: opts.zoneAllKey,
    });
  }
  if (opts.selection.kind === "zone") {
    return speciesForZone(sources.db, sources.templates, {
      zoneFld: zoneKeyProperty(opts.selection.unit),
      zoneValue: opts.selection.key,
    });
  }
  const grid = gridFromBoot(boot);
  const tile = tileOf(opts.selection.cellId, grid);
  await sources.cellTiles([tile]); // no-op if the flower click already loaded this tile (digest-keyed)
  await createPlaceCells(sources.db, [{ cell_id: opts.selection.cellId, pct: 100 }]);
  await createStudyAreaCells(sources.db, sources.templates);
  const batches = sources.batches([tile]);
  try {
    return await speciesForCells(sources.db, sources.templates, {
      batches,
      mount: (tiles) => sources.mountCellModel(tiles),
      unmount: () => sources.unmountCellModel(),
    });
  } finally {
    await sources.unmountCellModel();
  }
}

/** the composition treemap's rows, over whichever species table `loadSpeciesRows` most recently
 * populated (`species_sel`, `sql/species_shares.sql`'s own view — see `analysis/queries.ts`). */
export async function loadCompositionRows(
  ver: string,
  boot: Record<string, unknown>,
): Promise<CompositionRow[]> {
  const sources = await ensureCore(ver, boot);
  const rows = await composition(sources.db, sources.templates);
  return rows as unknown as CompositionRow[];
}
