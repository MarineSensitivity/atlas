import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// standalone config (this fixture is not part of the app's own build, and is NEVER reachable from
// index.html/report.html's static graph): `root` is set explicitly so
// `vite build --config e2e/fixtures/analytics-privacy/vite.config.ts` works from the repo root
// without needing `cd` — same pattern as tests/fixtures/size-budget-worker/vite.config.ts. Its one
// job is to give e2e/analytics-privacy.spec.ts a real page that imports the real
// src/lib/analytics/analytics.ts under a real DOM, so that module's guarded browser defaults
// (real `location`, real `sendBeacon`) get exercised for once outside a unit test's injected fakes.
export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: "dist",
    manifest: true,
  },
});
