// The release-access gate (plan D6, "the review gate"): **the public host renders public releases
// only**. Restricted releases (today v7b, v8, v9) may render only on the preview host, which is
// the only host where a same-origin `session.json` exists and says `preview: true`.
//
// This is a security- and gate-shaped rule, so everything here fails CLOSED: anything that is not
// positively known to be public — an unknown version, a row with no `access` key, an unreadable
// `versions.json` — is treated as not-renderable unless a preview session says otherwise, and the
// unreadable-registry case is narrower still (see `decideAccess`).
//
// Nothing in this module fetches. `index.html`'s inline early-fetch script is a hand-kept plain-JS
// copy of these same rules (it must run before any bundle parses); `tests/release/access-cases.ts`
// is the single case table both copies are driven through, so they cannot drift.

/** one row of the registry's `versions.json` (a list of these). */
export interface VersionRow {
  ver?: string;
  status?: string;
  access?: string;
  prev?: string | null;
  released?: string;
}

/**
 * - `public` — a row exists and says so, the ONLY affirmative answer;
 * - `restricted` — a row exists and does not say `public` (including `access` missing entirely, or
 *   an unrecognized value: a typo or a newer vocabulary must not open the gate);
 * - `unknown` — no row, or no readable registry at all.
 */
export type AccessLevel = "public" | "restricted" | "unknown";

export function accessOf(rows: VersionRow[] | null | undefined, ver: string | null): AccessLevel {
  if (!ver || !Array.isArray(rows)) return "unknown";
  const row = rows.find((r) => r && typeof r === "object" && r.ver === ver);
  if (!row) return "unknown";
  return row.access === "public" ? "public" : "restricted";
}

/**
 * Does deciding this page need `session.json` at all? Only when a candidate release is restricted:
 * on the public path (a public release, or an unknown version, or an unreadable registry) the
 * answer never depends on the session, so the boot chain must NOT await it (plan D2/D6: the
 * same-origin `session.json` 404s on GitHub Pages and is the one same-origin request we make —
 * waiting on it would put a same-origin round trip on every public first paint).
 */
export function requiresSession(
  rows: VersionRow[] | null | undefined,
  requested: string | null,
  latest: string | null,
): boolean {
  if (!Array.isArray(rows)) return false; // unreadable registry: latest.txt only, session irrelevant
  return accessOf(rows, requested) === "restricted" || accessOf(rows, latest) === "restricted";
}

export type DenialReason =
  /** restricted release, and this host has no preview session (the D6 gate proper). */
  | "restricted"
  /** no row in `versions.json` for this label — we cannot prove it is public, so we do not render it. */
  | "unknown-version"
  /** `versions.json` unreadable: only `latest.txt`'s version is allowed through. */
  | "registry-unreadable";

export interface AccessInput {
  /** the label asked for by the path or `?ver=`, already shape-validated, or null. */
  requested: string | null;
  /** `latest.txt`'s label, already shape-validated, or null if unreadable/malformed. */
  latest: string | null;
  /** parsed `versions.json` rows, or null when it could not be read or was not a list. */
  versions: VersionRow[] | null;
  /** the resolved session; null (or `{preview:false}`) is the public host. */
  session: SessionState | null;
}

export interface SessionState {
  preview: boolean;
}

export interface AccessDecision {
  /** the release to render, or null when nothing may be rendered. */
  ver: string | null;
  /** where `ver` came from — `latest` when the requested one was denied and we fell through. */
  source: "requested" | "latest" | null;
  /** the denied request, kept so the UI can say why (see "denial behaviour" below). */
  denied: { ver: string; reason: DenialReason } | null;
  /** whether the session consulted for this decision said preview (false when none was needed). */
  preview: boolean;
}

function check(
  ver: string | null,
  input: AccessInput,
): { ok: true } | { ok: false; reason: DenialReason } {
  if (!ver) return { ok: false, reason: "unknown-version" };

  // unreadable `versions.json`: we cannot prove anything about any label, so allow exactly one —
  // the one the registry's own pointer file named. A preview session does NOT widen this: the
  // registry is what says a release is restricted, and without it we would be guessing.
  if (!Array.isArray(input.versions)) {
    return ver === input.latest && input.latest !== null
      ? { ok: true }
      : { ok: false, reason: "registry-unreadable" };
  }

  const level = accessOf(input.versions, ver);
  if (level === "public") return { ok: true };
  if (level === "unknown") return { ok: false, reason: "unknown-version" };
  return input.session?.preview === true ? { ok: true } : { ok: false, reason: "restricted" };
}

/**
 * Decide which release (if any) this host may render.
 *
 * **Denial behaviour: fall through to `latest.txt`, with the denial recorded.** A denied version is
 * unusable *here* for the same structural reason a malformed `?ver=` is — this host cannot resolve
 * it into something renderable — so it takes the repo's existing "a malformed value is treated as
 * absent and falls through to the next tier, never surfaced as an error" rule rather than
 * introducing a second, different outcome for the same class of input. It also matches D6's scope:
 * the gate is a *presentation* gate ("public host renders public releases only"), so the correct
 * public-host response to `?ver=v9` is to show the public release it can show, not a dead page.
 * The fall-through is not a hole: the fallback goes through this same `check()` and, if it too is
 * denied (or `latest.txt` is unreadable), the answer is `ver: null` — render nothing, fail closed.
 * `denied` is carried on `window.__early` so atlas-3's UI can say "v9 is not available on this
 * host" instead of silently showing something else.
 */
export function decideAccess(input: AccessInput): AccessDecision {
  const candidate = input.requested ?? input.latest;
  const preview = input.session?.preview === true;

  if (!candidate) return { ver: null, source: null, denied: null, preview };

  const first = check(candidate, input);
  if (first.ok) {
    return {
      ver: candidate,
      source: input.requested ? "requested" : "latest",
      denied: null,
      preview,
    };
  }

  const denied = { ver: candidate, reason: first.reason };
  if (input.latest && input.latest !== candidate && check(input.latest, input).ok) {
    return { ver: input.latest, source: "latest", denied, preview };
  }
  return { ver: null, source: null, denied, preview };
}
