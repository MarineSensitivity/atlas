#!/usr/bin/env node
// atlas-0 S4 spike, fix round 2, item 1 — downloads a same-origin copy of the REAL
// spatial.duckdb_extension.wasm binaries (one per DuckDB core version that duckdb-wasm 1.32.0 /
// next actually request — discovered empirically via e2e/duckdb-network.spec.ts's unblocked
// run, not guessed) into fixtures/.ext-cache/, mirroring the exact relative path DuckDB itself
// requests (`v<core-version>/wasm_eh/spatial.duckdb_extension.wasm`) so `vite preview`'s publicDir
// can serve it back at that same relative path under a `custom_extension_repository` base URL.
//
// Never committed (fixtures/.ext-cache/ is gitignored — these are large, real, third-party
// binaries, not synthetic spike fixtures) — run this script again to repopulate the cache.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cacheRoot = join(here, "..", "fixtures", ".ext-cache");

// { duckdb-wasm npm version label -> DuckDB core version the extension repo path uses }
const TARGETS = {
  "1.32.0": "v1.4.3",
  next: "v1.5.5",
};

for (const [label, coreVersion] of Object.entries(TARGETS)) {
  const relPath = `${coreVersion}/wasm_eh/spatial.duckdb_extension.wasm`;
  const url = `https://extensions.duckdb.org/${relPath}`;
  const outPath = join(cacheRoot, relPath);
  mkdirSync(dirname(outPath), { recursive: true });

  process.stdout.write(`fetching ${url} (duckdb-wasm ${label}) ...\n`);
  const resp = await fetch(url);
  if (!resp.ok) {
    process.stderr.write(`  FAILED: ${resp.status} ${resp.statusText}\n`);
    process.exitCode = 1;
    continue;
  }
  const buf = new Uint8Array(await resp.arrayBuffer());
  writeFileSync(outPath, buf);
  process.stdout.write(`  wrote ${outPath} (${buf.byteLength} bytes)\n`);
}

if (!existsSync(cacheRoot)) {
  process.stderr.write(`nothing written to ${cacheRoot}\n`);
  process.exitCode = 1;
}
