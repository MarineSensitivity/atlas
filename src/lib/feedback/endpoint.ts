// U3 "Send feedback": which endpoint the dialog POSTs to. Build-time `VITE_FEEDBACK_URL` (set once
// the runbook's Apps Script is deployed, docs/feedback.md) with a `localStorage` override for
// testing against a second deployment or a local fixture without a rebuild -- the same escape hatch
// CalCOFI Explorer's own `feedbackEndpoint()` uses (../../CalCOFI/explore/src/feedback.tsx).
//
// Both legs are validated (`^https?://`) before use: an empty/unset env var or a garbage
// localStorage value must resolve to `null` (no endpoint), not silently become a broken fetch
// target the dialog then blames on "the network".

const OVERRIDE_KEY = "atlas.feedback_url";
const URL_RE = /^https?:\/\//;

export function feedbackEndpoint(): string | null {
  const env = (import.meta.env.VITE_FEEDBACK_URL as string | undefined)?.trim();
  if (env && URL_RE.test(env)) return env;
  try {
    const stored = localStorage.getItem(OVERRIDE_KEY);
    if (stored && URL_RE.test(stored)) return stored;
  } catch {
    /* private mode / storage disabled -- no override, not an error */
  }
  return null;
}
