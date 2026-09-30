// Ben's ask (round-3 review 2026-09-25, moved by round 4 R4-A on 2026-09-30): the histogram of a
// layer's values, drawn in the LEGEND above the colour ramp (`lib/ui/Legend.svelte`) -- the density
// of values across the WHOLE layer, so it never varies with a click; only the marker line does.
// `distributionFor()` is the ONE small interface every lens/unit combination sits behind, with an
// in-memory cache keyed by (ver, lens, layer) -- NEVER by the clicked element. Each concrete source
// degrades to `null` on any failure (network, tiler down, an empty release) -- a caller never
// throws for a missing histogram, the legend just draws the ramp alone.
import { binValues, type Histogram } from "./density";
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
 * share a stale cached curve -- and nothing about a click. A rejected `fetcher()` resolves to
 * `null` in the cache (never leaves a broken promise cached forever) rather than being retried on
 * every subsequent render -- a transient failure degrades to "ramp alone" for the rest of this
 * session on that same layer.
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
 * Scores, Program areas: bins an already-resolved value list (the unit's `zone_metric` values from
 * the boot bundle, `lens/scores/zoneFill.ts#zoneValuesFor`) -- kept lens-agnostic so this module
 * stays so. No engine/network call at all; an empty/absent list bins to nothing (`null`).
 */
export function valueListDistribution(
  values: readonly number[],
  bins = DEFAULT_BINS,
): Histogram | null {
  if (values.length === 0) return null;
  const h = binValues(values, bins);
  return h.binCount === 0 ? null : h;
}

/** what a whole-layer COG histogram depends on. `click` is accepted so a caller may hand over
 * everything it has, and is IGNORED by design -- the key below is the layer's identity only
 * (regression `legend-histogram-stable-across-clicks`). */
export interface LayerHistogramArgs {
  ver: string;
  lens: "scores" | "species";
  /** the layer's identity within the lens: a scores `metric_key`, a species model key + rep. */
  layer: string;
  /** absolute https URL of the layer's own COG. */
  cogUrl: string;
  /** the legend ramp's `[min, max]` (the layer's rescale) -> titiler's `histogram_range`. */
  range: readonly [number, number];
  bins?: number;
  click?: string | number | null;
}

/** the cache key: (ver, lens, layer) plus the range/bins the bars were drawn for. */
export function layerHistogramKey(a: LayerHistogramArgs): string {
  return [a.ver, a.lens, a.layer, a.range[0], a.range[1], a.bins ?? DEFAULT_BINS].join("|");
}

/**
 * Scores Raster cells / Species COG: the whole-layer distribution from titiler's `/cog/statistics`
 * on the layer's own COG (`raster/histogram.ts`, display-only, owner decision D4), cached by
 * {@link layerHistogramKey}. Arrives pre-binned. `null` on any failure -> the ramp alone.
 */
export function layerHistogramFor(
  source: HistogramSource,
  args: LayerHistogramArgs,
): Promise<Histogram | null> {
  return distributionFor(layerHistogramKey(args), () =>
    source.histogram({
      domain: args.lens,
      cogUrl: args.cogUrl,
      bins: args.bins ?? DEFAULT_BINS,
      range: args.range,
    }),
  );
}

/**
 * Species (raster surfaces): the same `/cog/statistics` read, uncached, for a caller that manages
 * its own cache. `range` should be the asset's own `rescale` so the bins line up with the ramp. A
 * vector input (PMTiles range, presence only) has no COG and never calls this.
 */
export async function speciesRasterDistribution(
  source: HistogramSource,
  cogUrl: string,
  bins = 20,
  range?: readonly [number, number],
): Promise<Histogram | null> {
  return source.histogram({ domain: "species", cogUrl, bins, range });
}
