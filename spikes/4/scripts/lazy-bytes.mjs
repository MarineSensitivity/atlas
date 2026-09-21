#!/usr/bin/env node
// atlas-0 S4 spike — reads spikes/4's OWN `vite build` manifest (dist/.vite/manifest.json) and
// reports, for each of the harness's named lazy entry points (the dynamic imports in src/main.ts
// — one per candidate parser / duckdb-wasm version), the gzip bytes of everything reachable
// through ITS OWN static import graph. This is the "bytes added per parser when lazy-loaded"
// number in RESULTS.md.
//
// Caveat recorded here, not hidden: a small shared helper chunk (normalize.ts, used by
// parse-shp/kml/fgb/wkt) can be reachable from more than one of these roots, so it may be counted
// once per parser below rather than de-duplicated across parsers. The real marginal cost of
// loading a 2nd or 3rd parser after the first is therefore slightly less than the sum of these
// numbers. Never walks `dynamicImports` (same rule as the root's size-budget-core.mjs) — only the
// entry's OWN lazy root is walked, on purpose, so this never double-counts a sibling parser.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = process.argv[2] ?? "dist";
const manifestPath = existsSync(join(dist, ".vite/manifest.json"))
  ? join(dist, ".vite/manifest.json")
  : join(dist, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error(`lazy-bytes: no manifest at ${manifestPath} — run \`npm run build\` first`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const ENTRY_KEY = "index.html";

const LAZY_ROOTS = {
  "shpjs (parse-shp.ts)": "src/parse-shp.ts",
  "@tmcw/togeojson (parse-kml.ts)": "src/parse-kml.ts",
  "flatgeobuf (parse-fgb.ts)": "src/parse-fgb.ts",
  "hand-rolled WKT (parse-wkt.ts, not an npm dep)": "src/parse-wkt.ts",
  "@duckdb/duckdb-wasm 1.32.0 (duckdb-1-32-0.ts)": "src/duckdb-1-32-0.ts",
  "@duckdb/duckdb-wasm next (duckdb-next.ts)": "src/duckdb-next.ts",
};

function gzipSize(buf) {
  return gzipSync(buf, { level: 9 }).length;
}

// walks static `imports`/`css` (JS/CSS chunks) separately from `assets` (the `?url`-imported
// wasm/worker files) so RESULTS.md can report "JS you'd actually parse/execute" apart from "the
// multi-megabyte wasm binary that comes along for the ride" — both are real bytes-added, but they
// are different in kind and conflating them into one number hides the more interesting JS number.
function collectStaticGraph(rootKey) {
  const jsFiles = new Set();
  const assetFiles = new Set();
  const visited = new Set();
  const stack = [rootKey];
  while (stack.length) {
    const key = stack.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    const rec = manifest[key];
    if (!rec) continue;
    if (rec.file) jsFiles.add(rec.file);
    for (const c of rec.css ?? []) jsFiles.add(c);
    for (const a of rec.assets ?? []) assetFiles.add(a); // ?url assets: wasm binaries, worker.js
    for (const imp of rec.imports ?? []) stack.push(imp); // static only, never dynamicImports
  }
  return { jsFiles, assetFiles };
}

function sumGzip(files, lines) {
  let total = 0;
  for (const f of files) {
    const p = join(dist, f);
    if (!existsSync(p)) {
      lines.push(`    - ${f}: MISSING on disk`);
      continue;
    }
    const buf = readFileSync(p);
    const gz = gzipSize(buf);
    total += gz;
    lines.push(`    - ${f}: ${buf.length} B raw, ${gz} B gzip`);
  }
  return total;
}

const entryRec = manifest[ENTRY_KEY];
if (!entryRec) {
  console.error(`lazy-bytes: no "${ENTRY_KEY}" in manifest`);
  process.exit(1);
}
console.log(`entry "${ENTRY_KEY}" dynamicImports: ${JSON.stringify(entryRec.dynamicImports ?? [])}`);
console.log("");

for (const [label, key] of Object.entries(LAZY_ROOTS)) {
  if (!manifest[key]) {
    console.log(`${label}: NOT FOUND in manifest (key "${key}")`);
    continue;
  }
  const { jsFiles, assetFiles } = collectStaticGraph(key);
  const lines = [];
  const jsTotal = sumGzip(jsFiles, lines);
  const assetTotal = sumGzip(assetFiles, lines);
  console.log(
    `${label}: ${jsTotal} B gzip JS (${jsFiles.size} file(s)) + ${assetTotal} B gzip wasm/worker assets (${assetFiles.size} file(s)) = ${jsTotal + assetTotal} B gzip total`,
  );
  for (const l of lines) console.log(l);
  console.log("");
}
