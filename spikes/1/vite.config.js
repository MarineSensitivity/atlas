import { defineConfig } from "vite";

// atlas-0 Step 4, S1 harness: this machine runs several agents in parallel, so every server this
// harness starts uses port 4311 with strictPort (assigned port for this task). Self-hosted
// duckdb-wasm bundles need `optimizeDeps.exclude` for the same reason the root vite.config.ts
// excludes @duckdb/duckdb-wasm -- the dep optimizer breaks a package that ships its own worker+wasm
// (atlas-refs/"calcofi explore review.md" S1).
export default defineConfig({
  server: { port: 4311, strictPort: true },
  preview: { port: 4311, strictPort: true },
  optimizeDeps: {
    exclude: ["duckdb-wasm-132", "duckdb-wasm-latest-dev57", "duckdb-wasm-next-dev64"],
  },
});
