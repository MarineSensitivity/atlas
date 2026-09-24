// round 2, Q7: `createAnalytics({ logUrl })` (analytics.ts) has always accepted a `logUrl` option
// and documented it as "`VITE_LOG_URL`; unset/empty -> the Sheet leg is a silent no-op" -- but
// nothing ever READ that env var. Both construction sites (Shell.svelte, Report.svelte) called
// `createAnalytics()` with no `logUrl` at all, so the Sheet-log beacon could never fire no matter
// what Ben set the repository variable to; `docs/analytics.md` and the orchestrator's own
// instructions to him said otherwise. This module is the missing read, mirroring
// `src/lib/feedback/endpoint.ts`'s `feedbackEndpoint()` (same trim + validate-before-use shape),
// with two differences that match the Sheet leg rather than the feedback dialog: it returns `""`
// (analytics.ts's own default for an absent `logUrl`), never `null`, and it accepts ONLY
// `https://` -- the Apps Script `/exec` endpoint is always https, so a typo (a bare hostname, an
// `http://` value, anything else) must fail closed to `""` rather than let `analytics.ts` queue
// Sheet rows at a broken or, worse, attacker-controlled target.
const URL_RE = /^https:\/\//;

export function analyticsLogUrl(): string {
  const env = (import.meta.env.VITE_LOG_URL as string | undefined)?.trim();
  if (env && URL_RE.test(env)) return env;
  return "";
}
