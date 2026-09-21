#!/usr/bin/env bash
# spikes/3 fix round 1 (task 2): mirrors duckdb-wasm's `parquet` extension for the two duckdb
# engine versions e2e/s3.ext.spec.ts tests, into spikes/3/tiles/ext/ (served by vite's
# publicDir at /ext/..., gitignored -- see spikes/3/.gitignore). Confirmed URL shape (by setting
# `custom_extension_repository` to a bogus local path and reading the resulting 404's URL):
#   {repository}/{duckdb_engine_version}/{platform}/{name}.duckdb_extension.wasm
# `duckdb_engine_version` is the underlying DuckDB C++ engine version baked into a given
# `@duckdb/duckdb-wasm` npm release, NOT the npm package version: 1.32.0 bundles duckdb v1.4.3;
# the `next` dist-tag (pinned here to 1.33.1-dev64.0) bundles duckdb v1.5.5. `platform` is
# whichever bundle `duckdb.selectBundle()` actually picks for the browser running the test --
# headless Chromium picked `wasm_eh` for both versions (verified against e2e/s3.ext.spec.ts's
# discovery tests); mvp is not mirrored here since nothing in this harness needs it.
#
# Run from the repo root: bash spikes/3/scripts/fetch_extensions.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."

fetch_one() {
  local engine_version="$1"
  local dir="spikes/3/tiles/ext/${engine_version}/wasm_eh"
  mkdir -p "$dir"
  curl -sS -o "${dir}/parquet.duckdb_extension.wasm" \
    "https://extensions.duckdb.org/${engine_version}/wasm_eh/parquet.duckdb_extension.wasm"
}

fetch_one "v1.4.3" # stable pin (@duckdb/duckdb-wasm 1.32.0)
fetch_one "v1.5.5" # next dist-tag (@duckdb/duckdb-wasm-next 1.33.1-dev64.0)

find spikes/3/tiles/ext -name '*.wasm' -exec ls -la {} \;
