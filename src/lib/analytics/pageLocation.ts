// `page_location` is REBUILT from origin + path + an allow-list of query keys — NEVER
// `location.hash`. The hash carries places (`#pl=`) and the report title (`#t=`) exactly so they
// cannot reach a server, a referrer header, or analytics (plan D8, master-plan first table's privacy
// row: "geometry never leaves the browser, not even to analytics"). `LocationLike` deliberately has
// no `hash` field, so even a caller that hands this a real `window.location` (which does have one)
// gets a compile-time guarantee this module never reads it.
//
// The allow-list is state/types.ts's own `QUERY_KEYS` — the exact list of query keys `Sel` ever
// writes (state/'s header: "Query holds short, non-sensitive scalars") — imported rather than
// duplicated so the two cannot drift apart. `HASH_KEYS` (`pl`, `t`) never appears here because this
// module never even looks at the hash.
import { QUERY_KEYS } from "../state/types";

export interface LocationLike {
  origin: string;
  pathname: string;
  /** `location.search`, leading `?` optional — NOT `location.hash`. */
  search: string;
}

function filteredSearch(search: string, allowedKeys: readonly string[]): string {
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  // iterate allowedKeys (not the incoming param order) so output key order is stable and any key
  // outside the allow-list is dropped, never merely reordered
  for (const key of allowedKeys) {
    for (const value of params.getAll(key)) kept.append(key, value);
  }
  const qs = kept.toString();
  return qs ? `?${qs}` : "";
}

/** the full `page_location` GA4 wants: origin + path + allow-listed query, never the hash. */
export function buildPageLocation(
  loc: LocationLike,
  allowedKeys: readonly string[] = QUERY_KEYS,
): string {
  return loc.origin + loc.pathname + filteredSearch(loc.search, allowedKeys);
}

/** the Sheet log's `page` column (`ms_log_header()`'s `page` field, `analytics.R`'s
 * `location.pathname + location.search`) — same allow-listing, no origin. */
export function buildPagePath(
  loc: LocationLike,
  allowedKeys: readonly string[] = QUERY_KEYS,
): string {
  return loc.pathname + filteredSearch(loc.search, allowedKeys);
}
