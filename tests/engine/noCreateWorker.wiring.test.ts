// atlas-2 phase review, ruling 7: the pin rule "never `duckdb.createWorker()`" had no gate at all.
//
// It is a MEASURED rule, not a preference. `docs/spikes/S1.md` consequence 2 and CLAUDE.md's DuckDB
// wiring block: duckdb-wasm's blob-worker helper builds the worker from a Blob URL, and on a blob
// worker `instantiate()` HANGS FOREVER — no error, no rejection, just a page that never finishes
// booting. The working wiring is `new Worker(bundle.mainWorker)`, same-origin, which
// `src/lib/engine/bundles.ts` does. Nothing in the type system or the bundler stops someone
// reaching for the helper instead, and the failure it causes looks like "the engine is slow".
//
// **Scope: the whole app** (fix round 2, defect 2). Round 1 scanned `src/lib/engine` only, so a
// rogue call in `src/lib/raster/`, `src/lens/` or `src/places/` sailed straight through — and those
// are exactly the places a lens author reaching for DuckDB would put one. It now covers all of
// `src/**` plus the INLINE scripts of the three HTML entries (`index.html`, `report.html`,
// `gallery.html`), which are app code that no bundler ever sees. Deliberately NOT covered:
// `spikes/**` (S1's harnesses install several duckdb builds side by side and legitimately exercise
// the helper — that measurement is why this rule exists) and `tests/**` (this file names the tokens
// itself, and fixtures below plant them on purpose).
//
// It is gated the way `tests/analytics/noRawLocation.wiring.test.ts` gates its own never-do-this
// rule: a literal source scan, with seeded-fault fixtures proving the scan can fail. Tokens are
// matched everywhere in the file text INCLUDING comments — keeping them out of the tree entirely is
// what makes the check mechanical rather than a sentence someone has to remember.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** every app source tree, plus the HTML entries whose inline scripts are app code too. */
const SCANNED_DIRS = ["src"];
const SCANNED_HTML = ["index.html", "report.html", "gallery.html"];

/**
 * Matched as literal substrings, exactly as they would appear in real code:
 * - `createWorker(` — the blob-worker helper (`duckdb.createWorker(...)`, or destructured);
 * - `getJsDelivrBundles(` — the CDN bundle list, which this app self-hosts instead;
 * - `coi` bundles — `selectBundle`'s cross-origin-isolated variant, which needs COOP/COEP headers
 *   GitHub Pages cannot send (S1 consequence 2, same sentence).
 */
export const FORBIDDEN_PATTERNS = ["createWorker(", "getJsDelivrBundles(", "duckdb.coi", "coi:"];

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** every file this gate reads: all of `src/**`, plus the HTML entries that exist. */
function scannedFiles(rootDir: string): string[] {
  const out: string[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const f of walk(join(rootDir, dir))) {
      if (/\.(ts|js|mjs|svelte|svelte\.ts)$/.test(f)) out.push(f);
    }
  }
  for (const html of SCANNED_HTML) {
    const p = join(rootDir, html);
    try {
      statSync(p);
      out.push(p);
    } catch {
      // gallery.html/report.html need not exist in a fixture tree
    }
  }
  return out;
}

/** scans the whole app for a forbidden literal substring. */
export function findForbiddenWorkerWiring(
  rootDir: string,
): { path: string; line: number; match: string }[] {
  const hits: { path: string; line: number; match: string }[] = [];
  for (const file of scannedFiles(rootDir)) {
    const content = readFileSync(file, "utf8");
    const rel = relative(rootDir, file);
    content.split("\n").forEach((text, i) => {
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (text.includes(pattern)) hits.push({ path: rel, line: i + 1, match: pattern });
      }
    });
  }
  return hits;
}

describe("the whole app never uses duckdb-wasm's blob-worker helper or a coi bundle", () => {
  it("finds zero occurrences across src/** and the HTML entries, code or comments", () => {
    expect(findForbiddenWorkerWiring(REPO_ROOT)).toEqual([]);
  });

  it("really is scanning beyond src/lib/engine (the round-1 gap)", () => {
    // a guard on the GATE itself: if `scannedFiles` ever narrowed back to one directory, the test
    // above would still pass while proving nothing about `src/lens/` or `src/places/`.
    const files = scannedFiles(REPO_ROOT).map((f) => relative(REPO_ROOT, f));
    expect(files.some((f) => f.startsWith("src/lib/engine/"))).toBe(true);
    expect(files.some((f) => f.startsWith("src/lib/") && !f.startsWith("src/lib/engine/"))).toBe(
      true,
    );
    expect(files).toContain("index.html");
  });

  it("the real bundles.ts constructs the worker itself, same-origin", () => {
    const src = readFileSync(join(REPO_ROOT, "src", "lib", "engine", "bundles.ts"), "utf8");
    expect(src).toContain("new Worker(bundle.mainWorker)");
  });
});

describe("findForbiddenWorkerWiring — seeded fault", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function makeFixtureRoot(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "atlas-no-create-worker-"));
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    return dir;
  }

  // the exact gap fix round 2 found: round 1 scanned src/lib/engine only, so a call in a LENS or a
  // PLACES module — the likeliest places for one — was invisible.
  it("goes RED on a rogue call under src/lens/ and under src/places/", () => {
    const root = makeFixtureRoot({
      "src/lib/engine/fine.ts": `const worker = new Worker(bundle.mainWorker);\n`,
      "src/lens/scores/rogue.ts": `export const w = duckdb.createWorker("x");\n`,
      "src/places/rogue.ts": `export const w2 = duckdb.createWorker("y");\n`,
    });
    const hits = findForbiddenWorkerWiring(root);
    expect(hits.map((h) => h.path).sort()).toEqual([
      "src/lens/scores/rogue.ts",
      "src/places/rogue.ts",
    ]);
    expect(hits.every((h) => h.match === "createWorker(")).toBe(true);
  });

  it("goes RED on a rogue call under src/lib/raster/ (the coordinator's own fault file)", () => {
    const root = makeFixtureRoot({
      "src/lib/raster/zzFault.ts": `export const w = duckdb.createWorker("x");\n`,
    });
    expect(findForbiddenWorkerWiring(root)).toEqual([
      { path: "src/lib/raster/zzFault.ts", line: 1, match: "createWorker(" },
    ]);
  });

  it("goes RED on a call inside index.html's inline script", () => {
    const root = makeFixtureRoot({
      "index.html": `<!doctype html>\n<script>\n  var w = duckdb.createWorker("x");\n</script>\n`,
    });
    const hits = findForbiddenWorkerWiring(root);
    expect(hits).toEqual([{ path: "index.html", line: 3, match: "createWorker(" }]);
  });

  it("goes RED on a real duckdb.createWorker() call in the engine directory", () => {
    const root = makeFixtureRoot({
      "src/lib/engine/rogue.ts": `const w = await duckdb.createWorker(bundle.mainWorker);\n`,
    });
    const hits = findForbiddenWorkerWiring(root);
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe("createWorker(");
  });

  it("goes RED on a destructured createWorker import", () => {
    const root = makeFixtureRoot({
      "src/lib/engine/rogue.ts": `import { createWorker } from "@duckdb/duckdb-wasm";\nconst w = createWorker(u);\n`,
    });
    expect(findForbiddenWorkerWiring(root).length).toBeGreaterThan(0);
  });

  it("goes RED even when the token is only inside a comment", () => {
    const root = makeFixtureRoot({
      "src/lib/engine/rogue.ts": `// TODO: try createWorker( ) again someday\nexport const ok = 1;\n`,
    });
    expect(findForbiddenWorkerWiring(root).length).toBeGreaterThan(0);
  });

  it("goes RED on a coi bundle or the jsDelivr CDN bundles", () => {
    const root = makeFixtureRoot({
      "src/lib/engine/a.ts": `export const b = { coi: { mainModule: "x" } };\n`,
      "src/lib/map/b.ts": `const all = duckdb.getJsDelivrBundles();\n`,
    });
    const hits = findForbiddenWorkerWiring(root);
    expect(hits.map((h) => h.match).sort()).toEqual(["coi:", "getJsDelivrBundles("]);
  });

  it("stays GREEN for the sanctioned wiring, and ignores spikes/ and tests/", () => {
    const root = makeFixtureRoot({
      "src/lib/engine/fine.ts": `const worker = new Worker(bundle.mainWorker);\n`,
      "spikes/1/src/bundles.js": `const w = duckdb.createWorker(u);\n`, // S1's harness: exempt
      "tests/engine/whatever.test.ts": `expect("createWorker(").toBeTruthy();\n`, // this gate itself
    });
    expect(findForbiddenWorkerWiring(root)).toEqual([]);
  });

  it("does not false-positive on an unrelated identifier that merely contains the word", () => {
    const root = makeFixtureRoot({
      "src/lib/engine/fine.ts": `export const note = "we never call it: createWorker is banned";\n`,
    });
    expect(findForbiddenWorkerWiring(root)).toEqual([]); // no "(" — not a call
  });
});
