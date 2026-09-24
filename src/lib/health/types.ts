// V3 (P round, 2026-09-24, Ben's own report): titiler-v8 and the API were unreachable for an hour
// tonight and the live atlas kept rendering a perfectly normal-looking map with NO raster and NO
// message. This module is the probe registry that makes an external-service outage VISIBLE instead
// of silent -- "we need to detect this properly and let the user know what is failing" (Ben).
//
// Kept deliberately tiny (size-budget): three small files (types, probe, registry) plus a services
// factory and a thin `.svelte.ts` reactive wrapper -- no framework, no polling loop.

/** the services this app depends on at RUNTIME (not build time). `"api"` is listed for a future
 * release that calls one -- no current release does (grepped: no `VITE_API`/`apiBase`/`apiOrigin`
 * anywhere in `src/`), so nothing registers it today. See services.ts. */
export type ServiceId = "tiler" | "data" | "api";

/** a probe's classification. `"slow"` is a successful response that took longer than
 * `ProbeOptions.slowMs` -- recorded for future use, but {@link import("./registry").bannerFor} only
 * ever raises the banner for `"down"` (an actual failure, not just latency). */
export type ProbeStatus = "ok" | "down" | "slow";

/** one probe's outcome -- always carries the URL it hit and, when not `"ok"`, a short human-
 * readable reason ("timeout", "HTTP 503", "network error") the banner quotes verbatim. */
export interface ProbeResult {
  status: ProbeStatus;
  url: string;
  reason?: string;
  checkedAt: number;
  durationMs?: number;
}

/** what the banner says about one service -- host name for the message, what breaks when it is
 * down, and what still works. `services.ts` is the only place these are filled in. */
export interface ServiceDef {
  id: ServiceId;
  /** the probe target -- a cheap, always-200-when-healthy route (verified live: titiler-v8's
   * `/healthz` answers 200 in ~0.4s / 133 bytes; boot.json is a release's own small manifest). */
  url: string;
  /** the bare host, for the banner's "X is not responding" clause (e.g.
   * "titiler-v8.marinesensitivity.org"). */
  hostLabel: string;
  /** the banner's opening noun phrase, e.g. "Map tiles". */
  displayName: string;
  /** what breaks while this service is down, e.g. "Scores and species rasters cannot be drawn". */
  whatBreaks: string;
  /** what still works, e.g. "places, tables and reports from already-loaded data still work". */
  stillWorks: string;
}
