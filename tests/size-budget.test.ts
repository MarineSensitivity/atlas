import { describe, expect, it } from "vitest";
import {
  collectStaticGraph,
  evaluateBudget,
  findForbiddenMarkers,
  findWorkerAssets,
  gzipSize,
  RUNTIME_WORKER_BUDGET_BYTES,
} from "../scripts/size-budget-core.mjs";

function buf(text: string): Buffer {
  return Buffer.from(text, "utf8");
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

describe("findWorkerAssets (atlas-0 review fix F3)", () => {
  it("finds a `?worker&url`-compiled reference and confirms it against readFile", () => {
    const seed = new Map([["assets/index.js", "new URL(`worker-ABC123.js`,import.meta.url)"]]);
    const files: Record<string, string> = { "assets/worker-ABC123.js": "self.onmessage=()=>{}" };
    const workers = findWorkerAssets(seed, (f) => buf(files[f]));
    expect([...workers.keys()]).toEqual(["assets/worker-ABC123.js"]);
  });

  it("matches single- and double-quoted forms too, not just backticks", () => {
    const files: Record<string, string> = { "assets/w.js": "self.onmessage=()=>{}" };
    for (const q of ['"', "'"]) {
      const seed = new Map([["assets/index.js", `new URL(${q}w.js${q}, import.meta.url)`]]);
      const workers = findWorkerAssets(seed, (f) => buf(files[f]));
      expect([...workers.keys()]).toEqual(["assets/w.js"]);
    }
  });

  it("resolves the reference relative to the referencing file's own directory", () => {
    const seed = new Map([["assets/nested/index.js", 'new URL("w.js", import.meta.url)']]);
    const files: Record<string, string> = { "assets/nested/w.js": "self.onmessage=()=>{}" };
    const workers = findWorkerAssets(seed, (f) => buf(files[f]));
    expect([...workers.keys()]).toEqual(["assets/nested/w.js"]);
  });

  it("ignores a reference to a file readFile cannot produce (not an emitted dist file)", () => {
    const seed = new Map([["assets/index.js", 'new URL("ghost.js", import.meta.url)']]);
    const workers = findWorkerAssets(seed, () => {
      throw new Error("ENOENT");
    });
    expect(workers.size).toBe(0);
  });

  it("ignores a `new URL(...)` that does not end in .js/.mjs (not a worker reference)", () => {
    const seed = new Map([["assets/index.js", 'new URL("data.json", import.meta.url)']]);
    const workers = findWorkerAssets(seed, () => buf("{}"));
    expect(workers.size).toBe(0);
  });

  it("follows a worker that itself references another worker (transitive)", () => {
    const seed = new Map([["assets/index.js", 'new URL("w1.js", import.meta.url)']]);
    const files: Record<string, string> = {
      "assets/w1.js": 'new URL("w2.js", import.meta.url)',
      "assets/w2.js": "self.onmessage=()=>{}",
    };
    const workers = findWorkerAssets(seed, (f) => buf(files[f]));
    expect(new Set(workers.keys())).toEqual(new Set(["assets/w1.js", "assets/w2.js"]));
  });

  it("dedupes when the same worker is referenced from two different static files", () => {
    const seed = new Map([
      ["assets/a.js", 'new URL("w.js", import.meta.url)'],
      ["assets/b.js", 'new URL("w.js", import.meta.url)'],
    ]);
    const files: Record<string, string> = { "assets/w.js": "self.onmessage=()=>{}" };
    const workers = findWorkerAssets(seed, (f) => buf(files[f]));
    expect([...workers.keys()]).toEqual(["assets/w.js"]);
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
});
