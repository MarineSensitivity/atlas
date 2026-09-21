import { describe, expect, it } from "vitest";
import {
  collectStaticGraph,
  evaluateBudget,
  findForbiddenMarkers,
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
});
