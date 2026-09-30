// The legend histogram's tile-server read (round 4 R4-A, owner decision D4). Plan D4's "numbers
// never come from the tile server" keeps two display-only exceptions: the species click value via
// `/cog/point` (`raster/point.ts`) and this one, `/cog/statistics` -- the SHAPE of a layer's whole
// distribution, drawn in the legend above the colour ramp (`lib/ui/Legend.svelte`). It serves the
// species lens AND the scores lens' Raster-cells layer (each layer's own COG). It never supplies a
// score, a cell id, a zonal statistic or the clicked value: those still come from Parquet (the
// click's `cell_value` path) or the boot bundle. Callers pass `range` (the legend ramp's own
// rescale min/max) as `histogram_range` so the bins line up with the ramp underneath.
import type { Histogram } from "../map/density";
import { encodeUrlReserved } from "./urlEncode";
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";

/** the only domains `/cog/statistics` may serve — see module header. `scores` is the Raster-cells
 * layer's own COG, display-only (R4-A); Program-area zones never use a tile endpoint. */
export type HistogramDomain = "species" | "scores";

export interface HistogramRequest {
  domain: HistogramDomain;
  /** absolute https URL of the source COG. */
  cogUrl: string;
  /** the histogram bin count titiler is asked for; `binValues()` may re-bin client-side if the
   * caller wants a different count than titiler returns, so this is a hint, not a contract. */
  bins?: number;
  /** the legend ramp's `[min, max]` (the layer's rescale), sent as `histogram_range` so the bins
   * span exactly the ramp; omitted, titiler bins over the band's own min..max. */
  range?: readonly [number, number];
}

export interface HistogramSource {
  histogram(req: HistogramRequest): Promise<Histogram | null>;
}

/** throws unless `req.domain` is `species` or `scores` — the runtime guard `point.ts#
 * assertSpeciesValueRequest` documents; the type alone cannot stop a value built from untyped
 * (e.g. `JSON.parse`d) data. */
export function assertHistogramRequest(req: { domain: string }): void {
  if (req.domain !== "species" && req.domain !== "scores") {
    throw new Error(
      `raster/histogram.ts: /cog/statistics may only serve species or scores legend histograms, ` +
        `got domain "${req.domain}" — Program-area distributions come from the bundle's own ` +
        "zone_metric values, never a tile endpoint (plan D4).",
    );
  }
}

/** `{host}/cog/statistics?url=<enc>&histogram_bins=<n>[&histogram_range=<min>,<max>]` — same
 * `url` encoding as `point.ts`/`tiles.ts`. */
export function titilerStatisticsUrl(
  config: TitilerConfig,
  cogUrl: string,
  bins: number,
  range?: readonly [number, number],
): string {
  const r =
    range && Number.isFinite(range[0]) && Number.isFinite(range[1])
      ? `&histogram_range=${range[0]},${range[1]}`
      : "";
  return `${config.host}/cog/statistics?url=${encodeUrlReserved(cogUrl)}&histogram_bins=${bins}${r}`;
}

/** the slice of `fetch`+`.json()` this needs, injected so tests never touch the network — same
 * contract as `point.ts#PointJsonFetcher`. */
export type HistogramJsonFetcher = (url: string) => Promise<unknown>;

/** titiler's `/cog/statistics` response, the one shape this module reads: `{"b1": {min, max,
 * histogram: [[counts...], [bin_edges...]]}}` (rasterio/rio-tiler's own `raster_statistics()`
 * shape) — every other field (percentiles, mean, std, valid_percent, …) is ignored. `null` for
 * anything that does not match (a differently-shaped error body, a band key other than "b1", a
 * malformed histogram pair) rather than throwing — the legend degrades to the ramp alone, never an
 * error. */
export function parseTitilerStatistics(raw: unknown): Histogram | null {
  if (!raw || typeof raw !== "object") return null;
  const bands = raw as Record<string, unknown>;
  const key = Object.keys(bands).find((k) => bands[k] && typeof bands[k] === "object");
  if (!key) return null;
  const band = bands[key] as Record<string, unknown>;
  const min = band.min;
  const max = band.max;
  const hist = band.histogram;
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  ) {
    return null;
  }
  if (!Array.isArray(hist) || hist.length < 1 || !Array.isArray(hist[0])) return null;
  const counts = (hist[0] as unknown[]).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (counts.length === 0) return null;
  // with `histogram_range` the bin edges (`hist[1]`, n+1 of them) span the REQUESTED range, not the
  // band's own min/max -- the edges are what line the bars up with the ramp, so they win.
  const edges = Array.isArray(hist[1])
    ? (hist[1] as unknown[]).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    : [];
  if (edges.length === counts.length + 1 && edges[edges.length - 1] > edges[0]) {
    return { binCount: counts.length, counts, min: edges[0], max: edges[edges.length - 1] };
  }
  return { binCount: counts.length, counts, min, max };
}

/** the stock-titiler-backed `HistogramSource`. `fetchJson` is required (no default network
 * implementation baked in here), same convention as `point.ts#createTitilerValueSource`. Any
 * failure (network, non-JSON, an unexpected shape) resolves to `null`, never a throw — the caller
 * (`lib/map/distribution.ts`) treats `null` as "no histogram for this legend", not an error state. */
export function createTitilerHistogramSource(
  fetchJson: HistogramJsonFetcher,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): HistogramSource {
  return {
    async histogram(req: HistogramRequest): Promise<Histogram | null> {
      assertHistogramRequest(req);
      const bins = req.bins ?? 20;
      const url = titilerStatisticsUrl(config, req.cogUrl, bins, req.range);
      let raw: unknown;
      try {
        raw = await fetchJson(url);
      } catch {
        return null;
      }
      return parseTitilerStatistics(raw);
    },
  };
}
