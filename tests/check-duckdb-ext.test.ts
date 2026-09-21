import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertMirrorNotInStaticGraph,
  checkDuckdbExtMirror,
  DEFAULT_MANIFEST_PATH,
  loadManifest,
  manifestEntryRelPath,
} from "../scripts/check-duckdb-ext-core.mjs";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

/** a fake "mirror" directory (stands in for dist/duckdb-ext or public/duckdb-ext) with real files at
 * real paths, so the core module's own fs calls are exercised unmocked -- the same style as
 * tests/check-dist-session.test.ts. */
function makeMirror(files: Record<string, Buffer | string>): string {
  dir = mkdtempSync(join(tmpdir(), "atlas-duckdb-ext-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

const GOOD_A = Buffer.from("parquet-eh-extension-bytes-stand-in");
const GOOD_B = Buffer.from("parquet-mvp-extension-bytes-stand-in-but-different");

function fakeManifest() {
  return {
    engineVersion: "v9.9.9",
    files: [
      { platform: "wasm_eh", name: "parquet", bytes: GOOD_A.byteLength, sha256: sha256(GOOD_A) },
      { platform: "wasm_mvp", name: "parquet", bytes: GOOD_B.byteLength, sha256: sha256(GOOD_B) },
    ],
  };
}

describe("loadManifest / manifestEntryRelPath", () => {
  it("loads the real, committed manifest and it is well-formed", () => {
    const manifest = loadManifest();
    expect(manifest.engineVersion).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const f of manifest.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
    }
  });

  it("DEFAULT_MANIFEST_PATH points at the real committed file", () => {
    expect(DEFAULT_MANIFEST_PATH).toMatch(/duckdb-extensions\.manifest\.json$/);
  });

  it("builds the engineVersion/platform/name.duckdb_extension.wasm relative path", () => {
    const manifest = fakeManifest();
    expect(manifestEntryRelPath(manifest, manifest.files[0])).toBe(
      join("v9.9.9", "wasm_eh", "parquet.duckdb_extension.wasm"),
    );
  });
});

describe("checkDuckdbExtMirror", () => {
  it("is green when every pinned file is present with the exact bytes and sha256", () => {
    const manifest = fakeManifest();
    const m = makeMirror({
      "v9.9.9/wasm_eh/parquet.duckdb_extension.wasm": GOOD_A,
      "v9.9.9/wasm_mvp/parquet.duckdb_extension.wasm": GOOD_B,
    });
    expect(checkDuckdbExtMirror(m, manifest)).toEqual([]);
  });

  // seeded fault: a mirrored file deleted from dist.
  it("is red when a pinned file is missing entirely", () => {
    const manifest = fakeManifest();
    const m = makeMirror({
      "v9.9.9/wasm_eh/parquet.duckdb_extension.wasm": GOOD_A,
      // wasm_mvp deliberately absent
    });
    const reasons = checkDuckdbExtMirror(m, manifest);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/missing:.*wasm_mvp/);
  });

  // seeded fault: one byte of the pinned hash changed (simulated here as one byte of the ON-DISK
  // file changed instead -- equivalent from checkDuckdbExtMirror's point of view: a mismatch
  // between what's on disk and what the manifest pins).
  it("is red when a file's bytes don't match its pinned sha256 (same length)", () => {
    const manifest = fakeManifest();
    const tampered = Buffer.from(GOOD_A);
    tampered[0] = tampered[0] ^ 0xff; // flip one byte, same length
    const m = makeMirror({
      "v9.9.9/wasm_eh/parquet.duckdb_extension.wasm": tampered,
      "v9.9.9/wasm_mvp/parquet.duckdb_extension.wasm": GOOD_B,
    });
    const reasons = checkDuckdbExtMirror(m, manifest);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/sha256 mismatch:.*wasm_eh/);
  });

  it("is red when a file's byte size doesn't match (reported as a size mismatch, not a hash one)", () => {
    const manifest = fakeManifest();
    const m = makeMirror({
      "v9.9.9/wasm_eh/parquet.duckdb_extension.wasm": Buffer.concat([GOOD_A, Buffer.from("x")]),
      "v9.9.9/wasm_mvp/parquet.duckdb_extension.wasm": GOOD_B,
    });
    const reasons = checkDuckdbExtMirror(m, manifest);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/size mismatch:.*wasm_eh/);
  });

  it("reports one reason per broken file, not just the first", () => {
    const manifest = fakeManifest();
    const m = makeMirror({}); // both missing
    expect(checkDuckdbExtMirror(m, manifest)).toHaveLength(2);
  });

  it("is red (via a thrown ENOENT from loadManifest, not a silent pass) on a nonexistent manifest path", () => {
    expect(() => loadManifest("/does/not/exist.json")).toThrow();
  });
});

describe("assertMirrorNotInStaticGraph", () => {
  it("is clean on a manifest where duckdb-ext never appears (the real, normal shape)", () => {
    const viteManifest = {
      "index.html": {
        file: "index.html",
        isEntry: true,
        imports: ["src/main.ts"],
      },
      "src/main.ts": {
        file: "assets/index-abc123.js",
        css: ["assets/index-def456.css"],
        assets: ["assets/favicon-ghi789.svg"],
      },
    };
    expect(assertMirrorNotInStaticGraph(viteManifest, "index.html")).toEqual([]);
  });

  // seeded fault: a hypothetical future change that pulls a duckdb-ext file into the STATIC graph
  // (e.g. a stray `import` or a manifest `assets` entry pointing at it) must be caught, not waved
  // through as "just another asset".
  it("is red when a duckdb-ext file is reachable from the entry's static assets", () => {
    const viteManifest = {
      "index.html": { file: "index.html", isEntry: true, imports: ["src/main.ts"] },
      "src/main.ts": {
        file: "assets/index-abc123.js",
        assets: ["duckdb-ext/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm"],
      },
    };
    const reasons = assertMirrorNotInStaticGraph(viteManifest, "index.html");
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/duckdb-ext.*STATIC import graph/);
  });

  it("does NOT flag a duckdb-ext file reachable only via dynamicImports (the correct, lazy path)", () => {
    const viteManifest = {
      "index.html": { file: "index.html", isEntry: true, imports: ["src/main.ts"] },
      "src/main.ts": {
        file: "assets/index-abc123.js",
        dynamicImports: ["src/lib/engine/engine.ts"],
      },
      "src/lib/engine/engine.ts": {
        file: "assets/engine-xyz.js",
        assets: ["duckdb-ext/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm"],
      },
    };
    expect(assertMirrorNotInStaticGraph(viteManifest, "index.html")).toEqual([]);
  });

  it("confirms the REAL dist's manifest is clean, when a build has been run (skips gracefully otherwise)", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const path = "dist/.vite/manifest.json";
    if (!existsSync(path)) return; // no build in this test run -- covered by CI's post-build step
    const viteManifest = JSON.parse(readFileSync(path, "utf8"));
    expect(assertMirrorNotInStaticGraph(viteManifest, "index.html")).toEqual([]);
  });
});
