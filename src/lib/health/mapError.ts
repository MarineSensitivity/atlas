// Classifies a MapLibre `map.on("error", ...)` event for the health module -- trigger point (b) of
// the V3 brief: "whenever the map reports a tile/raster load error for a non-missing-tile status".
//
// MapLibre's `ErrorEvent.error` is either an `AJAXError` (has `.status`/`.url` -- a real HTTP
// response came back) or a plain `Error` (a network failure, CORS block, or an aborted request --
// no `.status` at all). `src/lib/analysis/sources.ts`'s `isMissingTileStatus` already draws the
// 403/404-is-"empty" line for the DuckDB-parquet tile fetches; this is its map-raster twin, kept
// separate because the shapes differ (a structured `.status` field here vs. a "HTTP <code>" message
// suffix there) and because THIS module additionally has to decide which service a failing tile
// even belongs to (a basemap/PMTiles error must never be misattributed to the tiler probe).
import type { ServiceId } from "./types";

export type TileErrorKind = "empty" | "failure" | "ignored";

export interface TileErrorClassification {
  kind: TileErrorKind;
  /** which service this failure is attributed to -- only set when `kind === "failure"`. */
  service?: ServiceId;
  url?: string;
  status?: number;
  /** the banner's reason clause for this one event, e.g. "HTTP 503" / "network error". A fresh
   * probe (never this raw event) is still what the banner actually renders -- see store.svelte.ts. */
  reason?: string;
}

/** duck-typed against `maplibre-gl`'s `AJAXError` (avoids importing the whole library into a unit
 * test just to construct one). */
interface MapErrorLike {
  status?: unknown;
  url?: unknown;
}

export interface ClassifyMapTileErrorOptions {
  /** the tiler origin (e.g. `DEFAULT_TITILER_HOST`, no trailing slash) -- a failing request whose
   * URL does not start under this host is `"ignored"`, never attributed to the tiler service. */
  tilerHost: string;
}

/**
 * `403`/`404` = the release-side "this tile has no data" gap (P8, `isMissingTileStatus`'s sibling
 * rule for rasters) -- NOT a failure, never shown to the user. Any other status, or no status at
 * all (a network error / CORS block / the browser's own abort), is a real failure. A request whose
 * URL is not under `tilerHost` (a basemap tile, a zones PMTiles range read) is ignored outright --
 * this classifier only ever speaks for the tiler service.
 */
export function classifyMapTileError(
  error: unknown,
  opts: ClassifyMapTileErrorOptions,
): TileErrorClassification {
  const err = error as MapErrorLike | null | undefined;
  const url = typeof err?.url === "string" ? err.url : undefined;
  if (!url || !url.startsWith(opts.tilerHost)) return { kind: "ignored" };
  const status = typeof err?.status === "number" ? err.status : undefined;
  if (status === 403 || status === 404) return { kind: "empty", url, status };
  if (typeof status === "number") {
    return { kind: "failure", service: "tiler", url, status, reason: `HTTP ${status}` };
  }
  return { kind: "failure", service: "tiler", url, reason: "network error" };
}
