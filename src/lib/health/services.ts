// The two services this release actually depends on at runtime, as `ServiceDef`s (registry.ts's
// banner copy is built entirely from these fields). This is the ONE place `tilerServiceDef`'s host
// and `dataServiceDef`'s per-release URL are formed -- store.svelte.ts and Shell.svelte only ever
// call these factories, never build a `ServiceDef` by hand.
import { DEFAULT_TITILER_HOST } from "../raster/tiles";
import { dataUrl } from "../release/dataBase";
import type { ServiceDef } from "./types";

/** stripped of the scheme for the banner's "X is not responding" clause -- `new URL(url).host`
 * would also work but requires a valid absolute URL; this is a plain string op so a malformed
 * `host` (a test fixture, say) never throws while building copy. */
function bareHost(originOrUrl: string): string {
  return originOrUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/**
 * The tiler probe: `/healthz`, verified live against `https://titiler-v8.marinesensitivity.org` --
 * 200, ~133 bytes, ~0.4s (curled 2026-09-24). Every score/species raster tile is a `/cog/tiles/...`
 * request to this SAME host (`src/lib/raster/tiles.ts`), so this one probe stands in for "can the
 * map draw a raster at all" without shipping a second, heavier route.
 */
export function tilerServiceDef(host: string = DEFAULT_TITILER_HOST): ServiceDef {
  return {
    id: "tiler",
    url: `${host}/healthz`,
    hostLabel: bareHost(host),
    displayName: "Map tiles",
    whatBreaks: "Scores and species rasters cannot be drawn",
    stillWorks: "places, tables and reports from already-loaded data still work",
  };
}

/**
 * The data-origin probe: the SAME `app/boot.json` URL the release itself is fetched from
 * (`src/lib/release/dataBase.ts#dataUrl`, "the ONE place a data origin is formed") -- reusing it
 * rather than inventing a second route keeps this module honest about what it is actually testing.
 *
 * Known gap (not fixed by this round -- see the hand-back "saw but did not fix"): a restricted
 * preview session's `session.data` prefix is not threaded through here, so on the preview host this
 * probes the PUBLIC bucket origin, not the signed-in prefix `dataBase()` would otherwise prefer.
 * Both are the same S3 host today, so the probe is still meaningful; it would need `session` wired
 * from Shell.svelte to be exact for a future prefix that points elsewhere.
 */
export function dataServiceDef(ver: string): ServiceDef {
  const url = dataUrl(ver, "app/boot.json");
  return {
    id: "data",
    url,
    hostLabel: bareHost(url),
    displayName: "Release data",
    whatBreaks: "New releases and cell/species data cannot be loaded",
    stillWorks: "the current map view and already-loaded panels still work",
  };
}
