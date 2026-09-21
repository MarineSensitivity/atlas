import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// atlas-0 S3 spike harness. Its own tiny vite project -- NOT the atlas app's vite.config.ts/
// package.json, which stay untouched (plan atlas-0, Step 4). `publicDir: "tiles"` serves the 4
// locally-built cell_metric tiles (scripts/make_tiles.sql, gitignored) at the same URL shape
// atlas-1 will publish them under: /app/cell/tile={t}/data_0.parquet. `optimizeDeps.exclude` for
// duckdb-wasm and no COOP/COEP headers mirror the real app's constraint (self-hosted worker,
// same-origin, no `coi` bundle -- GitHub Pages cannot send COOP/COEP) so the measured bytes match
// what atlas-1 will actually ship.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("./tiles", import.meta.url)),
  optimizeDeps: {
    exclude: ["@duckdb/duckdb-wasm"],
  },
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        display: fileURLToPath(new URL("./display.html", import.meta.url)),
      },
    },
  },
  preview: {
    port: 4313,
    strictPort: true,
  },
  server: {
    port: 4313,
    strictPort: true,
  },
});
