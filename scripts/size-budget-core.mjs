// core budget logic, kept dependency-free and disk-free so it is unit-testable (tests/size-budget.test.ts)
// with a synthetic manifest and in-memory files, and reused as-is by the CLI wrapper (size-budget.mjs)
// against a real `vite build` (green) and the committed static-import fixture (red).
//
// plan atlas-0 Deliverable 4: fail when the critical path — everything index.html loads before first
// interaction — exceeds 350 KB gzip, OR when any chunk that is supposed to be lazy (duckdb*, terra-draw*,
// docx*, shp*, the treemap) appears in the entry's STATIC import graph. `dynamicImports` are deliberately
// never walked: that is exactly the escape hatch that keeps those libraries lazy.
import { gzipSync } from "node:zlib";

export const CRITICAL_BUDGET_BYTES = 350 * 1024; // 350 KB gzip (plan atlas-0 Deliverable 4)

// substrings, matched case-insensitively against the bundled text of every file reachable through
// static imports. Matching on content (not just on chunk file names) catches the case where Rollup
// inlines the forbidden module into the entry chunk instead of giving it its own file.
export const FORBIDDEN_LAZY_MARKERS = ["duckdb", "terra-draw", "docx", "shp", "treemap"];

/**
 * Walk a Vite manifest from `entryKey`, following only STATIC `imports` (never `dynamicImports`),
 * collecting every JS/CSS/asset file reachable that way.
 * @param {Record<string, any>} manifest
 * @param {string} entryKey
 */
export function collectStaticGraph(manifest, entryKey) {
  const visitedKeys = new Set();
  const files = new Set();
  const stack = [entryKey];

  while (stack.length) {
    const key = stack.pop();
    if (visitedKeys.has(key)) continue;
    visitedKeys.add(key);

    const rec = manifest[key];
    if (!rec) continue;

    if (rec.file) files.add(rec.file);
    for (const c of rec.css ?? []) files.add(c);
    for (const a of rec.assets ?? []) files.add(a);
    for (const imp of rec.imports ?? []) stack.push(imp); // static only — dynamicImports excluded on purpose
  }

  return { visitedKeys, files };
}

/** @param {Map<string, string>} fileContents relative path -> utf8 text */
export function findForbiddenMarkers(fileContents) {
  const hits = [];
  for (const [path, content] of fileContents) {
    const lower = content.toLowerCase();
    for (const marker of FORBIDDEN_LAZY_MARKERS) {
      if (lower.includes(marker)) hits.push({ path, marker });
    }
  }
  return hits;
}

export function gzipSize(buf) {
  return gzipSync(buf, { level: 9 }).length;
}

/**
 * @param {object} opts
 * @param {Record<string, any>} opts.manifest
 * @param {string} opts.entryKey
 * @param {(relPath: string) => Buffer} opts.readFile reads a dist-relative file as a Buffer
 * @param {number} [opts.budgetBytes]
 */
export function evaluateBudget({
  manifest,
  entryKey,
  readFile,
  budgetBytes = CRITICAL_BUDGET_BYTES,
}) {
  if (!manifest[entryKey]) {
    return {
      ok: false,
      totalGzipBytes: 0,
      files: [],
      reasons: [`no entry "${entryKey}" in manifest`],
    };
  }

  const { files } = collectStaticGraph(manifest, entryKey);
  const contents = new Map();
  let totalGzipBytes = 0;

  for (const f of files) {
    const buf = readFile(f);
    contents.set(f, buf.toString("utf8"));
    totalGzipBytes += gzipSize(buf);
  }

  const reasons = [];
  for (const hit of findForbiddenMarkers(contents)) {
    reasons.push(
      `forbidden lazy-chunk marker "${hit.marker}" found in a file reachable by STATIC import: "${hit.path}" — it must be dynamically imported instead`,
    );
  }
  if (totalGzipBytes > budgetBytes) {
    reasons.push(
      `critical-path gzip size ${totalGzipBytes} B exceeds the ${budgetBytes} B budget (${[...files].join(", ")})`,
    );
  }

  return { ok: reasons.length === 0, totalGzipBytes, files: [...files], reasons };
}
