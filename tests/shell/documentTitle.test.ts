// GATE (atlas-8, one of the "known unpinned rules" the handover named): `document.title` must
// have exactly ONE writer in the whole app. Before this fix, Shell.svelte and
// src/lens/species/state.svelte.ts each ran an independent `$effect` writing it -- with different
// reactive dependencies, so either could re-fire and stomp the other's title depending on
// Svelte's own effect-scheduling order (atlas-5's closing review flagged this; no test pinned it
// until now). A plain source scan is the available proxy here, the same technique
// tests/state/invariants.test.ts uses for `pushState` and tests/shell/shell-invariants.test.ts
// already uses for this exact file: a real `document.title` write can't be observed by invoking
// code under vitest's node environment.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");
// the ONE file allowed to write it (Shell.svelte's own header comment names it as such).
const ALLOWED_WRITER = "src/shell/Shell.svelte";

/** an ASSIGNMENT (`document.title = ...`), never a comparison (`document.title === ...`) or a
 * mention in prose -- the negative lookahead excludes a second `=` right after the first. */
const WRITE_RE = /\bdocument\.title\s*=[^=]/;

function listFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (/\.(ts|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

/** every file under `src/` that assigns `document.title`, relative to the repo root. */
export function findDocumentTitleWriters(root: string): string[] {
  const out: string[] = [];
  for (const file of listFiles(join(root, "src"))) {
    if (WRITE_RE.test(readFileSync(file, "utf8"))) out.push(relative(root, file));
  }
  return out.sort();
}

describe("document.title has exactly one writer", () => {
  it("is not vacuous: src/ really contains .ts/.svelte files", () => {
    expect(listFiles(SRC).length).toBeGreaterThan(20);
  });

  it("the only writer is Shell.svelte", () => {
    expect(findDocumentTitleWriters(ROOT)).toEqual([ALLOWED_WRITER]);
  });

  it("species/state.svelte.ts computes docTitle but does not write document.title itself", () => {
    const text = readFileSync(join(SRC, "lens/species/state.svelte.ts"), "utf8");
    expect(WRITE_RE.test(text)).toBe(false);
    expect(text).toContain("docTitle"); // still computed and exposed -- Shell.svelte reads it
  });
});

describe("the gate can fail (seeded fault)", () => {
  it("catches a SECOND writer planted anywhere under src/", () => {
    // same shape as tests/map/no-fitbounds.test.ts's fitbounds-fault fixture: a committed,
    // permanent fixture directory is unnecessary here since the scan target (src/) is real and
    // large -- the fault is a fresh temp file, proving the scanner's own logic (not a stale
    // fixture) still flags a second writer.
    const root = mkdtempSync(join(tmpdir(), "doctitle-fault-"));
    try {
      const dir = join(root, "src", "shell");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "Shell.svelte"), 'document.title = "one";\n');
      const other = join(root, "src", "planted");
      mkdirSync(other, { recursive: true });
      writeFileSync(join(other, "second.ts"), 'document.title = "two";\n');
      expect(findDocumentTitleWriters(root)).toEqual([
        "src/planted/second.ts",
        "src/shell/Shell.svelte",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not flag a comparison or a prose mention, only an assignment", () => {
    const root = mkdtempSync(join(tmpdir(), "doctitle-clean-"));
    try {
      const dir = join(root, "src", "x");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "clean.ts"),
        "// document.title is read elsewhere\nif (document.title === x) {}\n",
      );
      expect(findDocumentTitleWriters(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
