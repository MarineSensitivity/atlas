// core budget logic, kept dependency-free and disk-free so it is unit-testable (tests/size-budget.test.ts)
// with a synthetic manifest and in-memory files, and reused as-is by the CLI wrapper (size-budget.mjs)
// against a real `vite build` (green) and the committed red fixtures (red).
//
// plan atlas-0 Deliverable 4: fail when the critical path — everything index.html loads before first
// interaction — exceeds the static budget (450 KB gzip, plan D13 — see below), OR when any chunk that
// is supposed to be lazy (duckdb*, terra-draw*, docx*, shp*, the treemap) appears in the entry's
// STATIC import graph. `dynamicImports` are deliberately never walked: that is exactly the escape
// hatch that keeps those libraries lazy.
//
// atlas-0 review fix round 1, F3: a runtime worker (maplibre-gl's, wired per S2.md's `?worker&url` +
// setWorkerUrl) downloads at `new Map()` construction — before first interaction, same as anything else
// on the critical path — but it is not a static `import` and is not reliably present in the manifest's
// `assets` array either (that depends on chunk-splitting specifics this repo does not control). So the
// worker is found the same way `findForbiddenMarkers` finds a forbidden library: by reading the compiled
// bytes of every file already known to be on the static path, not by trusting manifest bookkeeping. It
// gets counted, but in its OWN budget (`RUNTIME_WORKER_BUDGET_BYTES`), not folded into the static
// critical-path number — see `evaluateBudget`.
import { gzipSync } from "node:zlib";
import { posix } from "node:path";

// plan D13, relaxed 2026-09-21 ("We don't need to be so tight on the 350 KB budget"): 350 -> 450 KB
// gzip for the static critical path. The arithmetic that motivated the relax: MapLibre 6.10 +
// pmtiles + its own CSS measures 288,149 B gzip on its own (S2.md), and atlas-3 step 3's shell
// (Svelte runtime + Shell.svelte + the self-hosted Jost/Carlito brand fonts, kept as wired) already
// measures ~108 KB gzip once index.html actually hydrates something — 288 + 108 = ~396 KB, which
// left under 54 KB for atlas-4/5's own lens code under the OLD 350 KB cap. 450 KB leaves ~54 KB
// more than that (~50 KB free), the room the owner decided the lenses need. Runtime workers keep
// their own, separate 150 KB gzip budget (F3, unchanged), so the two together ("before first
// interaction") total 600 KB.
export const CRITICAL_BUDGET_BYTES = 450 * 1024; // 450 KB gzip (plan D13, relaxed 2026-09-21)
export const RUNTIME_WORKER_BUDGET_BYTES = 150 * 1024; // 150 KB gzip (F3) — a separate budget for every
// runtime worker referenced from the static graph (measured: maplibre-gl's own worker is 143.9 KB gzip,
// S2.md Consequences #10); pending the project owner's confirmation of the exact numbers.

// substrings, matched case-insensitively against the bundled text of every file reachable through
// static imports. Matching on content (not just on chunk file names) catches the case where Rollup
// inlines the forbidden module into the entry chunk instead of giving it its own file.
//
// NOTE (atlas-3 step 2b): this content-only scan CANNOT catch every forbidden static import.
// Measured against d3-hierarchy imported the way Treemap.svelte uses it (only `hierarchy()` and
// `.sum()`): once tree-shaken, the compiled code contains neither "d3-hierarchy" nor "treemap" as
// literal text, AND a static import of a module this small is inlined directly into the entry
// chunk by Rollup with no separate manifest entry at all (confirmed: `INEFFECTIVE_DYNAMIC_IMPORT`
// warning, no distinguishing manifest key either) -- so no build-OUTPUT signal reliably identifies
// it. `tests/treemap-lazy-import.wiring.test.ts` is the real gate for that one dependency: a
// SOURCE-level scan for a static `import ... from "d3-hierarchy"` declaration, the same pattern
// `tests/raster/ramps.wiring.test.ts` uses for "no second ramp defined outside ramps.ts". Keep
// that in mind before adding a dependency to this list and assuming it is now covered.
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
// unrelated `new URL(...)` (a sourcemap comment, a non-JS asset URL, ...). Group 1 is the quote
// character (used to tell a template literal from a plain string, below); group 2 is the raw text
// between the quotes.
export const WORKER_URL_REF =
  /new\s+URL\(\s*([`'"])([^`'"()]+\.m?js)\1\s*,\s*import\.meta\.url\s*\)/g;

function tryReadFile(readFile, path) {
  try {
    return readFile(path) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find every worker JS asset referenced — directly, or transitively (a worker referencing a worker of
 * its own) — from `fileContents`' text. This does NOT consult the manifest's `assets`/`imports` fields
 * at all — see the file header (F3) for why.
 *
 * atlas-0 review round 2, N1: a matched reference is never silently dropped. Resolution is three
 * tiers, in order: (1) sibling-relative to the referencing file, as the compiled output normally is;
 * (2) if that can't be read, a basename lookup among `emittedFiles` (a full listing of what the build
 * actually produced) — covers a Vite bump that prefixes the base path or nests output differently;
 * (3) if basename lookup finds zero or more-than-one candidate, or the reference isn't a literal
 * string at all (a template literal with an unresolved `${...}`), that is a hard FAIL with a reason
 * naming the reference and the file that made it — never a guess, never a silent skip.
 * @param {Map<string, string>} fileContents relPath -> utf8 text; the seed set to scan (typically the
 *   static-critical-path files already collected by `collectStaticGraph`)
 * @param {(relPath: string) => Buffer} readFile reads a dist-relative file as a Buffer; may throw or
 *   return a falsy value for a path that does not exist
 * @param {string[]} [emittedFiles] every dist-relative file path the build actually emitted (e.g. a
 *   recursive listing of `dist`), used only as the basename-lookup fallback above
 * @returns {{workers: Map<string, Buffer>, reasons: string[]}} workerRelPath -> raw bytes (deduped),
 *   plus any reasons a matched reference could not be resolved (empty means every match resolved)
 */
export function findWorkerAssets(fileContents, readFile, emittedFiles = []) {
  const workers = new Map();
  const reasons = [];
  const scanned = new Set(fileContents.keys()); // guards the BFS below against re-scanning the same
  // file's text twice — it does NOT prevent a file already in `fileContents` from also being classified
  // as a worker (a file can be both statically imported AND worker-referenced; worker classification
  // wins so its bytes count against the worker budget, not the static one — see `evaluateBudget`).
  const queue = [...fileContents.entries()];

  while (queue.length) {
    const [path, content] = queue.shift();
    for (const m of content.matchAll(WORKER_URL_REF)) {
      const quote = m[1];
      const spec = m[2];

      // a backtick literal with an unresolved `${...}` isn't a filename at all — `?worker&url`'s own
      // output is always a fully-resolved literal, so this only happens for hand-written, non-static
      // worker construction. Flag it distinctly rather than trying (and failing) to resolve it as text.
      if (quote === "`" && spec.includes("${")) {
        reasons.push(
          `unanalysable worker reference: \`${spec}\` in "${path}" is not a literal string (template ` +
            `interpolation) — this checker cannot resolve a non-literal worker URL; rewrite it as a ` +
            `plain string built entirely at build time`,
        );
        continue;
      }

      const naive = posix.normalize(posix.join(posix.dirname(path), spec));
      let resolved = naive;
      let buf = tryReadFile(readFile, naive);

      if (!buf) {
        // fallback: the reference's own text didn't resolve as a plain sibling of the referencing
        // file — look its basename up among everything the build actually emitted instead of giving
        // up (a Vite bump prefixing the base path, or nesting output differently, is exactly this).
        const basename = posix.basename(spec);
        const candidates = emittedFiles.filter((f) => posix.basename(f) === basename);
        if (candidates.length === 1) {
          resolved = candidates[0];
          buf = tryReadFile(readFile, resolved);
        } else if (candidates.length > 1) {
          reasons.push(
            `ambiguous worker reference: "${spec}" in "${path}" — ${candidates.length} emitted files ` +
              `share the basename "${basename}" (${candidates.join(", ")}); refusing to guess which one`,
          );
          continue;
        }
      }

      if (!buf) {
        reasons.push(
          `unresolvable worker reference: "${spec}" in "${path}" — no emitted dist file at "${naive}", ` +
            `and no emitted file is named "${posix.basename(spec)}" either`,
        );
        continue;
      }

      if (!workers.has(resolved)) workers.set(resolved, buf);
      if (!scanned.has(resolved)) {
        scanned.add(resolved);
        queue.push([resolved, buf.toString("utf8")]);
      }
    }
  }

  return { workers, reasons };
}

/**
 * @param {object} opts
 * @param {Record<string, any>} opts.manifest
 * @param {string} opts.entryKey
 * @param {(relPath: string) => Buffer} opts.readFile reads a dist-relative file as a Buffer
 * @param {number} [opts.budgetBytes] static critical-path budget, gzip bytes
 * @param {number} [opts.workerBudgetBytes] runtime-worker budget, gzip bytes (F3)
 * @param {string[]} [opts.emittedFiles] every dist-relative file the build emitted (N1's
 *   basename-lookup fallback for a worker reference that doesn't resolve where its own text says it
 *   should); defaults to empty, in which case a reference that doesn't resolve directly is a FAIL, not
 *   a silent skip — see `findWorkerAssets`.
 */
export function evaluateBudget({
  manifest,
  entryKey,
  readFile,
  budgetBytes = CRITICAL_BUDGET_BYTES,
  workerBudgetBytes = RUNTIME_WORKER_BUDGET_BYTES,
  emittedFiles = [],
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

  const { workers: workerRaw, reasons: workerReasons } = findWorkerAssets(
    contents,
    readFile,
    emittedFiles,
  );
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

  // N1: a worker reference that couldn't be resolved (or wasn't a literal at all) is a hard FAIL — it
  // is exactly the case where a real ~144 KB download could silently leave the budget unnoticed.
  const reasons = [...workerReasons];
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
