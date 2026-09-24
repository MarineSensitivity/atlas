// The optional `VITE_FEEDBACK_URL` leg (originally atlas-8 Deliverable 4; U3, round 2, is the real
// dialog that calls this). When that build-time env var (or its `atlas.feedback_url` localStorage
// override, endpoint.ts) is set, FeedbackDialog.svelte POSTs the built payload (payload.ts) here --
// and falls back to the zero-backend "Open as GitHub issue" link on ANY failure (network error, a
// non-2xx/non-ok response), so a misconfigured or unreachable endpoint never silently swallows
// feedback.
//
// `doFetch` is injected (same seam `src/lib/analytics/transport.ts` uses) so this stays unit-testable
// with no real network call, and so the browser default never runs under Node/Vitest by accident.
//
// NO `keepalive: true` (U3 fix, real defect found writing e2e/feedback.spec.ts): the ORIGINAL
// Deliverable 4 control fired this on the SAME click that could open a new tab, so `keepalive` kept
// it alive across that navigation. U3's dialog stays open through the whole send -- nothing
// navigates away -- and `keepalive` fetches are capped at a 64 KiB combined body quota (WHATWG fetch
// spec): a payload carrying a screenshot (routinely well over that) makes `fetch()` reject
// IMMEDIATELY, before any network attempt, with no distinguishable error and no request Playwright
// (or a real browser's network panel) ever sees -- it silently looked like "the endpoint is
// unreachable" instead of "the request was too big to keep alive." Dropping the flag removes the
// quota entirely; there is no more competing navigation for it to survive.
export type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean }>;

/**
 * POST `payload` (JSON) to `url`. Returns whether it succeeded -- the caller falls back to the
 * GitHub issue link when this resolves `false`. `text/plain` keeps the request a CORS "simple
 * request" (an Apps Script `/exec` endpoint answers no `OPTIONS`, so an `application/json` preflight
 * would be dropped) -- the same reasoning `transport.ts`'s `createBrowserTransport` documents.
 */
export async function postFeedback(
  url: string,
  payload: unknown,
  doFetch: FetchLike,
): Promise<boolean> {
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false; // network error, CORS failure, endpoint down -- the caller falls back to GitHub
  }
}
