#!/usr/bin/env node
// Usage: node scripts/check-duckdb-ext.mjs [distDir=dist] [manifestPath]
//
// atlas-2 Step 3a fix round 1: a build-time invariant, the same shape as check-dist-session.mjs --
// fails when dist/duckdb-ext/ is missing a pinned file, or a file's bytes/sha256 don't match
// scripts/duckdb-extensions.manifest.json. The mirror is a supply-chain input (extensions.duckdb.org,
// a third party) and its absence is a "fatal at startup, not a query error" failure in production
// (docs/spikes/S3.md/S4.md: an uncatchable-feeling WASM RuntimeError on the first read_parquet()) --
// this check exists so that failure is caught in CI, not by a user's first click.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertMirrorNotInStaticGraph,
  checkDuckdbExtMirror,
  loadManifest,
} from "./check-duckdb-ext-core.mjs";

const distDir = process.argv[2] ?? "dist";
const manifestPath = process.argv[3]; // undefined -> loadManifest()'s own default
const manifest = loadManifest(manifestPath);
const mirrorDir = join(distDir, "duckdb-ext");
const reasons = checkDuckdbExtMirror(mirrorDir, manifest);

// also confirm the mirror stayed OUT of the entry's static graph (docs/spikes note above) -- skipped
// gracefully if the vite manifest isn't there yet (this script is also usable pre-build, see fetch
// step in .github/workflows/pages.yml, though that path calls checkDuckdbExtMirror only).
const viteManifestPath = join(distDir, ".vite", "manifest.json");
if (existsSync(viteManifestPath)) {
  const viteManifest = JSON.parse(readFileSync(viteManifestPath, "utf8"));
  reasons.push(...assertMirrorNotInStaticGraph(viteManifest, "index.html"));
}

if (reasons.length) {
  process.stderr.write(
    `check-duckdb-ext: FAIL — "${mirrorDir}" does not match the pinned manifest (engine ` +
      `${manifest.engineVersion}). A published site with a missing or tampered extension mirror ` +
      `crashes the first read_parquet() with an uncatchable WASM error (docs/spikes/S3.md):\n`,
  );
  for (const r of reasons) process.stderr.write(`  ✗ ${r}\n`);
  process.exit(1);
}

process.stdout.write(
  `check-duckdb-ext: PASS — ${manifest.files.length} pinned file(s) verified under "${mirrorDir}" ` +
    `(engine ${manifest.engineVersion})\n`,
);
