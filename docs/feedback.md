# Beta feedback: zero backend

atlas-8 Deliverable 4. "Report a problem" (the About card, bottom-left over the map, desktop only —
see `src/shell/Shell.svelte`'s `.about-region`) opens a prefilled GitHub issue in
`MarineSensitivity/atlas`, labeled `beta-feedback`. No server: the same fallback CalCOFI Explorer
used (`atlas-refs/"calcofi explore review.md"`'s own citation).

## What the issue body carries

`src/lib/feedback/issueUrl.ts`'s `feedbackIssueUrl(ctx)` — a pure function, unit-tested in
`tests/feedback/issueUrl.test.ts` — composes:

- the app version (`__APP_VERSION__`) and the git SHA (`__APP_SHA__`, `vite.config.ts`'s `define`;
  `"unknown"` when git is unavailable, e.g. a CI fixture build)
- the resolved release (`ver`)
- the lens (`scores`/`species`)
- the page URL, **fragment stripped, query kept** (`origin + pathname + search`) — never
  `location.href`. The fragment carries a drawn place (`#pl=`) or the report title (`#t=`); plan D8's
  privacy rule ("geometry never leaves the browser, not even to analytics") applies here too.
  `src/lib/feedback/**` never reads the live page location itself — the caller (`Shell.svelte`)
  builds the query from the reactive `Sel` (`formatSel(sel).search`, not `location.search`) so the
  link's `href` stays current across a lens/release/theme change, and hands in a plain object with no
  `hash`/`href` field at all. `tests/feedback/noHash.test.ts` is the source-scan gate that keeps it
  that way (the same technique `tests/analytics/noRawLocation.wiring.test.ts` uses).
- the browser's user agent, viewport size and resolved theme
- a short "What happened / What you expected" template

The whole URL is encoded with `URLSearchParams` and kept under ~7,500 characters (GitHub truncates a
`new/…` issue URL around 8 KB): the user agent is trimmed first, then the template is dropped —
never an identifier (version, SHA, release, lens, URL).

## `VITE_FEEDBACK_URL` (optional, build-time)

Unset (the default): the control is a plain `<a target="_blank" rel="noopener">` to the GitHub link
above.

Set to an Apps Script (or similar) `/exec` endpoint: clicking the control instead `fetch`es the same
context there as JSON, `keepalive: true`, `Content-Type: text/plain` (keeps it a CORS "simple
request" — an Apps Script endpoint answers no `OPTIONS`, so a JSON preflight would be dropped; see
`src/lib/analytics/transport.ts`'s identical reasoning). On any failure (network error, non-`ok`
response) it falls back to opening the same GitHub issue link a plain click would have — feedback is
never silently swallowed. See `src/lib/feedback/postFeedback.ts`.

## Seeded fault

`tests/faults/feedback-location-href.patch` (`npm run test:faults`): `pageUrlFromLocation` rewritten
to ignore its argument and `return location.href` instead — in a real browser this is the SAME live
page location `Shell.svelte` already holds, so it silently starts leaking the hash into the "Report a
problem" link. Turns `tests/feedback/noHash.test.ts` red (the literal token is now in the shipped
file) **and** `e2e/feedback.spec.ts` red (the control's real `href` now contains the hash) — the
`test:faults` entry proves the first; the second was verified by hand (see this deliverable's report)
and is not re-run automatically, the same way this repo's other Playwright-based seeded faults are
committed-but-manual until a later phase wires `e2e` into `test:faults` itself (`GATES.md`).
