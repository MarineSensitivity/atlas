// The optional `VITE_FEEDBACK_URL` leg (plan atlas-8 Deliverable 4: "A `VITE_FEEDBACK_URL` Apps
// Script endpoint can be added later"). When that build-time env var is set, the "Report a problem"
// control POSTs the same context `feedbackIssueUrl` would have turned into a GitHub issue, instead
// of navigating there -- and falls back to the GitHub link on ANY failure (network error, a non-2xx/
// non-ok response), so a misconfigured or unreachable endpoint never silently swallows feedback.
//
// `doFetch` is injected (same seam `src/lib/analytics/transport.ts` uses) so this stays unit-testable
// with no real network call, and so the browser default never runs under Node/Vitest by accident.

export type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean }>;

/**
 * POST `payload` (JSON) to `url` with `keepalive: true` (survives the click opening a new tab / the
 * page unloading right after). Returns whether it succeeded -- the caller falls back to the GitHub
 * issue link when this resolves `false`. `text/plain` keeps the request a CORS "simple request" (an
 * Apps Script `/exec` endpoint answers no `OPTIONS`, so an `application/json` preflight would be
 * dropped) -- the same reasoning `transport.ts`'s `createBrowserTransport` documents.
 */
export async function postFeedback(
  url: string,
  payload: unknown,
  doFetch: FetchLike,
): Promise<boolean> {
  try {
    const res = await doFetch(url, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false; // network error, CORS failure, endpoint down -- the caller falls back to GitHub
  }
}
