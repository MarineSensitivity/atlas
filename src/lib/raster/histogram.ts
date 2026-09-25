// Species raster values ONLY, the popup distribution sparkline's second sanctioned tile-server
// read (Ben's ask, round-3 review, "a sparkline style histogram showing the range of values"; plan
// D4's "numbers never come from the tile server" makes ONE exception, the species click value via
// `/cog/point` -- `raster/point.ts` -- and this is its neighbour: `/cog/statistics`, display-only,
// same reasoning, same `domain: "species"` runtime guard). Scores values still never take this
// path — the scores/Raster-cells sparkline reads Parquet (`lib/analysis/queries.ts#
// cellHistogramValues`), and the scores/Program-areas sparkline reads the bundle's own
// `zone_metric` values (`lib/map/distribution.ts`) — this file exists ONLY for the species lens.
import type { Histogram } from "../map/density";
import { encodeUrlReserved } from "./urlEncode";
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";

/** the only domain `/cog/statistics` may serve — see module header, mirrors `point.ts`. */
export type HistogramDomain = "species";

export interface HistogramRequest {
  domain: HistogramDomain;
  /** absolute https URL of the source COG. */
  cogUrl: string;
  /** the histogram bin count titiler is asked for; `binValues()` may re-bin client-side if the
   * caller wants a different count than titiler returns, so this is a hint, not a contract. */
  bins?: number;
}

export interface HistogramSource {
  histogram(req: HistogramRequest): Promise<Histogram | null>;
}

/** throws unless `req.domain === "species"` — the runtime guard `point.ts#assertSpeciesValueRequest`
 * documents; the type alone cannot stop a value built from untyped (e.g. `JSON.parse`d) data. */
export function assertSpeciesHistogramRequest(req: { domain: string }): void {
  if (req.domain !== "species") {
    throw new Error(
      `raster/histogram.ts: /cog/statistics may only serve species histograms, got domain ` +
        `"${req.domain}" — scores distributions must come from Parquet (engine/ + sql/, or the ` +
        "bundle's own zone_metric values), never a tile endpoint (plan D4).",
    );
  }
}

/** `{host}/cog/statistics?url=<enc>&histogram_bins=<n>` — same `url` encoding as `point.ts`/
 * `tiles.ts`. */
export function titilerStatisticsUrl(config: TitilerConfig, cogUrl: string, bins: number): string {
  return `${config.host}/cog/statistics?url=${encodeUrlReserved(cogUrl)}&histogram_bins=${bins}`;
}

/** the slice of `fetch`+`.json()` this needs, injected so tests never touch the network — same
 * contract as `point.ts#PointJsonFetcher`. */
export type HistogramJsonFetcher = (url: string) => Promise<unknown>;

/** titiler's `/cog/statistics` response, the one shape this module reads: `{"b1": {min, max,
 * histogram: [[counts...], [bin_edges...]]}}` (rasterio/rio-tiler's own `raster_statistics()`
 * shape) — every other field (percentiles, mean, std, valid_percent, …) is ignored. `null` for
 * anything that does not match (a differently-shaped error body, a band key other than "b1", a
 * malformed histogram pair) rather than throwing — the sparkline degrades to "not shown", never an
 * error popup (module header / Ben's ask: "fall back to no sparkline, never an error"). */
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
  return { binCount: counts.length, counts, min, max };
}

/** the stock-titiler-backed `HistogramSource`. `fetchJson` is required (no default network
 * implementation baked in here), same convention as `point.ts#createTitilerValueSource`. Any
 * failure (network, non-JSON, an unexpected shape) resolves to `null`, never a throw — the caller
 * (`lib/map/distribution.ts`) treats `null` as "no sparkline for this popup", not an error state. */
export function createTitilerHistogramSource(
  fetchJson: HistogramJsonFetcher,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): HistogramSource {
  return {
    async histogram(req: HistogramRequest): Promise<Histogram | null> {
      assertSpeciesHistogramRequest(req);
      const bins = req.bins ?? 20;
      const url = titilerStatisticsUrl(config, req.cogUrl, bins);
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
