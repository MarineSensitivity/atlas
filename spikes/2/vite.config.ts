import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// atlas-0 Step 4, S2 spike ("first paint without WASM"): its own tiny Vite project, built through
// the ROOT's pinned Vite 8 (this file is loaded by ../../node_modules/vite/bin/vite.js -- see
// package.json's scripts -- never a second copy of Vite installed here). base:"./" and
// appType:"mpa" mirror the root vite.config.ts for the same reasons (plan D2/D3: relative asset
// URLs, no SPA fallback masking a real 404 in dev/preview).
//
// optimizeDeps.exclude for maplibre-gl: this IS the S2 question -- does maplibre-gl 6.x's module
// worker break Vite 8's dependency optimizer the way 6.x broke Vite for CalCOFI Explorer
// (atlas-refs/"calcofi explore review.md" §5: "maplibre-gl 6's module worker broke Vite's
// optimizer", pinned <6 there; §11 lesson 10: pin the moment a version breaks the toolchain and say
// why). Excluding it here mirrors the workaround CalCOFI never had to use (they just pinned <6) so
// this harness can observe whether the exclude alone is enough for 6.10 under Vite 8, or whether
// the pin is still required either way. See RESULTS.md for what actually happened in `vite dev` and
// `vite build` + `vite preview` with maplibre-gl 6.10.0 vs ^5.24.0.
export default defineConfig({
  base: "./",
  appType: "mpa",
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  server: {
    port: 4312,
    strictPort: true,
  },
  preview: {
    port: 4312,
    strictPort: true,
  },
  build: {
    target: "es2022",
    manifest: true,
    // fix round 2: two entries -- index.html (the real harness) and fault-worker-url.html (the
    // committed seeded fault for the vector-feature assertion, built through a REAL vite build +
    // preview since the worker URL wiring it tests is a build-time resolution, not a runtime
    // ?seed= toggle). Both must go through an actual build for the fault to be provable the same
    // way the root's tests/fixtures/size-budget-static-duckdb/ fixture is.
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        "fault-worker-url": fileURLToPath(new URL("./fault-worker-url.html", import.meta.url)),
      },
    },
  },
});
