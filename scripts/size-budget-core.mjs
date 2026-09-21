// core budget logic, kept dependency-free and disk-free so it is unit-testable (tests/size-budget.test.ts)
// with a synthetic manifest and in-memory files, and reused as-is by the CLI wrapper (size-budget.mjs)
// against a real `vite build` (green) and the committed red fixtures (red).
//
// plan atlas-0 Deliverable 4: fail when the critical path — everything index.html loads before first
// interaction — exceeds 350 KB gzip, OR when any chunk that is supposed to be lazy (duckdb*, terra-draw*,
// docx*, shp*, the treemap) appears in the entry's STATIC import graph. `dynamicImports` are deliberately
// never walked: that is exactly the escape hatch that keeps those libraries lazy.
//
// atlas-0 review fix round 1, F3: a runtime worker (maplibre-gl's, wired per S2.md's `?worker&url` +
// setWorkerUrl) downloads at `new Map()` construction — before first interaction, same as anything else
// on the critical path — but it is not a static `import` and is not reliably present in the manifest's
// `assets` array either (that depends on chunk-splitting specifics this repo does not control). So the
// worker is found the same way `findForbiddenMarkers` finds a forbidden library: by reading the compiled
// bytes of every file already known to be on the static path, not by trusting manifest bookkeeping. It
// gets counted, but in its OWN budget (`RUNTIME_WORKER_BUDGET_BYTES`), not folded into the 350 KB static
// number — see `evaluateBudget`.
import { gzipSync } from "node:zlib";
import { posix } from "node:path";

export const CRITICAL_BUDGET_BYTES = 350 * 1024; // 350 KB gzip (plan atlas-0 Deliverable 4)
export const RUNTIME_WORKER_BUDGET_BYTES = 150 * 1024; // 150 KB gzip (F3) — a separate budget for every
// runtime worker referenced from the static graph (measured: maplibre-gl's own worker is 143.9 KB gzip,
// S2.md Consequences #10); pending the project owner's confirmation of the exact numbers.

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

// the compiled form of a Vite/Rolldown `?worker&url` import (also what a hand-written
// `new Worker(new URL("./w.ts", import.meta.url))` compiles to): `new URL("<file>.js", import.meta.url)`
// with the file name as a sibling of the referencing chunk. Confirmed against a real
// `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` build (backticked in Rolldown's output, e.g.
// `` new URL(`maplibre-gl-worker-CNLXcz58.js`,import.meta.url) ``) and against
// tests/fixtures/size-budget-worker/. Requiring the `.js`/`.mjs` extension keeps this from matching an
// unrelated `new URL(...)` (a sourcemap comment, a non-JS asset URL, ...).
export const WORKER_URL_REF =
  /new\s+URL\(\s*[`'"]([^`'"()]+\.m?js)[`'"]\s*,\s*import\.meta\.url\s*\)/g;

/**
 * Find every worker JS asset referenced — directly, or transitively (a worker referencing a worker of
 * its own) — from `fileContents`' text, resolved dist-relative to the file that references it and
 * CONFIRMED to exist by actually reading it with `readFile`; a reference `readFile` cannot satisfy is a
 * dead/foreign URL, not a worker asset, and is silently skipped. This does NOT consult the manifest's
 * `assets`/`imports` fields at all — see the file header (F3) for why.
 * @param {Map<string, string>} fileContents relPath -> utf8 text; the seed set to scan (typically the
 *   static-critical-path files already collected by `collectStaticGraph`)
 * @param {(relPath: string) => Buffer} readFile reads a dist-relative file as a Buffer; may throw or
 *   return a falsy value for a path that does not exist
 * @returns {Map<string, Buffer>} workerRelPath -> its raw bytes, deduped
 */
export function findWorkerAssets(fileContents, readFile) {
  const workers = new Map();
  const scanned = new Set(fileContents.keys()); // guards the BFS below against re-scanning the same
  // file's text twice — it does NOT prevent a file already in `fileContents` from also being classified
  // as a worker (a file can be both statically imported AND worker-referenced; worker classification
  // wins so its bytes count against the worker budget, not the static one — see `evaluateBudget`).
  const queue = [...fileContents.entries()];

  while (queue.length) {
    const [path, content] = queue.shift();
    for (const m of content.matchAll(WORKER_URL_REF)) {
      const resolved = posix.normalize(posix.join(posix.dirname(path), m[1]));
      if (!workers.has(resolved)) {
        let buf;
        try {
          buf = readFile(resolved);
        } catch {
          buf = undefined;
        }
        if (!buf) continue; // referenced but not an emitted dist file — not a worker we can verify
        workers.set(resolved, buf);
      }
      if (!scanned.has(resolved)) {
        scanned.add(resolved);
        queue.push([resolved, workers.get(resolved).toString("utf8")]);
      }
    }
  }

  return workers;
}

/**
 * @param {object} opts
 * @param {Record<string, any>} opts.manifest
 * @param {string} opts.entryKey
 * @param {(relPath: string) => Buffer} opts.readFile reads a dist-relative file as a Buffer
 * @param {number} [opts.budgetBytes] static critical-path budget, gzip bytes
 * @param {number} [opts.workerBudgetBytes] runtime-worker budget, gzip bytes (F3)
 */
export function evaluateBudget({
  manifest,
  entryKey,
  readFile,
  budgetBytes = CRITICAL_BUDGET_BYTES,
  workerBudgetBytes = RUNTIME_WORKER_BUDGET_BYTES,
}) {
  const emptyResult = (reason) => ({
    ok: false,
    totalGzipBytes: 0,
    workerGzipBytes: 0,
    files: [],
    workerFiles: [],
    reasons: [reason],
  });

  // F3 vacuous-pass hole: a manifest with no entry key, or an entry with no "file" (vite build did not
  // actually emit an output for it — e.g. the entry key name drifted from what `--entry` was given, or
  // a build failed to produce it), must FAIL loudly, not silently walk zero files and report success.
  if (!manifest[entryKey]) return emptyResult(`no entry "${entryKey}" in manifest`);
  if (!manifest[entryKey].file) {
    return emptyResult(
      `entry "${entryKey}" in manifest has no "file" — vite build did not emit it`,
    );
  }

  const { files } = collectStaticGraph(manifest, entryKey);
  const raw = new Map(); // relPath -> Buffer
  const contents = new Map(); // relPath -> utf8 text

  for (const f of files) {
    const buf = readFile(f);
    raw.set(f, buf);
    contents.set(f, buf.toString("utf8"));
  }

  const workerRaw = findWorkerAssets(contents, readFile);
  const workerFiles = new Set(workerRaw.keys());

  let totalGzipBytes = 0;
  for (const [f, buf] of raw) {
    if (workerFiles.has(f)) continue; // reclassified as a worker — budgeted separately, below
    totalGzipBytes += gzipSize(buf);
  }

  let workerGzipBytes = 0;
  for (const buf of workerRaw.values()) workerGzipBytes += gzipSize(buf);

  // the forbidden-lazy-marker scan covers the worker files too (F3): a worker is just as reachable
  // before first interaction as anything else on the static path, so an accidentally-inlined duckdb/etc.
  // chunk inside a worker is exactly the same fault as one inside the main bundle.
  const allContents = new Map(contents);
  for (const [f, buf] of workerRaw) allContents.set(f, buf.toString("utf8"));

  const reasons = [];
  for (const hit of findForbiddenMarkers(allContents)) {
    reasons.push(
      `forbidden lazy-chunk marker "${hit.marker}" found in a file reachable by STATIC import (or referenced ` +
        `from one as a runtime worker): "${hit.path}" — it must be dynamically imported instead`,
    );
  }
  if (totalGzipBytes > budgetBytes) {
    const staticFiles = [...raw.keys()].filter((f) => !workerFiles.has(f));
    reasons.push(
      `critical-path gzip size ${totalGzipBytes} B exceeds the ${budgetBytes} B budget (${staticFiles.join(", ")})`,
    );
  }
  if (workerGzipBytes > workerBudgetBytes) {
    reasons.push(
      `runtime-worker gzip size ${workerGzipBytes} B exceeds the ${workerBudgetBytes} B budget (${[...workerFiles].join(", ")})`,
    );
  }

  return {
    ok: reasons.length === 0,
    totalGzipBytes,
    workerGzipBytes,
    files: [...raw.keys()].filter((f) => !workerFiles.has(f)),
    workerFiles: [...workerFiles],
    reasons,
  };
}
