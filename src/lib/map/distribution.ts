// Ben's ask (round-3 review, 2026-09-25): "a sparkline style histogram showing the range of values
// ... in the popup". `distributionFor()` is the ONE small interface every lens/unit combination
// sits behind, with an in-memory cache keyed by (ver, lens, layer/unit/model) — a popup click never
// waits on a fresh query for a distribution that has not changed since the last click on the same
// layer. Each concrete source degrades to `null` on any failure (network, empty release, an
// unpublished capability) — a caller NEVER throws for a missing sparkline, it just does not render
// one (the popup itself is built and shown before this resolves at all; see `popup.ts`'s own
// header for the "render now, fill in later" sequencing).
import { binValues, type Histogram } from "./density";
import type { SqlRunner, Templates } from "../analysis/queries";
import { cellHistogramValues } from "../analysis/queries";
import type { HistogramSource } from "../raster/histogram";

const DEFAULT_BINS = 40;

/** in-memory only — cleared on reload, never persisted. `clearDistributionCache()` exists for
 * tests, which must not leak state between cases sharing this module-level cache. */
const cache = new Map<string, Promise<Histogram | null>>();

export function clearDistributionCache(): void {
  cache.clear();
}

/**
 * The cache wrapper every concrete source below runs through: `key` should encode everything the
 * distribution depends on (release version, lens, layer/unit/model) so two different layers never
 * share a stale cached curve. A rejected `fetcher()` resolves to `null` in the cache (never leaves
 * a broken promise cached forever) rather than being retried on every subsequent popup — a
 * transient failure degrades to "no sparkline" for the rest of this session's clicks on that same
 * layer, which is the documented behavior ("fall back to no sparkline, never an error").
 */
export function distributionFor(
  key: string,
  fetcher: () => Promise<Histogram | null>,
): Promise<Histogram | null> {
  const cached = cache.get(key);
  if (cached) return cached;
  const p = fetcher().catch(() => null);
  cache.set(key, p);
  return p;
}

/**
 * Scores, Program areas: bins an already-resolved value list (the unit's `zone_metric` values,
 * `lens/scores/popup.ts#zoneMetricDistribution` pulls them from `boot.zones` via `zoneValuesFor()`
 * — kept lens-specific rather than imported here so this module stays lens-agnostic, same
 * boundary every other `lib/` module in this repo holds). No engine/network call at all, so a
 * caller never needs the cache wrapper's failure handling for this source — an empty/absent list
 * just bins to nothing, per `binValues()`'s own empty-input rule.
 */
export function valueListDistribution(
  values: readonly number[],
  bins = DEFAULT_BINS,
): Histogram | null {
  if (values.length === 0) return null;
  const h = binValues(values, bins);
  return h.binCount === 0 ? null : h;
}

/**
 * Scores, Raster cells: `sql/cell_histogram.sql` over whatever tiles are currently mounted
 * (`lib/analysis/queries.ts#cellHistogramValues`) — the same `cell` Parquet view the click's own
 * flower/value fetch already reads, binned client-side. Wrapped in `distributionFor()`'s cache by
 * the caller (`lib/map/popupData.ts`/lens wiring), not here — this function's own job is just "ask
 * the engine, bin the answer, degrade to null".
 */
export async function rasterCellDistribution(
  db: SqlRunner,
  t: Templates,
  metricKey: string,
  bins = DEFAULT_BINS,
): Promise<Histogram | null> {
  const values = await cellHistogramValues(db, t, { metricKey });
  if (values.length === 0) return null;
  const h = binValues(values, bins);
  return h.binCount === 0 ? null : h;
}

/**
 * Species (raster surfaces): titiler's `/cog/statistics` (`raster/histogram.ts`'s
 * `HistogramSource`, the second sanctioned tile-server read beside `/cog/point`) — arrives
 * pre-binned, so no client-side `binValues()` pass. A vector input (range polygon, no numeric
 * values) or an unavailable titiler endpoint both resolve to `null` here, same contract as the
 * source itself.
 */
export async function speciesRasterDistribution(
  source: HistogramSource,
  cogUrl: string,
  bins = 20,
): Promise<Histogram | null> {
  return source.histogram({ domain: "species", cogUrl, bins });
}
