// D8 (Opus 5.5 eyes-on, 2026-09-24; orchestrator round 2, real-v7-build eyes-on): the LAST resort
// in the species camera's fallback chain, for a taxon that publishes NO bbox on any input or on
// `card.merged` at all — measured on v7 (every asset's `bbox` is `null`, `assets: []` on the
// walrus, mdl_seq 54383; camera.ts's own header: "v7 publishes no bbox at all"). `camera.ts` itself
// stays network-free by contract (its own header: "WHY THERE IS NO QUERY HERE"), so this is a
// SEPARATE module the species lens' wiring (`state.svelte.ts`) calls only once camera.ts's own
// bundle-only chain has already fallen to the study area.
//
// ROUND 2 (real build): the round-1 version of this file called stock titiler's `/cog/bounds` —
// verified LIVE against titiler-v8 to 404 ("Not Found"; that route is not registered on this
// deployment). `/cog/info` IS live (verified: 200, `{bounds:[...], width, height, ...}`) and its
// `bounds` field is what this module now reads.
//
// A SECOND, real problem `/cog/info`'s bounds alone does not solve: the walrus's own v7 merged COG
// reports `bounds: [-180, 53.15, 180, 73.75]` — a genuinely FULL 360-degree longitude span, not a
// metadata artifact. Verified with `/cog/point` samples along that latitude: only ONE of fourteen
// longitudes tried (-170) held real data; every other (-160 through 170, spanning the rest of the
// globe) answered `null`. The file's own extent is honestly whole-longitude/narrow-latitude (a
// usa05-grid COG the publish pipeline never cropped past a shared latitude band), so `/cog/info`
// alone would frame the entire globe's width at a thin Arctic band — not the range. `narrowLongitude`
// below is the fix: when the info bbox's longitude span is degenerate (`bboxSpansGlobe`-wide),
// probe a SMALL, FIXED set of candidate longitudes (the real US EEZ's own rough footprint — Aleutians
// through the Gulf/Atlantic/Caribbean/Hawaii/CNMI, the same regions `boot.study_areas` already names)
// at the bbox's own latitude midpoint via `/cog/point` (plan D4's one sanctioned tile-server read for
// species values — this reuses that exact endpoint, never a new one), and once ANY of them hits real
// data, frames a MODEST window around it rather than the file's own (correct but useless) full width.
// Bounded cost (at most `CANDIDATE_LONS.length` extra requests, fired only on this already-rare
// last-resort path) and an honest approximation — documented as such, never claimed to be exact.
import { encodeUrlReserved } from "./urlEncode";
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";
import { titilerPointUrl } from "./point";
import { bboxSpansGlobe } from "../grid/grid";
import type { Bbox } from "../../lens/species/data/shards";

/** `{host}/cog/info?url=<enc>` — stock titiler's own endpoint (verified live; `/cog/bounds` is
 * NOT registered on titiler-v8), same encoding as every other `/cog/*` URL this app builds
 * (tiles.ts/point.ts). */
export function titilerInfoUrl(config: TitilerConfig, cogUrl: string): string {
  return `${config.host}/cog/info?url=${encodeUrlReserved(cogUrl)}`;
}

/** the slice of `fetch`+`.json()` this needs, injected so tests never touch the network (module
 * contract: "No network call in tests: inject the transport" — the same rule point.ts's
 * `PointJsonFetcher` follows). */
export type BoundsJsonFetcher = (url: string) => Promise<unknown>;

export interface BoundsSource {
  /** the COG's own `[xmin, ymin, xmax, ymax]` (from `/cog/info`), narrowed by `narrowLongitude`
   * when the raw extent is a degenerate (whole-globe-width) longitude span — or `null` on any
   * failure (network, a non-JSON body, a malformed `bounds` array, or a degenerate extent whose
   * longitude narrowing also failed to find real data). Never a throw, matching every other
   * raster/ reader's "a bad answer degrades to null, not a crash" rule. */
  cogBounds(cogUrl: string): Promise<Bbox | null>;
}

/** an extent this wide cannot be the taxon's real range (`msens::bbox_spans_globe`'s own threshold,
 * already ported as `bboxSpansGlobe` — camera.ts's `GLOBE_SPAN_DEG` uses the same value for the
 * SAME reason: a bundle-published bbox this wide is rejected there, never obeyed). */
const GLOBE_SPAN_DEG = 350;

/** a handful of longitudes covering the US EEZ's own rough footprint (Aleutians through the
 * Gulf/Atlantic/Caribbean, plus Hawaii and the Pacific Island Territories) — the same regions
 * `boot.study_areas` already names as presets, not invented geography. -170 is the walrus's own
 * real longitude (verified live, this module's own header), kept in the list rather than rounded
 * away to a nearby candidate. One `/cog/point` sample each, at the degenerate bbox's own latitude
 * midpoint, is the cheapest way to find WHERE in that full-width band the taxon's real data
 * actually sits. */
const CANDIDATE_LONS: readonly number[] = [
  -177, -170, -165, -150, -135, -120, -108, -97, -88, -80, -70, -66, -157, 145,
];

/** half-width of the framed window once a candidate longitude hits real data (degrees) — modest
 * on purpose: this is a best-effort approximation, not a tight fit, and erring wide is the safe
 * direction (never crops the actual range further than the file's own metadata already implies). */
const NARROWED_HALF_WIDTH_DEG = 20;

async function hasDataAt(
  fetchJson: BoundsJsonFetcher,
  config: TitilerConfig,
  cogUrl: string,
  lon: number,
  lat: number,
): Promise<boolean> {
  let raw: unknown;
  try {
    raw = await fetchJson(titilerPointUrl(config, lon, lat, cogUrl));
  } catch {
    return false;
  }
  const values = (raw as { values?: unknown } | null)?.values;
  const first = Array.isArray(values) ? values[0] : undefined;
  return typeof first === "number" && Number.isFinite(first);
}

/**
 * When `bbox`'s longitude span is degenerate (whole-globe-width — this module's own header has the
 * measured walrus example), probe {@link CANDIDATE_LONS} at `bbox`'s own latitude midpoint and
 * frame a modest window around the FIRST one that holds real data. Returns `bbox` UNCHANGED when
 * it is not degenerate, and `null` when it is degenerate AND no candidate held data (the caller
 * falls back to the study area, same as before this module existed).
 */
export async function narrowLongitude(
  fetchJson: BoundsJsonFetcher,
  config: TitilerConfig,
  cogUrl: string,
  bbox: Bbox,
): Promise<Bbox | null> {
  const [xmin, ymin, xmax, ymax] = bbox;
  if (xmax - xmin < GLOBE_SPAN_DEG) return bbox; // not degenerate — nothing to narrow
  const midLat = (ymin + ymax) / 2;
  for (const lon of CANDIDATE_LONS) {
    // deliberately sequential: stop at the FIRST hit, never fire every candidate when an early
    // one already answers (this is a last-resort path, never the common case, but still worth
    // not needlessly hammering titiler on every load).
    if (await hasDataAt(fetchJson, config, cogUrl, lon, midLat)) {
      return [lon - NARROWED_HALF_WIDTH_DEG, ymin, lon + NARROWED_HALF_WIDTH_DEG, ymax];
    }
  }
  return null;
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
        raw = await fetchJson(titilerInfoUrl(config, cogUrl));
      } catch {
        return null; // network/parse failure -> null, never a throw (mirrors point.ts's own rule)
      }
      const bounds = (raw as { bounds?: unknown } | null)?.bounds;
      if (!Array.isArray(bounds) || bounds.length !== 4) return null;
      const [xmin, ymin, xmax, ymax] = bounds;
      const nums = [xmin, ymin, xmax, ymax];
      if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
      const bbox: Bbox = [xmin, ymin, xmax, ymax];
      if (!bboxSpansGlobe(bbox, GLOBE_SPAN_DEG)) return bbox;
      return narrowLongitude(fetchJson, config, cogUrl, bbox);
    },
  };
}
