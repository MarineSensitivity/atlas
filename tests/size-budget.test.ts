import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  collectStaticGraph,
  CRITICAL_BUDGET_BYTES,
  evaluateBudget,
  FORBIDDEN_LAZY_MARKERS,
  findForbiddenMarkers,
  findWorkerAssets,
  gzipSize,
  RUNTIME_WORKER_BUDGET_BYTES,
} from "../scripts/size-budget-core.mjs";

function buf(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

/**
 * `randomBytes(n)` with any forbidden-lazy-marker occurrence neutralized.
 *
 * Why this exists (found flaky in the atlas-2 fix round, ~14% of runs): `evaluateBudget` also greps
 * the reachable files' TEXT for `FORBIDDEN_LAZY_MARKERS`, and `shp` is three bytes — in 449 KB of
 * uniform random bytes the chance that one of the markers appears by accident is about one run in
 * seven. The straddle test below then failed for a reason that has nothing to do with the budget it
 * is measuring, on a check that is required on `main` (the exact class of gate `tests/perf.ts`'s
 * header argues against). Blanking the few matched runs changes the gzip size by a handful of bytes
 * and leaves the payload just as incompressible.
 */
function incompressibleBytes(n: number): Buffer {
  const text = randomBytes(n).toString("latin1");
  const re = new RegExp(FORBIDDEN_LAZY_MARKERS.join("|"), "gi");
  return Buffer.from(
    text.replace(re, (m: string) => "\u0000".repeat(m.length)),
    "latin1",
  );
}

describe("collectStaticGraph", () => {
  it("follows static imports transitively but never dynamicImports", () => {
    const manifest = {
      "index.html": {
        file: "index.js",
        isEntry: true,
        imports: ["chunk-a"],
        dynamicImports: ["chunk-lazy"],
      },
      "chunk-a": { file: "a.js", imports: ["chunk-b"] },
      "chunk-b": { file: "b.js", css: ["b.css"] },
      "chunk-lazy": { file: "lazy.js" }, // reachable only via dynamicImports: must NOT show up
    };
    const { files } = collectStaticGraph(manifest, "index.html");
    expect(files).toEqual(new Set(["index.js", "a.js", "b.js", "b.css"]));
  });
});

describe("findForbiddenMarkers", () => {
  it("matches case-insensitively", () => {
    const hits = findForbiddenMarkers(new Map([["x.js", "import DuckDB from 'x'"]]));
    expect(hits).toEqual([{ path: "x.js", marker: "duckdb" }]);
  });

  it("finds nothing in clean content", () => {
    expect(findForbiddenMarkers(new Map([["x.js", "console.log(1)"]]))).toEqual([]);
  });
});

describe("findWorkerAssets (atlas-0 review fix F3, extended N1)", () => {
  it("finds a `?worker&url`-compiled reference and confirms it against readFile", () => {
    const seed = new Map([["assets/index.js", "new URL(`worker-ABC123.js`,import.meta.url)"]]);
    const files: Record<string, string> = { "assets/worker-ABC123.js": "self.onmessage=()=>{}" };
    const { workers, reasons } = findWorkerAssets(seed, (f) => buf(files[f]));
    expect([...workers.keys()]).toEqual(["assets/worker-ABC123.js"]);
    expect(reasons).toEqual([]);
  });

  it("matches single- and double-quoted forms too, not just backticks", () => {
    const files: Record<string, string> = { "assets/w.js": "self.onmessage=()=>{}" };
    for (const q of ['"', "'"]) {
      const seed = new Map([["assets/index.js", `new URL(${q}w.js${q}, import.meta.url)`]]);
      const { workers, reasons } = findWorkerAssets(seed, (f) => buf(files[f]));
      expect([...workers.keys()]).toEqual(["assets/w.js"]);
      expect(reasons).toEqual([]);
    }
  });

  it("resolves the reference relative to the referencing file's own directory", () => {
    const seed = new Map([["assets/nested/index.js", 'new URL("w.js", import.meta.url)']]);
    const files: Record<string, string> = { "assets/nested/w.js": "self.onmessage=()=>{}" };
    const { workers, reasons } = findWorkerAssets(seed, (f) => buf(files[f]));
    expect([...workers.keys()]).toEqual(["assets/nested/w.js"]);
    expect(reasons).toEqual([]);
  });

  it("ignores a `new URL(...)` that does not end in .js/.mjs (not a worker reference)", () => {
    const seed = new Map([["assets/index.js", 'new URL("data.json", import.meta.url)']]);
    const { workers, reasons } = findWorkerAssets(seed, () => buf("{}"));
    expect(workers.size).toBe(0);
    expect(reasons).toEqual([]);
  });

  it("follows a worker that itself references another worker (transitive)", () => {
    const seed = new Map([["assets/index.js", 'new URL("w1.js", import.meta.url)']]);
    const files: Record<string, string> = {
      "assets/w1.js": 'new URL("w2.js", import.meta.url)',
      "assets/w2.js": "self.onmessage=()=>{}",
    };
    const { workers, reasons } = findWorkerAssets(seed, (f) => buf(files[f]));
    expect(new Set(workers.keys())).toEqual(new Set(["assets/w1.js", "assets/w2.js"]));
    expect(reasons).toEqual([]);
  });

  it("dedupes when the same worker is referenced from two different static files", () => {
    const seed = new Map([
      ["assets/a.js", 'new URL("w.js", import.meta.url)'],
      ["assets/b.js", 'new URL("w.js", import.meta.url)'],
    ]);
    const files: Record<string, string> = { "assets/w.js": "self.onmessage=()=>{}" };
    const { workers, reasons } = findWorkerAssets(seed, (f) => buf(files[f]));
    expect([...workers.keys()]).toEqual(["assets/w.js"]);
    expect(reasons).toEqual([]);
  });

  // --- N1: a matched reference is never silently dropped -----------------------------------------

  describe("N1: resolution branches", () => {
    it("branch 1 — resolves directly (sibling of the referencing file)", () => {
      const seed = new Map([["assets/index.js", 'new URL("w.js", import.meta.url)']]);
      const files: Record<string, string> = { "assets/w.js": "self.onmessage=()=>{}" };
      const { workers, reasons } = findWorkerAssets(seed, (f) => buf(files[f]), [
        "assets/index.js",
        "assets/w.js",
      ]);
      expect([...workers.keys()]).toEqual(["assets/w.js"]);
      expect(reasons).toEqual([]);
    });

    it("branch 2 — falls back to a basename lookup among emittedFiles when direct resolution fails (the reviewer's seeded scenario)", () => {
      // exactly the reviewer's example: a reference `./assets/w.js` written inside `assets/app.js`
      // naively joins to `assets/assets/w.js` (wrong — doubles the "assets/" segment), which does not
      // exist; the real file is at `assets/w.js`.
      const seed = new Map([["assets/app.js", 'new URL("./assets/w.js", import.meta.url)']]);
      const emitted = ["assets/app.js", "assets/w.js"];
      const readFile = (f: string): Buffer => {
        if (f === "assets/w.js") return buf("self.onmessage=()=>{}");
        throw new Error(`ENOENT: ${f}`);
      };
      const { workers, reasons } = findWorkerAssets(seed, readFile, emitted);
      expect([...workers.keys()]).toEqual(["assets/w.js"]);
      expect(reasons).toEqual([]);
    });

    it("branch 3 — unresolvable (no direct file, no basename match anywhere) => FAILS with a named reason", () => {
      const seed = new Map([["assets/index.js", 'new URL("ghost.js", import.meta.url)']]);
      const { workers, reasons } = findWorkerAssets(seed, () => {
        throw new Error("ENOENT");
      }, ["assets/index.js", "assets/unrelated.js"]);
      expect(workers.size).toBe(0);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain("unresolvable worker reference");
      expect(reasons[0]).toContain("ghost.js");
      expect(reasons[0]).toContain("assets/index.js");
    });

    it("branch 4 — two emitted files share the basename => FAILS as ambiguous rather than guessing", () => {
      const seed = new Map([["assets/app.js", 'new URL("./assets/w.js", import.meta.url)']]);
      const emitted = ["assets/app.js", "assets/w.js", "assets/chunk/w.js"];
      const readFile = (f: string): Buffer => {
        if (f === "assets/w.js" || f === "assets/chunk/w.js") return buf("self.onmessage=()=>{}");
        throw new Error(`ENOENT: ${f}`);
      };
      const { workers, reasons } = findWorkerAssets(seed, readFile, emitted);
      expect(workers.size).toBe(0); // never guesses which candidate is the real one
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain("ambiguous worker reference");
      expect(reasons[0]).toContain("assets/w.js");
      expect(reasons[0]).toContain("assets/chunk/w.js");
    });

    it("branch 5 — a template-interpolated (non-literal) reference FAILS as unanalysable, not silently ignored", () => {
      const seed = new Map([["assets/index.js", "new URL(`template${x}.js`,import.meta.url)"]]);
      const { workers, reasons } = findWorkerAssets(seed, () => buf("irrelevant"));
      expect(workers.size).toBe(0);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain("unanalysable worker reference");
      expect(reasons[0]).toContain("template${x}.js");
    });

    it("a plain (non-backtick) string containing literal `${` text is NOT treated as a template — just an unresolvable literal", () => {
      // `${` has no special meaning inside single/double quotes; this is a (weird but real) literal
      // filename that simply doesn't exist anywhere emitted.
      const seed = new Map([["assets/index.js", "new URL('${x}.js', import.meta.url)"]]);
      const { workers, reasons } = findWorkerAssets(seed, () => {
        throw new Error("ENOENT");
      }, ["assets/index.js"]);
      expect(workers.size).toBe(0);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain("unresolvable worker reference");
    });

    it("without an emittedFiles argument at all, a reference that fails direct resolution is unresolvable (not silently skipped)", () => {
      // default emittedFiles = [] — the pre-N1 behaviour of silently dropping the match is gone: this
      // is now a hard fail even with no fallback list supplied.
      const seed = new Map([["assets/index.js", 'new URL("ghost.js", import.meta.url)']]);
      const { workers, reasons } = findWorkerAssets(seed, () => {
        throw new Error("ENOENT");
      });
      expect(workers.size).toBe(0);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain("unresolvable worker reference");
    });
  });
});

describe("evaluateBudget", () => {
  const smallManifest = {
    "index.html": { file: "index.js", isEntry: true, imports: [] },
  };

  it("passes a small, clean entry", () => {
    const r = evaluateBudget({
      manifest: smallManifest,
      entryKey: "index.html",
      readFile: () => buf("console.log('hi')"),
    });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("fails when a forbidden library is reachable by STATIC import (the seeded fault)", () => {
    const manifest = {
      "index.html": { file: "index.js", isEntry: true, imports: ["chunk-a"] },
      "chunk-a": { file: "duckdb-bundle.js" },
    };
    const files: Record<string, string> = {
      "index.js": "console.log('hi')",
      "duckdb-bundle.js": "export const DUCKDB_WASM = 1;",
    };
    const r = evaluateBudget({ manifest, entryKey: "index.html", readFile: (f) => buf(files[f]) });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('"duckdb"'))).toBe(true);
  });

  it("passes when the forbidden library is reachable only through a dynamicImport (lazy is fine)", () => {
    const manifest = {
      "index.html": { file: "index.js", isEntry: true, imports: [], dynamicImports: ["chunk-a"] },
      "chunk-a": { file: "duckdb-bundle.js" },
    };
    const files: Record<string, string> = {
      "index.js": "console.log('hi')",
      "duckdb-bundle.js": "export const DUCKDB_WASM = 1;",
    };
    const r = evaluateBudget({ manifest, entryKey: "index.html", readFile: (f) => buf(files[f]) });
    expect(r.ok).toBe(true);
  });

  it("fails when the critical path exceeds the gzip budget", () => {
    const r = evaluateBudget({
      manifest: smallManifest,
      entryKey: "index.html",
      readFile: () => buf("x".repeat(1024)), // incompressible-ish random-free text still small; force via tiny budget below
      budgetBytes: 1, // 1 byte budget: any non-empty output exceeds it
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("exceeds"))).toBe(true);
  });

  // plan D13, relaxed 2026-09-21: CRITICAL_BUDGET_BYTES is 450 KB gzip (was 350). This proves the
  // DEFAULT budget (no `budgetBytes` override, unlike the synthetic 1-byte-budget case above) is
  // really 450 KB by straddling that exact line: a static path that gzips to just over 450 KB
  // FAILS, one that gzips to just under it PASSES. Random bytes barely compress (near-incompressible),
  // so a buffer of N raw bytes reliably gzips to within a few bytes of N -- confirmed below before
  // trusting the budget assertion, so this is testing the BUDGET, not a compression fluke.
  it("a ~451 KB static path FAILS the default 450 KB budget, and a ~449 KB one PASSES it", () => {
    expect(CRITICAL_BUDGET_BYTES).toBe(450 * 1024);
    const over = incompressibleBytes(451 * 1024);
    const under = incompressibleBytes(449 * 1024);
    // the payload must trip the BUDGET and nothing else, or this stops testing the budget
    expect(findForbiddenMarkers(new Map([["index.js", under.toString("latin1")]]))).toEqual([]);
    expect(gzipSize(over)).toBeGreaterThan(CRITICAL_BUDGET_BYTES);
    expect(gzipSize(under)).toBeLessThan(CRITICAL_BUDGET_BYTES);

    const overResult = evaluateBudget({
      manifest: smallManifest,
      entryKey: "index.html",
      readFile: () => over,
    });
    expect(overResult.ok).toBe(false);
    expect(overResult.reasons.some((x) => x.includes("exceeds"))).toBe(true);

    const underResult = evaluateBudget({
      manifest: smallManifest,
      entryKey: "index.html",
      readFile: () => under,
    });
    expect(underResult.ok).toBe(true);
  });

  it("fails cleanly when the entry key is missing from the manifest", () => {
    const r = evaluateBudget({ manifest: {}, entryKey: "index.html", readFile: () => buf("") });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/no entry/);
  });

  // F3 vacuous-pass hole: an entry key that exists but never got a "file" (a build that failed to
  // produce it, or an --entry typo against the real manifest) must not silently walk zero files and
  // report PASS.
  it('fails cleanly when the entry exists in the manifest but has no "file"', () => {
    const r = evaluateBudget({
      manifest: { "index.html": { isEntry: true, imports: [] } },
      entryKey: "index.html",
      readFile: () => buf(""),
    });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/no "file"/);
  });

  describe("runtime workers (F3)", () => {
    // an entry chunk whose compiled text references a worker the way `?worker&url` compiles to.
    const workerManifest = {
      "index.html": { file: "index.js", isEntry: true, imports: [] },
    };
    const smallWorkerFiles = (workerText: string): Record<string, string> => ({
      "index.js": 'new URL("worker.js", import.meta.url)',
      "worker.js": workerText,
    });

    it("is found and counted even though it is neither a static import nor in the manifest's assets", () => {
      const files = smallWorkerFiles("self.onmessage=()=>{}");
      const r = evaluateBudget({
        manifest: workerManifest,
        entryKey: "index.html",
        readFile: (f) => buf(files[f]),
      });
      expect(r.ok).toBe(true);
      expect(r.workerFiles).toEqual(["worker.js"]);
      expect(r.workerGzipBytes).toBeGreaterThan(0);
    });

    it("does NOT fold the worker's bytes into the static critical-path total (separate budgets)", () => {
      const files = smallWorkerFiles("self.onmessage=()=>{}");
      const r = evaluateBudget({
        manifest: workerManifest,
        entryKey: "index.html",
        readFile: (f) => buf(files[f]),
      });
      expect(r.files).toEqual(["index.js"]); // worker.js excluded from the static file list
      // totalGzipBytes is exactly index.js's own gzip size — worker.js's bytes never entered it.
      expect(r.totalGzipBytes).toBe(gzipSize(buf(files["index.js"])));
      expect(r.workerGzipBytes).toBe(gzipSize(buf(files["worker.js"])));
    });

    it("fails when the runtime worker exceeds RUNTIME_WORKER_BUDGET_BYTES (the seeded fault)", () => {
      const files = smallWorkerFiles("x".repeat(1024));
      const r = evaluateBudget({
        manifest: workerManifest,
        entryKey: "index.html",
        readFile: (f) => buf(files[f]),
        workerBudgetBytes: 1, // any non-empty worker output exceeds a 1-byte budget
      });
      expect(r.ok).toBe(false);
      expect(r.reasons.some((x) => x.includes("runtime-worker") && x.includes("exceeds"))).toBe(
        true,
      );
    });

    it("passes a worker within its own (default) budget", () => {
      const files = smallWorkerFiles("self.onmessage=()=>{}");
      const r = evaluateBudget({
        manifest: workerManifest,
        entryKey: "index.html",
        readFile: (f) => buf(files[f]),
      });
      expect(r.workerGzipBytes).toBeLessThan(RUNTIME_WORKER_BUDGET_BYTES);
      expect(r.ok).toBe(true);
    });

    it("the forbidden-lazy-marker scan also covers worker files, not just the static ones", () => {
      const files = smallWorkerFiles("export const DUCKDB_WASM = 1;");
      const r = evaluateBudget({
        manifest: workerManifest,
        entryKey: "index.html",
        readFile: (f) => buf(files[f]),
      });
      expect(r.ok).toBe(false);
      expect(r.reasons.some((x) => x.includes('"duckdb"') && x.includes("worker.js"))).toBe(true);
    });

    it("a worker referenced only via a dynamicImport-reached chunk is not walked (still respects lazy)", () => {
      // the worker reference lives in a chunk reachable ONLY through dynamicImports — collectStaticGraph
      // never visits it, so its text is never scanned and no worker is found or counted.
      const manifest = {
        "index.html": {
          file: "index.js",
          isEntry: true,
          imports: [],
          dynamicImports: ["chunk-lazy"],
        },
        "chunk-lazy": { file: "lazy.js" },
      };
      const files: Record<string, string> = {
        "index.js": "console.log('hi')",
        "lazy.js": 'new URL("worker.js", import.meta.url)',
        "worker.js": "self.onmessage=()=>{}",
      };
      const r = evaluateBudget({
        manifest,
        entryKey: "index.html",
        readFile: (f) => buf(files[f]),
      });
      expect(r.workerFiles).toEqual([]);
    });
  });

  describe("N1: a worker reference that resolves indirectly is still found, and a dead one still fails", () => {
    // the reviewer's exact scenario: the entry chunk is "assets/app.js" and its compiled text says
    // `new URL("./assets/w.js", import.meta.url)` — a Vite emission style where the reference is NOT a
    // plain sibling of the referencing file (it repeats the "assets/" segment the naive
    // dirname+join already supplies). Before N1 this silently dropped the worker and PASSED; now it
    // must be found via the emittedFiles basename fallback and budgeted.
    const manifest = {
      "index.html": { file: "assets/app.js", isEntry: true, imports: [] },
    };

    it("finds the worker via the basename fallback and budgets it (does not pass vacuously)", () => {
      const files: Record<string, string> = {
        "assets/app.js": 'new URL("./assets/w.js", import.meta.url)',
        "assets/w.js": "self.onmessage=()=>{}",
      };
      const r = evaluateBudget({
        manifest,
        entryKey: "index.html",
        readFile: (f) => buf(files[f]),
        emittedFiles: ["assets/app.js", "assets/w.js"],
      });
      expect(r.ok).toBe(true);
      expect(r.workerFiles).toEqual(["assets/w.js"]);
      expect(r.workerGzipBytes).toBeGreaterThan(0);
    });

    it("FAILS (never silently passes) when no emittedFiles listing is given to resolve the same reference", () => {
      const files: Record<string, string> = {
        "assets/app.js": 'new URL("./assets/w.js", import.meta.url)',
      };
      const r = evaluateBudget({
        manifest,
        entryKey: "index.html",
        readFile: (f) => {
          if (files[f] === undefined) throw new Error(`ENOENT: ${f}`);
          return buf(files[f]);
        },
      });
      expect(r.ok).toBe(false);
      expect(r.reasons.some((x) => x.includes("unresolvable worker reference"))).toBe(true);
    });
  });
});
