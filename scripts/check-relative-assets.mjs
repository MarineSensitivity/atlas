#!/usr/bin/env node
// Usage: node scripts/check-relative-assets.mjs [distDir=dist]
import { findAbsoluteAssetUrls } from "./check-relative-assets-core.mjs";

const distDir = process.argv[2] ?? "dist";
const hits = findAbsoluteAssetUrls(distDir);

if (hits.length) {
  process.stderr.write(
    `check-relative-assets: FAIL — absolute /assets/ URL(s) found under "${distDir}" (breaks the same ` +
      `dist/ serving from both /atlas/ and /v9/atlas/, plan D2):\n`,
  );
  for (const h of hits) process.stderr.write(`  ✗ ${h.path}: ${h.match}\n`);
  process.exit(1);
}

process.stdout.write(`check-relative-assets: PASS — no absolute /assets/ URL under "${distDir}"\n`);
