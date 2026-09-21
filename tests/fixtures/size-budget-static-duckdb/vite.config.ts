import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// standalone config (this fixture is not part of the app's own build): `root` is set explicitly so
// `vite build --config tests/fixtures/size-budget-static-duckdb/vite.config.ts` works from the repo
// root without needing `cd`.
export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: "dist",
    manifest: true,
  },
});
