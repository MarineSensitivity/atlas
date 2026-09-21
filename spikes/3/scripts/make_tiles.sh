#!/usr/bin/env bash
# spikes/3: wrapper for make_tiles.sql. Run from the repo root:
#   bash spikes/3/scripts/make_tiles.sh
# Requires the duckdb CLI (https://duckdb.org/docs/api/cli) on PATH. Reads v9/tables/cell_metric.parquet
# from the public release bucket (read-only, anonymous) and writes spikes/3/tiles/ locally
# (gitignored -- see spikes/3/.gitignore). Re-run any time to regenerate.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
rm -rf spikes/3/tiles/app
mkdir -p spikes/3/tiles/app/cell
duckdb < spikes/3/scripts/make_tiles.sql
find spikes/3/tiles -name '*.parquet' -exec ls -la {} \;
