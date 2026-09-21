// Port of `msens::ms_event()` (analytics.R:75-131) — the pure payload constructor: normalizes the
// event name to GA4's rules, drops empty/absent params, and hoists the four reserved metric columns
// (`n_rows`, `ms`, `status`, `error`) out of the free-text `params` bag so the Sheet log keeps them
// numeric/filterable instead of buried in a JSON blob.
export const GA_MAX_EVENT_CHARS = 40;
export const GA_MAX_PARAM_CHARS = 100;

/** the usage-log Sheet's exact header row (`msens::ms_log_header()`, analytics.R:66-69) — kept here,
 * not duplicated, so the row this module builds and the Apps Script that appends it cannot drift. */
export const LOG_HEADER = [
  "timestamp",
  "ip",
  "session",
  "event",
  "params",
  "n_rows",
  "ms",
  "status",
  "error",
  "app_version",
  "app",
  "client_id",
  "session_id",
  "page",
  "referrer",
  "user_agent",
] as const;

const RESERVED_METRIC_KEYS = new Set(["n_rows", "ms", "status", "error"]);

export interface EventPayload {
  event: string;
  /** free-text params, already stringified for the Sheet log; GA4 truncates these further to
   * GA_MAX_PARAM_CHARS at the transport boundary (analytics.ts), not here — this module always
   * carries the full value. */
  params: Record<string, string>;
  metrics: { n_rows?: number; ms?: number; status?: string; error?: string };
}

/** GA4: lowercase, non-alphanumerics -> "_", must start with a letter, <= 40 chars
 * (ms_event(), analytics.R:98-103). */
function normalizeEventName(name: string): string {
  let nm = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  nm = nm.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(nm)) nm = "e_" + nm;
  return nm.slice(0, GA_MAX_EVENT_CHARS);
}

// drop NULL/NA/"" so absent facts don't clutter the Sheet's params column (ms_event(), analytics.R:
// 109-114) — R's `is.na(NaN)` is also TRUE, so a NaN metric is dropped the same way a real NA is.
function isDroppable(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number" && Number.isNaN(v)) return true;
  if (Array.isArray(v)) {
    if (v.length === 0) return true;
    return v.every(
      (x) =>
        x === null || x === undefined || x === "" || (typeof x === "number" && Number.isNaN(x)),
    );
  }
  return v === "";
}

// a multi-value parameter collapses to one readable cell rather than a nested JSON array
// (ms_event(), analytics.R:127-129).
function stringifyValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  return String(v);
}

export function msEvent(event: string, raw: Record<string, unknown> = {}): EventPayload {
  const name = normalizeEventName(event);

  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!isDroppable(v)) kept[k] = v;
  }

  const metrics: EventPayload["metrics"] = {};
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(kept)) {
    if (!RESERVED_METRIC_KEYS.has(k)) {
      params[k] = stringifyValue(v);
      continue;
    }
    // n_rows/ms stay NUMERIC (analytics.R:117-123: "Apps Script setValues() writes a JS string as
    // text, which would make the column unchartable"); status/error stay strings.
    if (k === "n_rows") metrics.n_rows = Math.trunc(Number(v));
    else if (k === "ms") metrics.ms = Math.round(Number(v) * 10) / 10;
    else if (k === "status") metrics.status = String(v);
    else if (k === "error") metrics.error = String(v);
  }

  return { event: name, params, metrics };
}
