// atlas-2 Step 3a fix round 1: the DuckDB-WASM extension mirror (scripts/fetch-duckdb-extensions.mjs,
// docs/engine.md) is a supply-chain input -- fetched from extensions.duckdb.org, a third party -- so
// it is pinned by exact byte size and sha256 in scripts/duckdb-extensions.manifest.json, and every
// mirrored file is re-verified against that pin twice: once right after download (the fetch script
// itself) and once more here, against whatever actually ended up in a real dist/ (the same pattern as
// check-dist-session-core.mjs / check-relative-assets-core.mjs -- core logic separated from the CLI
// wrapper so it's directly unit-testable against a real temp directory, no disk-I/O mocking).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectStaticGraph } from "./size-budget-core.mjs";

export const DEFAULT_MANIFEST_PATH = fileURLToPath(
  new URL("./duckdb-extensions.manifest.json", import.meta.url),
);

/** @param {string} [manifestPath] */
export function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  if (!manifest.engineVersion || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(
      `invalid duckdb extensions manifest at "${manifestPath}": missing engineVersion/files`,
    );
  }
  return manifest;
}

/** the path a manifest entry names, relative to the directory that directly holds
 * `{engineVersion}/...` (i.e. `public/duckdb-ext` in dev, `dist/duckdb-ext` after a build). */
export function manifestEntryRelPath(manifest, file) {
  return join(manifest.engineVersion, file.platform, `${file.name}.duckdb_extension.wasm`);
}

/**
 * Verify every file `manifest` pins actually exists under `mirrorDir` with the exact pinned byte
 * size AND sha256. Returns an array of human-readable reasons (empty = every file verified clean).
 * Never throws on a missing/mismatched file -- that is exactly the condition this function reports,
 * not an exceptional one; it DOES propagate a genuine I/O error (e.g. a permissions problem) as a
 * thrown exception, since that is not a "the mirror is wrong" finding.
 * @param {string} mirrorDir
 * @param {ReturnType<typeof loadManifest>} manifest
 */
export function checkDuckdbExtMirror(mirrorDir, manifest) {
  const reasons = [];
  for (const file of manifest.files) {
    const rel = manifestEntryRelPath(manifest, file);
    const abs = join(mirrorDir, rel);
    if (!existsSync(abs)) {
      reasons.push(`missing: "${rel}" (expected under "${mirrorDir}")`);
      continue;
    }
    const buf = readFileSync(abs);
    if (buf.byteLength !== file.bytes) {
      reasons.push(`size mismatch: "${rel}" expected ${file.bytes} B, found ${buf.byteLength} B`);
      continue; // a size mismatch already implies a hash mismatch -- one reason, not two
    }
    const sha256 = createHash("sha256").update(buf).digest("hex");
    if (sha256 !== file.sha256) {
      reasons.push(`sha256 mismatch: "${rel}" expected ${file.sha256}, found ${sha256}`);
    }
  }
  return reasons;
}

/**
 * Confirm the mirror is NEVER reachable from an entry's STATIC import graph -- it must only ever be
 * a runtime, on-demand fetch driven by `SET custom_extension_repository` (`src/lib/engine/engine.ts`),
 * never something `index.html`'s own bundle pulls in (that would both blow the size budget and put
 * `@duckdb/duckdb-wasm` back in the entry graph the forbidden-marker scan already guards). Reuses
 * `size-budget-core.mjs`'s own static-graph walk (never `dynamicImports`) so this is exactly the same
 * notion of "static" the size budget itself enforces, not a second, drifting definition.
 * @param {Record<string, any>} viteManifest dist/.vite/manifest.json, parsed
 * @param {string} [entryKey]
 */
export function assertMirrorNotInStaticGraph(viteManifest, entryKey = "index.html") {
  const { files } = collectStaticGraph(viteManifest, entryKey);
  const hits = [...files].filter((f) => f.startsWith("duckdb-ext/") || f.includes("/duckdb-ext/"));
  return hits.map(
    (f) => `duckdb-ext file reachable from the STATIC import graph: "${f}" (must be runtime-only)`,
  );
}
