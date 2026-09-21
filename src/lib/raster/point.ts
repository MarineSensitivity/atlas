// Species point values ONLY (plan D4 / CLAUDE.md "Numbers never come from the tile server"): scores,
// cell ids and zonal statistics always come from Parquet via engine/ + sql/ — `/cog/point` is the
// ONE sanctioned exception, and only for a species click value, behind `ValueSource` so a future
// client-side COG renderer (spike S3, deferred) can replace it without touching a caller.
//
// `assertSpeciesValueRequest` is the runtime half of that rule: `ValueRequest.domain` is typed to
// admit only `"species"`, but a request built from untyped data (a lens's own JSON, a message from a
// worker) skips the compiler, so this throws instead of silently sampling a scores raster pixel.
import { encodeUrlReserved } from "./urlEncode";
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";

/** the only domain `/cog/point` may serve — see module header. */
export type ValueDomain = "species";

export interface ValueRequest {
  /** literal `"species"` — nothing else is accepted, even though the type alone cannot stop a value
   * built from untyped (e.g. `JSON.parse`d) data; see `assertSpeciesValueRequest`. */
  domain: ValueDomain;
  lon: number;
  lat: number;
  /** absolute https URL of the source COG. */
  cogUrl: string;
}

export interface ValueSource {
  pointValue(req: ValueRequest): Promise<number | null>;
}

/** throws unless `req.domain === "species"` — the runtime guard the module header promises. Call
 * this at the top of every `ValueSource` implementation, not just the titiler one, so a future
 * client-side COG reader inherits the same rule. */
export function assertSpeciesValueRequest(req: { domain: string }): void {
  if (req.domain !== "species") {
    throw new Error(
      `raster/point.ts: /cog/point may only serve species values, got domain "${req.domain}" — ` +
        "scores values must come from Parquet (engine/ + sql/), never a tile pixel (plan D4).",
    );
  }
}

/** `{host}/cog/point/{lon},{lat}?url=<enc>` — `url` encoded the same way as tiles.ts (urlEncode.ts). */
export function titilerPointUrl(
  config: TitilerConfig,
  lon: number,
  lat: number,
  cogUrl: string,
): string {
  return `${config.host}/cog/point/${lon},${lat}?url=${encodeUrlReserved(cogUrl)}`;
}

/** the slice of `fetch`+`.json()` this needs, injected so tests never touch the network (module
 * contract: "No network call in tests: inject the transport"). */
export type PointJsonFetcher = (url: string) => Promise<unknown>;

/** the stock-titiler-backed `ValueSource`. `fetchJson` is required (no default network
 * implementation baked in here) — the caller wires a real `fetch` in the browser and a fake in tests. */
export function createTitilerValueSource(
  fetchJson: PointJsonFetcher,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): ValueSource {
  return {
    async pointValue(req: ValueRequest): Promise<number | null> {
      assertSpeciesValueRequest(req);
      const url = titilerPointUrl(config, req.lon, req.lat, req.cogUrl);
      let raw: unknown;
      try {
        raw = await fetchJson(url);
      } catch {
        return null; // network/parse failure -> null, matching msens::cog_point_value()'s NA-on-failure contract
      }
      const values = (raw as { values?: unknown } | null)?.values;
      const first = Array.isArray(values) ? values[0] : undefined;
      return typeof first === "number" && Number.isFinite(first) ? first : null;
    },
  };
}
