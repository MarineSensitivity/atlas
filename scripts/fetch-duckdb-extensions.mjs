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
// atlas-2 Step 3a fix round 1: this is a supply-chain input (a third-party download, not something
// built from source in this repo), so every fetched file is verified against the pinned byte size
// and sha256 in `duckdb-extensions.manifest.json` (the single source of truth for engine version,
// platforms and extension names too -- nothing here is hard-coded a second time). A mismatch or a
// download failure is a hard FAIL, not a warning: a silently-wrong mirror is worse than none, because
// `scripts/check-duckdb-ext.mjs`'s later build-time check would be comparing dist/ against a
// manifest that no longer describes what's actually on disk.
//
// Usage: node scripts/fetch-duckdb-extensions.mjs [outDir=public/duckdb-ext]
// Writes into a path under `public/` so Vite's publicDir copies it into `dist/` on `npm run build`
// (the documented build step, wired into `.github/workflows/pages.yml`'s `checks` job before
// `vite build`). The output directory is gitignored (dev-only artifact, re-fetched, not committed).
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadManifest, manifestEntryRelPath } from "./check-duckdb-ext-core.mjs";

const REPOSITORY = "https://extensions.duckdb.org";
const manifest = loadManifest();
const outDir = process.argv[2] ?? path.join("public", "duckdb-ext");

async function fetchOne(file) {
  const rel = manifestEntryRelPath(manifest, file);
  const url = `${REPOSITORY}/${manifest.engineVersion}/${file.platform}/${file.name}.duckdb_extension.wasm`;
  const dest = path.join(outDir, rel);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());

  if (buf.byteLength !== file.bytes) {
    throw new Error(
      `size mismatch for ${url}: manifest pins ${file.bytes} B, downloaded ${buf.byteLength} B -- ` +
        `refusing to write it (extensions.duckdb.org served something other than what was pinned; ` +
        `re-verify and update duckdb-extensions.manifest.json deliberately if this is expected)`,
    );
  }
  const sha256 = createHash("sha256").update(buf).digest("hex");
  if (sha256 !== file.sha256) {
    throw new Error(
      `sha256 mismatch for ${url}: manifest pins ${file.sha256}, downloaded ${sha256} -- refusing to ` +
        `write it`,
    );
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return { url, dest, bytes: buf.byteLength };
}

let failed = false;
for (const file of manifest.files) {
  try {
    const { url, dest, bytes } = await fetchOne(file);
    process.stdout.write(
      `fetch-duckdb-extensions: ${url} -> ${dest} (${bytes} B, sha256 verified)\n`,
    );
  } catch (err) {
    failed = true;
    process.stderr.write(`fetch-duckdb-extensions: FAILED ${file.platform}/${file.name}: ${err}\n`);
  }
}

if (failed) {
  process.stderr.write(
    "fetch-duckdb-extensions: one or more extension files failed to download or verify -- the app " +
      "will fall back to extensions.duckdb.org at runtime for the missing file(s), which crashes if " +
      "that host is unreachable (docs/spikes/S3.md).\n",
  );
  process.exit(1);
}
