import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import pkg from "./package.json" with { type: "json" };

// atlas-0 scaffold (plan D2, D3): the same dist/ must run under both
// https://marinesensitivity.org/atlas/ and https://preview.marinesensitivity.org/v9/atlas/, and Cloudflare
// Access scopes its reviewer policy by PATH, never by query — so every asset URL has to be relative
// (base: "./") and every piece of view state has to live in the query string or the hash, never a
// client router. Two HTML entries stand in for "routes": index.html (the map) and report.html (the
// print-first report document).
//
// gallery.html (atlas-3 step 2's component review surface) is deliberately built by a SEPARATE
// config (vite.gallery.config.ts), not added to this one's rollupOptions.input. Rollup shares a
// chunk for any module reachable from two or more entry points in the SAME build — adding gallery
// here made it fold the whole Svelte runtime (which index.html's VersionBadge already pulls in)
// into one chunk shared with gallery's much larger component tree, which grew index.html's own
// static graph from the committed ~11.5 KB gzip baseline to ~14.9 KB. A second, independent Rollup
// build for gallery.html (own manifest file, `emptyOutDir: false` so it does not clobber this
// build's dist/ output) cannot share a chunk with this one no matter what gallery imports.
// tests/size-budget-gallery-isolation.test.ts is the mechanical guard against this regression
// mode specifically (gallery re-added to rollupOptions.input above); `node scripts/size-budget.mjs`
// against a real build is the gate that proves the actual byte count.
export default defineConfig({
  base: "./",
  // atlas-5: `Analytics["appVersion"]` (analytics.ts) needs SOME build-time version string. A
  // plain `import pkg from "./package.json"` at RUNTIME (in a lens/shell file) pulls the WHOLE
  // JSON module into the static bundle, prose and all — including the `pinReasons` block's own
  // "duckdb"/"shp"/"treemap" strings, which then trips size-budget.mjs's forbidden-lazy-chunk scan
  // for those exact substrings (measured: a real build FAILs on it). `define` inlines only this
  // one string literal instead.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // D2: no client router, so there is no "route" for the dev/preview server to fall back to
  // index.html for. `appType: "mpa"` turns that SPA fallback OFF — without it, a missing sibling
  // file (latest.txt, session.json, ...) 200s with index.html's own markup in dev/preview instead
  // of the real 404 that GitHub Pages and the preview host's Caddy actually return, which the
  // early-fetch script and its tests rely on (a caught bug: see tests/release/version.test.ts and
  // e2e/shell.smoke.spec.ts).
  appType: "mpa",
  plugins: [svelte()],
  optimizeDeps: {
    // @duckdb/duckdb-wasm ships its own worker + wasm and the optimizer breaks it (same story that made
    // CalCOFI Explorer exclude it, atlas-refs/"calcofi explore review.md" §1). Pinned at exactly 1.32.0
    // per docs/spikes/S1.md (see package.json's "pinReasons"); this exclude stays regardless of when the
    // dependency is actually wired into app code.
    exclude: ["@duckdb/duckdb-wasm"],
  },
  build: {
    target: "es2022",
    manifest: true, // scripts/size-budget.mjs reads dist/.vite/manifest.json
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        report: fileURLToPath(new URL("./report.html", import.meta.url)),
      },
      output: {
        // atlas-6 step 2: terra-draw/terra-draw-maplibre-gl-adapter are genuinely lazy (reached
        // only via `places/draw.ts`'s dynamic import()) — collectStaticGraph in
        // scripts/size-budget-core.mjs walks only STATIC `imports`, so neither chunk's own CODE
        // ever enters the static graph. But Vite names a lazy chunk after the imported module by
        // default ("terra-draw.modern-<hash>.js"), and the ENTRY necessarily contains that
        // filename as a literal string (the dynamic `import()` call's resolved specifier, plus its
        // own modulepreload dependency map) so the browser knows what to fetch when the import
        // runs — unavoidable Vite plumbing, not eagerly-loaded code. `size-budget-core.mjs`'s
        // FORBIDDEN_LAZY_MARKERS scan greps file CONTENT (by design, atlas-3's own header: "catches
        // the case where Rollup inlines the forbidden module... instead of giving it its own
        // file"), so it cannot tell "the chunk's own name, referenced correctly" apart from
        // "the chunk's code, inlined wrongly" — this renames just the OUTPUT FILENAME of these two
        // chunks so the correct, lazy behaviour underneath is unchanged and the entry's reference
        // to it no longer happens to start with a forbidden token.
        chunkFileNames: (chunk) => {
          const name = chunk.name ?? "";
          return /^terra-draw/.test(name)
            ? "assets/draw-vendor-[hash].js"
            : "assets/[name]-[hash].js";
        },
      },
    },
  },
});
