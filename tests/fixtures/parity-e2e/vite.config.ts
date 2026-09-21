import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// atlas-2 Step 3b: the browser half of the parity gate. `scripts/parity/run.mjs` runs the
// `sql/*.sql` twins under the DuckDB CLI over local Parquet; this fixture runs ONE of each through
// the REAL DuckDB-WASM engine -- the `Engine` promise chain, `registerFileBuffer` materialization,
// the same-origin extension mirror -- with `extensions.duckdb.org` blocked. Between them nothing
// about the twins is left to an "it should also work in the browser".
//
// Its data comes from `scripts/parity/serve.mjs` on port 4441 (the release bucket's own layout),
// which is a genuinely cross-origin fetch from this page on 4442, exactly as production is.
export default defineConfig({
  root,
  base: "/",
  publicDir: fileURLToPath(new URL("../../../public", import.meta.url)),
  optimizeDeps: {
    // @duckdb/duckdb-wasm ships its own worker+wasm and the dep optimizer breaks it
    // (atlas-refs/"calcofi explore review.md" §1) -- same reason as the root vite.config.ts.
    exclude: ["@duckdb/duckdb-wasm"],
  },
  build: { target: "es2022" },
  server: { port: 4442, strictPort: true },
  preview: { port: 4442, strictPort: true },
});
