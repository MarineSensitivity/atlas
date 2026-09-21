// stub standing in for @duckdb/duckdb-wasm's real entry chunk. @duckdb/duckdb-wasm IS a real
// dependency now (pinned exactly 1.32.0 per docs/spikes/S1.md), but it must never be statically
// imported — this fixture is the permanent regression case for that rule, independent of whether the
// dependency happens to be installed. Named and worded so scripts/size-budget.mjs's case-insensitive
// "duckdb" marker check finds it exactly as it would find the real package.
export const DUCKDB_WASM_STUB = "duckdb-wasm";
