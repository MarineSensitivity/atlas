#!/usr/bin/env node
// atlas-2 Step 3 (Sonnet half): mirrors DuckDB-WASM's `parquet` extension same-origin, for BOTH
// platforms (`wasm_mvp` and `wasm_eh` -- `selectBundle()` picks per browser, and only `wasm_eh` was
// ever observed in spikes/1 and spikes/3's headless Chromium; docs/spikes/S3.md Consequence #3 says
// to mirror both). Keyed by the DuckDB **engine** version baked into the pinned `1.32.0` npm release
// (`src/lib/engine/bundles.ts`'s `DUCKDB_ENGINE_VERSION`), not the npm version -- confirmed URL
// shape (docs/spikes/S3.md, S4.md):
//   {repository}/{duckdb_engine_version}/{platform}/{name}.duckdb_extension.wasm
//
// `spatial` is DELIBERATELY not mirrored here (docs/spikes/S4.md "Where DuckDB extensions are
// hosted": ~22.4 MB per platform per engine version, needed only by the rare `.gpkg` upload, fetched
// on demand from extensions.duckdb.org behind user consent instead). `json` is skipped too -- nothing
// in the app loads it yet (same doc: "json only if something actually loads it").
//
// Usage: node scripts/fetch-duckdb-extensions.mjs [outDir=public/duckdb-ext]
// Writes into a path under `public/` so Vite's publicDir copies it into `dist/` on `npm run build`
// (the "documented build step": CI/a real deploy must run this BEFORE `vite build`, or the shipped
// app has no same-origin mirror and falls back to extensions.duckdb.org -- see docs/engine.md). The
// output directory is gitignored (dev-only artifact, re-fetched, not committed).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ENGINE_VERSION = "v1.4.3"; // @duckdb/duckdb-wasm 1.32.0 -- must match src/lib/engine/bundles.ts
const PLATFORMS = ["wasm_mvp", "wasm_eh"];
const EXTENSIONS = ["parquet"];
const REPOSITORY = "https://extensions.duckdb.org";

const outDir = process.argv[2] ?? path.join("public", "duckdb-ext");

async function fetchOne(platform, name) {
  const url = `${REPOSITORY}/${ENGINE_VERSION}/${platform}/${name}.duckdb_extension.wasm`;
  const dir = path.join(outDir, ENGINE_VERSION, platform);
  const dest = path.join(dir, `${name}.duckdb_extension.wasm`);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());

  await mkdir(dir, { recursive: true });
  await writeFile(dest, buf);
  return { url, dest, bytes: buf.byteLength };
}

let failed = false;
for (const platform of PLATFORMS) {
  for (const name of EXTENSIONS) {
    try {
      const { url, dest, bytes } = await fetchOne(platform, name);
      process.stdout.write(`fetch-duckdb-extensions: ${url} -> ${dest} (${bytes} B)\n`);
    } catch (err) {
      failed = true;
      process.stderr.write(`fetch-duckdb-extensions: FAILED ${platform}/${name}: ${err}\n`);
    }
  }
}

if (failed) {
  process.stderr.write(
    "fetch-duckdb-extensions: one or more extension files failed to download -- the app will fall " +
      "back to extensions.duckdb.org at runtime for the missing file(s), which crashes if that host " +
      "is unreachable (docs/spikes/S3.md).\n",
  );
  process.exit(1);
}
