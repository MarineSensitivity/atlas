#!/usr/bin/env node
// CLI wrapper around size-budget-core.mjs. Usage:
//   node scripts/size-budget.mjs [--dist dist] [--entry index.html] [--budget-kb 350]
//
// Run against a real `vite build` output it should be green; run against the committed fixture
// (tests/fixtures/size-budget-static-duckdb/, built via `npm run build:fixture:size-budget`) it
// must be red — that fixture statically imports a stub module named like the real duckdb-wasm
// chunk, which is exactly what this check exists to catch (S1 has not pinned a duckdb-wasm version
// yet, so the real dependency is not in this repo).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateBudget, CRITICAL_BUDGET_BYTES } from "./size-budget-core.mjs";

function parseArgs(argv) {
  const args = { dist: "dist", entry: "index.html", budgetKb: CRITICAL_BUDGET_BYTES / 1024 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dist") args.dist = argv[++i];
    else if (a === "--entry") args.entry = argv[++i];
    else if (a === "--budget-kb") args.budgetKb = Number(argv[++i]);
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

function loadManifest(distDir) {
  // Vite 5+ writes build.manifest:true to <outDir>/.vite/manifest.json; older Vite wrote it at the
  // outDir root. Accept either so this survives a Vite bump without a config change.
  for (const rel of [".vite/manifest.json", "manifest.json"]) {
    const p = join(distDir, rel);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  return null;
}

const { dist, entry, budgetKb } = parseArgs(process.argv.slice(2));
const manifest = loadManifest(dist);

if (!manifest) {
  process.stderr.write(
    `size-budget: no manifest.json found under "${dist}" — did you run \`vite build\` (with build.manifest: true) first?\n`,
  );
  process.exit(1);
}

const result = evaluateBudget({
  manifest,
  entryKey: entry,
  readFile: (relPath) => readFileSync(join(dist, relPath)),
  budgetBytes: budgetKb * 1024,
});

const kb = (n) => (n / 1024).toFixed(1);
process.stdout.write(
  `size-budget: entry "${entry}" in "${dist}": ${result.files.length} static file(s), ${kb(result.totalGzipBytes)} KB gzip (budget ${kb(budgetKb * 1024)} KB)\n`,
);
for (const f of result.files) process.stdout.write(`  - ${f}\n`);

if (!result.ok) {
  process.stderr.write("size-budget: FAIL\n");
  for (const reason of result.reasons) process.stderr.write(`  ✗ ${reason}\n`);
  process.exit(1);
}

process.stdout.write("size-budget: PASS\n");
