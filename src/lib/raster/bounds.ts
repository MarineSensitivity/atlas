// D8 (Opus 5.5 eyes-on, 2026-09-24): the LAST resort in the species camera's fallback chain, for a
// taxon that publishes NO bbox on any input or on `card.merged` at all — measured on v7 (every
// asset's `bbox` is `null`, `assets: []` on the walrus, mdl_seq 54383; camera.ts's own header:
// "v7 publishes no bbox at all"). `camera.ts` itself stays network-free by contract (its own
// header: "WHY THERE IS NO QUERY HERE"), so this is a SEPARATE module the species lens' wiring
// (`state.svelte.ts`) calls only once camera.ts's own bundle-only chain has already fallen to the
// study area — the COG being drawn still carries its own true extent, and stock titiler's
// `/cog/bounds` (byte-for-byte the same `url=` query convention as point.ts/tiles.ts) answers it.
import { encodeUrlReserved } from "./urlEncode";
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";
import type { Bbox } from "../../lens/species/data/shards";

/** `{host}/cog/bounds?url=<enc>` — stock titiler's own endpoint, same encoding as every other
 * `/cog/*` URL this app builds (tiles.ts/point.ts). */
export function titilerBoundsUrl(config: TitilerConfig, cogUrl: string): string {
  return `${config.host}/cog/bounds?url=${encodeUrlReserved(cogUrl)}`;
}

/** the slice of `fetch`+`.json()` this needs, injected so tests never touch the network (module
 * contract: "No network call in tests: inject the transport" — the same rule point.ts's
 * `PointJsonFetcher` follows). */
export type BoundsJsonFetcher = (url: string) => Promise<unknown>;

export interface BoundsSource {
  /** the COG's own `[xmin, ymin, xmax, ymax]`, or `null` on any failure (network, a non-JSON body,
   * a malformed `bounds` array) — never a throw, matching every other raster/ reader's "a bad
   * answer degrades to null, not a crash" rule. */
  cogBounds(cogUrl: string): Promise<Bbox | null>;
}

/** the stock-titiler-backed `BoundsSource`. `fetchJson` is required (no default network
 * implementation baked in here) — the caller wires a real `fetch` in the browser and a fake in
 * tests, same convention as `point.ts#createTitilerValueSource`. */
export function createTitilerBoundsSource(
  fetchJson: BoundsJsonFetcher,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): BoundsSource {
  return {
    async cogBounds(cogUrl: string): Promise<Bbox | null> {
      let raw: unknown;
      try {
        raw = await fetchJson(titilerBoundsUrl(config, cogUrl));
      } catch {
        return null; // network/parse failure -> null, never a throw (mirrors point.ts's own rule)
      }
      const bounds = (raw as { bounds?: unknown } | null)?.bounds;
      if (!Array.isArray(bounds) || bounds.length !== 4) return null;
      const [xmin, ymin, xmax, ymax] = bounds;
      const nums = [xmin, ymin, xmax, ymax];
      if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
      return [xmin, ymin, xmax, ymax] as Bbox;
    },
  };
}
