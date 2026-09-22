// places/share.ts -- Deliverable 6: "Copy link shows what the link carries (release, lens, layer,
// camera, n places) and its length." The length/simplification-ladder math already exists
// (`geo/placeCodec.ts`'s `fitPlacesToUrl`, atlas-2) -- this module is the panel's own summary of
// the REST of the URL, which `fitPlacesToUrl` deliberately knows nothing about (it only sees a
// `baseLength` number), plus the before/after diff Deliverable 6 asks the ladder to show.
import { geometryArea, polygonsOf, type AreaGeometry } from "../lib/geo/types";
import { cellsInPolygon } from "../lib/geo/coverage";
import type { GridSpec } from "../lib/grid/grid";
import type { GeomPlace } from "../lib/geo/placeCodec";
import type { Sel } from "../lib/state/types";
import type { Place } from "../lib/geo/placeCodec";

export interface ShareSummary {
  ver: string | null;
  lens: string;
  layer: string | null;
  hasCamera: boolean;
  nPlaces: number;
}

/** what the CURRENT link carries, besides the places themselves -- `#pl=`'s own length is
 * `fitPlacesToUrl`'s concern (placeCodec.ts), not this. */
export function summarizeShare(sel: Sel, places: readonly Place[]): ShareSummary {
  return {
    ver: sel.ver ?? null,
    lens: sel.lens,
    layer: sel.lyr ?? sel.sp ?? null,
    hasCamera: !!sel.map,
    nPlaces: places.length,
  };
}

export function describeShareSummary(s: ShareSummary): string {
  const parts = [s.ver ? `release ${s.ver}` : "the current release", `the ${s.lens} lens`];
  if (s.layer) parts.push(`layer "${s.layer}"`);
  if (s.hasCamera) parts.push("the current map view");
  parts.push(`${s.nPlaces} place${s.nPlaces === 1 ? "" : "s"}`);
  return `This link carries ${parts.join(", ")}.`;
}

/**
 * The actual link to copy, built from `newHash` (a `FitResult.hash` -- the geometry the panel just
 * ANALYSED and is showing the numbers for) rather than trusting `href`'s own `#pl=` to already
 * match it. Fix round 1 (Opus review): `fitPlacesToUrl` can return `status: "ok"` (or "long") with
 * `simplified: true` -- a rung DID have to run to fit the budget -- and copying `location.href`
 * verbatim in that case copies the ORIGINAL, unsimplified (and often far longer) link while the
 * dialog is showing the SIMPLIFIED one's length: a real link/number divergence, not a cosmetic one.
 *
 * A plain string substring-replace, not a `URLSearchParams` round trip: `oldPl` and `newHash` are
 * both the codec's own alphabet (`g1`'s base64url token, or `z.`/`u.` place tokens joined by
 * literal `~`/`,` -- every one of those characters is already a valid, unescaped URL-fragment
 * character, RFC 3986 `pchar` `/` `sub-delims`), so replacing `pl=<oldPl>` with `pl=<newHash>`
 * changes exactly the bytes that differ and nothing else -- which is also what makes
 * `shareUrl(...).length` land EXACTLY on `fit.length` (both are `base + hash.length` over the
 * IDENTICAL base), not merely close.
 */
export function shareUrl(href: string, oldPl: string | undefined, newHash: string): string {
  if (oldPl) return href.replace(`pl=${oldPl}`, `pl=${newHash}`);
  // no existing #pl= to replace (sharing before any place has ever been written back) -- insert
  // one at the front of the hash, ahead of any other hash key (e.g. `t=`).
  const url = new URL(href);
  const rest = url.hash.replace(/^#/, "");
  url.hash = rest ? `#pl=${newHash}&${rest}` : `#pl=${newHash}`;
  return url.toString();
}

function vertexCount(g: AreaGeometry): number {
  return polygonsOf(g).reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0);
}

export interface SimplificationDiff {
  beforeVertices: number;
  afterVertices: number;
  /** signed percent change in planar area. */
  areaChangePct: number;
  /** `null` when no grid was supplied (no release resolved yet) -- the ladder still shows the
   * vertex/area diff without it. */
  cellsBefore: number | null;
  cellsAfter: number | null;
}

/**
 * Before/after a simplification rung, for Deliverable 6's ladder UI: "before/after (vertices, area
 * change %, cells changed) the user accepts". `grid` is optional because a place can be simplified
 * before any release/grid is resolved -- the vertex/area half of the diff never needs one.
 */
export function diffSimplification(
  before: GeomPlace,
  after: GeomPlace,
  grid?: GridSpec,
): SimplificationDiff {
  const areaBefore = geometryArea(before.geometry);
  const areaAfter = geometryArea(after.geometry);
  return {
    beforeVertices: vertexCount(before.geometry),
    afterVertices: vertexCount(after.geometry),
    areaChangePct: areaBefore > 0 ? ((areaAfter - areaBefore) / areaBefore) * 100 : 0,
    cellsBefore: grid ? cellsInPolygon(before.geometry, grid).length : null,
    cellsAfter: grid ? cellsInPolygon(after.geometry, grid).length : null,
  };
}
