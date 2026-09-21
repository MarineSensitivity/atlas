import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// atlas-3 step 2, Deliverable 3: gallery.html as its own, INDEPENDENT Rollup build. See
// vite.config.ts's header comment for why this cannot be a third entry in that config's
// rollupOptions.input: Rollup would share a chunk (the Svelte runtime) between index.html and
// gallery.html, growing index.html's static graph past its committed ~11.5 KB gzip baseline
// (docs/design/spec.md §12) even though nothing in index.html's own source changed.
//
// `npm run build` runs this AFTER the main config (see package.json), into the SAME dist/, with
// `emptyOutDir: false` so it never clobbers index.html's or report.html's output. Its own
// manifest file name keeps scripts/size-budget.mjs (which only ever reads dist/.vite/manifest.json
// for the "index.html" entry) from ever seeing gallery's graph.
export default defineConfig({
  base: "./",
  appType: "mpa",
  plugins: [svelte()],
  optimizeDeps: {
    exclude: ["@duckdb/duckdb-wasm"],
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    manifest: "gallery-manifest.json",
    rollupOptions: {
      input: {
        gallery: fileURLToPath(new URL("./gallery.html", import.meta.url)),
      },
    },
  },
});
