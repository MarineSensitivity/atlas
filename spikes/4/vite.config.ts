import { defineConfig } from "vite";

// atlas-0 S4 spike harness — its own tiny Vite 8 build, isolated from the root app's
// vite.config.ts (root config is untouched). `fixtures/` is the publicDir so every generated
// fixture file is served (and copied into `dist/` on `npm run build`) at the site root — e.g.
// `/gulf_rectangle.zip` — which is all this harness ever fetches. This page is never deployed, so
// the root app's `base: "./"` / relative-asset rule does not apply here.
export default defineConfig({
  publicDir: "fixtures",
  build: {
    target: "es2022",
    manifest: true, // read by scripts/lazy-bytes.mjs to measure bytes added per lazy-loaded parser
  },
  optimizeDeps: {
    // same reason the root config excludes @duckdb/duckdb-wasm (atlas-0 Settled, S1): the package
    // ships its own worker + wasm and Vite's dep optimizer breaks it.
    exclude: ["@duckdb/duckdb-wasm-1-32-0", "@duckdb/duckdb-wasm-next"],
  },
});
