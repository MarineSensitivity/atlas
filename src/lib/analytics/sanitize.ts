// Defense-in-depth against place geometry / report titles reaching analytics via EVENT PARAMS, not
// just via page_location (pageLocation.ts guards the URL side). `place_draw`/`place_upload`/
// `place_share`/`report_open` (events.ts) have no documented param shape, so their TypeScript type
// is an open `Record<string, unknown>` bag — a caller could pass the whole `Sel`-shaped object by
// mistake, `pl`/`t` and all. This strips those two keys unconditionally, for every event, before a
// payload is built (analytics.ts calls this first in `track()`).
const FORBIDDEN_PARAM_KEYS: ReadonlySet<string> = new Set(["pl", "t"]);

export function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (FORBIDDEN_PARAM_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
