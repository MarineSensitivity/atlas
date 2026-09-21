// atlas-2 phase review, ruling 7: the pin rule "never `duckdb.createWorker()`" had no gate at all.
//
// It is a MEASURED rule, not a preference. `docs/spikes/S1.md` consequence 2 and CLAUDE.md's DuckDB
// wiring block: duckdb-wasm's `createWorker()` helper builds the worker from a Blob URL, and on a
// blob worker `instantiate()` HANGS FOREVER — no error, no rejection, just a page that never
// finishes booting. The working wiring is `new Worker(bundle.mainWorker)`, same-origin, which
// `src/lib/engine/bundles.ts` does. Nothing in the type system or the bundler stops someone
// reaching for the helper instead, and the failure it causes looks like "the engine is slow".
//
// So it is gated the way `tests/analytics/noRawLocation.wiring.test.ts` gates its own
// never-do-this rule: a literal source scan over the directory that owns the wiring, with a seeded
// fault proving the scan can fail. The token is matched everywhere in the file text INCLUDING
// comments — same reasoning as that test: a rule nobody may follow is a rule nobody should write down as code either,
// and keeping the token out of the directory entirely is what makes the check mechanical.
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
const ENGINE_DIR = join("src", "lib", "engine");

/**
 * Matched as literal substrings, exactly as they would appear in real code:
 * - `createWorker(` — the blob-worker helper itself (`duckdb.createWorker(...)`, or destructured);
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

/** scans every source file under `<rootDir>/src/lib/engine` for a forbidden literal substring. */
export function findForbiddenWorkerWiring(
  rootDir: string,
): { path: string; line: number; match: string }[] {
  const hits: { path: string; line: number; match: string }[] = [];
  for (const file of walk(join(rootDir, ENGINE_DIR))) {
    if (!/\.(ts|svelte|js)$/.test(file)) continue;
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

describe("src/lib/engine never uses duckdb-wasm's createWorker() helper or a coi bundle", () => {
  it("finds zero occurrences across the real directory, code or comments", () => {
    expect(findForbiddenWorkerWiring(REPO_ROOT)).toEqual([]);
  });

  it("the real bundles.ts constructs the worker itself, same-origin", () => {
    const src = readFileSync(join(REPO_ROOT, ENGINE_DIR, "bundles.ts"), "utf8");
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

  it("goes RED on a real duckdb.createWorker() call", () => {
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
      "src/lib/engine/b.ts": `const all = duckdb.getJsDelivrBundles();\n`,
    });
    const hits = findForbiddenWorkerWiring(root);
    expect(hits.map((h) => h.match).sort()).toEqual(["coi:", "getJsDelivrBundles("]);
  });

  it("stays GREEN for the sanctioned wiring, and ignores files outside src/lib/engine", () => {
    const root = makeFixtureRoot({
      "src/lib/engine/fine.ts": `const worker = new Worker(bundle.mainWorker);\n`,
      "src/lib/map/other.ts": `const w = duckdb.createWorker(u);\n`, // outside this gate's scope
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
