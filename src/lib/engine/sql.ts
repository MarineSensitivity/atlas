// atlas-2 Step 3 (Sonnet half): SQL templating for `sql/*.sql`. Every value a template substitutes
// goes through `lit()` UNLESS its placeholder name is a member of the fixed `RAW_ALLOWLIST` below --
// the only escape hatch, and it exists to hold app-BUILT fragments (a `TableStore` ref, a column
// list already assembled from `ident()`-validated names), never a value that traces back to
// unescaped external/user input. `ident()` is the separate, strict-pattern path for anything that
// has to be a SQL identifier (a column/table name) rather than a literal value -- `manifest.id_field`
// is exactly this case (plan `engine/`: "the `cell_model` join by `manifest.id_field`"): it arrives
// as data at runtime and cannot be trusted without validation, but it also cannot be `lit()`'d (that
// would quote it as a string, not reference it as a column).
//
// The real SQL twins (`species_for_zone.sql`, `species_for_cells.sql`, `scores_for_cells.sql`,
// `cell_components.sql`, `composition.sql`) are the Opus half of this step; this module and
// `sql/smoke_count.sql` (a trivial, non-twin template) are all Sonnet ships here.

/** the value types `lit()` accepts directly; arrays of these render as a parenthesized list, e.g.
 * for `IN {{ids}}`. */
export type LiteralValue = string | number | boolean | null;

/**
 * Render `value` as a safe SQL literal. Strings are single-quoted with every embedded `'` doubled
 * (the standard SQL escape -- DuckDB, like every ANSI-ish engine, treats `''` inside a string
 * literal as one literal quote character, never a statement terminator), so an injection string
 * like `'; DROP TABLE t; --` round-trips as inert data, never as a second statement. Numbers must be
 * finite (`NaN`/`Infinity` have no SQL literal spelling and are almost always a bug upstream, not an
 * intentional value). An array renders as `(lit(v0), lit(v1), ...)`, ready to splice after `IN`.
 */
export function lit(value: LiteralValue | LiteralValue[]): string {
  if (Array.isArray(value)) return `(${value.map(litScalar).join(", ")})`;
  return litScalar(value);
}

function litScalar(value: LiteralValue): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`lit(): ${value} has no SQL literal spelling (must be a finite number)`);
    }
    return String(value);
  }
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw new Error(`lit(): unsupported value ${JSON.stringify(value)} (${typeof value})`);
}

/** a SQL identifier is `[A-Za-z_][A-Za-z0-9_]*` and nothing else -- deliberately stricter than what
 * DuckDB itself accepts unquoted, so this stays a pure allow-list with no escaping logic of its own
 * (an identifier that needs escaping is rejected outright, never "made safe"). */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate `name` as a SQL identifier and return it double-quoted (so a valid-but-reserved word,
 * e.g. a column literally named `group`, still parses). Throws on anything that doesn't match
 * {@link IDENTIFIER_RE} -- this is the ONLY sanctioned way a runtime-supplied name (e.g.
 * `manifest.id_field`) may reach a `FROM`/`JOIN`/column position; `lit()` must never be used there
 * (it would quote the name as a string value, not reference it as a column).
 */
export function ident(name: string): string {
  if (typeof name !== "string" || !IDENTIFIER_RE.test(name)) {
    throw new Error(`ident(): "${String(name)}" is not a valid SQL identifier`);
  }
  return `"${name}"`;
}

/**
 * The FIXED set of `{{name}}` keys a template may fill with a raw (unescaped) fragment instead of a
 * `lit()`-quoted value. This list is closed over at the module level on purpose -- a caller cannot
 * invent a new raw key at a call site, so the only strings that can ever bypass `lit()` are the ones
 * named here, and every one of them is meant to carry app-built SQL (already assembled from
 * `ident()`/`lit()`-safe pieces or a `TableStore` ref's `.from`), never a value read straight from
 * user input:
 * - `from` -- a FROM-clause source, normally a `TableStore` ref (`read_parquet('name')` or a bare
 *   opfs table identifier).
 * - `cols` -- a comma-joined column-reference list built from `ident()`-validated names.
 * - `predicate` -- a boolean SQL fragment assembled from already-safe pieces (e.g. an app-built
 *   `coalesce(in_usa, TRUE)` clause).
 */
export const RAW_ALLOWLIST: ReadonlySet<string> = new Set(["from", "cols", "predicate"]);

export interface RenderOptions {
  /** raw (unescaped) fragments, keyed by a name that MUST be in {@link RAW_ALLOWLIST}. */
  raw?: Record<string, string>;
}

const PLACEHOLDER_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

// CAVEAT for every `sql/*.sql` author (a real, hit-in-testing gotcha -- see
// tests/fixtures/engine-e2e/e2e/injection.spec.ts's first debugging round): this scanner is NOT
// SQL-comment-aware. It matches `{{...}}`-shaped text anywhere in the template string, including
// inside a `--` comment. Describing a placeholder in a template's own header comment, e.g. writing
// literally "the {{ids}} placeholder" as prose, IS a placeholder occurrence as far as `renderSql()`
// is concerned, and throws "unknown placeholder" unless that exact name also happens to be filled.
// Refer to placeholders in comments some other way (backticked without the braces, or spelled out).

/**
 * Render a `sql/*.sql` template: every `{{name}}` is replaced either from `raw[name]` (only when
 * `name` is in {@link RAW_ALLOWLIST}) or from `lit(values[name])`. Two error cases, kept distinct so
 * a caller can tell them apart:
 * - **unknown placeholder** -- `{{name}}` appears in the template but `name` is present in neither
 *   `values` nor an allow-listed `raw`.
 * - **unfilled placeholder** -- `name` IS a key of `values`, but its value is `undefined` (a caller
 *   built the params object but forgot to fill one in -- distinct from never having declared it).
 *
 * A `raw` key that is not in `RAW_ALLOWLIST` throws immediately, before the template is even
 * scanned, regardless of whether the template actually references it (defense in depth against a
 * stray extra key slipping in unused today and used unsafely tomorrow).
 */
export function renderSql(
  template: string,
  values: Record<string, LiteralValue | LiteralValue[] | undefined> = {},
  opts: RenderOptions = {},
): string {
  const raw = opts.raw ?? {};
  for (const key of Object.keys(raw)) {
    if (!RAW_ALLOWLIST.has(key)) {
      throw new Error(
        `renderSql(): raw key "${key}" is not in the fixed RAW allow-list (${[...RAW_ALLOWLIST].join(", ")})`,
      );
    }
  }

  return template.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(raw, name)) return raw[name];

    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`renderSql(): unknown placeholder {{${name}}}`);
    }
    const v = values[name];
    if (v === undefined) {
      throw new Error(`renderSql(): unfilled placeholder {{${name}}}`);
    }
    return lit(v);
  });
}
