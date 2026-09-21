// `{ver}/app/boot.json` (plan D3, atlas-1's contract): grid spec, palettes, drawable units, table
// digests — everything `grid/`, `raster/ramps.ts` and the OPFS store (later steps) read instead of a
// hardcoded constant. atlas-1 has not shipped the schema yet, so — exactly like manifest.ts — this
// validates through an INJECTABLE validator with only a minimal structural check for now.
//
// TODO(atlas-1): once msens publishes `boot.json`'s JSON Schema, copy it into this repo (e.g.
// `tests/schemas/boot.schema.json`) and add a drift guard comparing its sha256 against msens `main`,
// the same shape as `tests/pins.test.ts`'s verdict-drift guard. See the skipped test in
// tests/release/boot.test.ts naming this file and atlas-1 — remove the skip once the schema lands.
import { dataUrl } from "./dataBase";
import type { SessionLike } from "./dataBase";

/** schema TBD (atlas-1): known shape includes `grid`, `units`, `palettes`, `tables[*].digest`, but
 * nothing here should assume a key exists until the real schema lands. */
export interface Boot {
  [key: string]: unknown;
}

export type BootValidator = (raw: unknown) => Boot | null;

/** minimal structural check: `raw` must be a plain (non-array, non-null) object. Nothing more can be
 * asserted without the real schema (see the module header's TODO). */
export function minimalBootCheck(raw: unknown): Boot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Boot;
}

export interface EarlyBootLike {
  boot?: unknown; // a Promise<unknown> in the real app
}

/**
 * Resolve `ver`'s boot bundle. Same fetch-preference rule as {@link manifest}: prefer
 * `early.boot` when given, else fetch `app/boot.json` fresh via `fetchJson`. `app/boot.json` does
 * not exist for any release yet (atlas-1 is still in flight) — a 404 or a validator rejection both
 * resolve to `null`, never a throw (see index.html's inline early-fetch script, which already treats
 * a missing `app/boot.json` as a quiet null).
 */
export async function boot(
  ver: string | null,
  opts: {
    early?: EarlyBootLike | null;
    session?: SessionLike | null;
    fetchJson?: (url: string) => Promise<unknown>;
    validate?: BootValidator;
  } = {},
): Promise<Boot | null> {
  const validate = opts.validate ?? minimalBootCheck;
  let raw: unknown;
  if (opts.early && "boot" in opts.early) {
    raw = await Promise.resolve(opts.early.boot).catch(() => null);
  } else if (ver && opts.fetchJson) {
    raw = await opts.fetchJson(dataUrl(ver, "app/boot.json", opts.session)).catch(() => null);
  } else {
    return null;
  }
  return validate(raw);
}
