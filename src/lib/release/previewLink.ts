// D15 (master plan, 2026-09-21), handed over from atlas-3 to "whoever first builds the version
// picker" — this phase (atlas-4 step 3). A restricted release on the PUBLIC host is offered ONLY
// as a link to the preview host's `/{ver}/atlas/` path, carrying the current query + hash, NEVER
// `?ver={ver}` on Pages: the preview host's Cloudflare Access application is scoped by the
// `/{ver}` path PREFIX (exactly like today's `/{ver}/scores/`), so a query-string version never
// reaches the reviewer policy that would actually let the request through.
//
// Pure: no fetch, no DOM. `loc` is whatever the caller already has (typically `location` itself).

export interface PreviewLinkLoc {
  search: string;
  hash: string;
}

export const PREVIEW_HOST = "https://preview.marinesensitivity.org";

/**
 * The preview-host URL for `ver`, carrying the CURRENT query string and hash verbatim (a stray
 * `?ver=` left over from the public request is harmless there — path beats query in the version
 * -resolution precedence every host follows, `release/version.ts`).
 */
export function previewLinkFor(ver: string, loc: PreviewLinkLoc): string {
  return `${PREVIEW_HOST}/${ver}/atlas/${loc.search}${loc.hash}`;
}
