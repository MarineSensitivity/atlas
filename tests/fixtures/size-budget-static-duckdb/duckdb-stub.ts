// stub standing in for @duckdb/duckdb-wasm's real entry chunk (which is NOT a dependency of this
// repo yet — S1 has not pinned a version). Named and worded so scripts/size-budget.mjs's
// case-insensitive "duckdb" marker check finds it exactly as it would find the real package.
export const DUCKDB_WASM_STUB = "duckdb-wasm";
