// atlas-2 Step 3 (Sonnet half): builds `sql/smoke_count.sql` -- see that file's header for what it
// is and is not.
import smokeCountTemplate from "../../../sql/smoke_count.sql?raw";
import { renderSql, type LiteralValue } from "./sql";

/**
 * @param from a `TableStore` ref's `.from` (or any other already-safe FROM-clause fragment) --
 * inserted raw via the fixed `RAW_ALLOWLIST` "from" slot, never `lit()`-quoted.
 * @param probe an ordinary value, round-tripped through `lit()` as the `probe` column -- pass an
 * injection string here to prove it comes back as data (see `tests/fixtures/engine-e2e`).
 */
export function smokeCountSql(from: string, probe: LiteralValue): string {
  return renderSql(smokeCountTemplate, { probe }, { raw: { from } });
}
