// atlas-8 step 5 / Deliverable 2: the evidence verifier behind `docs/parity.html`.
//
// The review rule for this page is "never claim a test that does not exist". So evidence is not a
// free-text cell: every entry names a FILE and the literal TITLE of a `describe`/`it`/`test` in it,
// and `verifyEvidence()` re-reads the file and fails the build when that title is not there. A
// renamed or deleted test therefore breaks the page's generation instead of leaving the page
// asserting something that no longer runs.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** `it("...")` / `test("...")` / `describe("...")`, single- or double-quoted, plus backtick titles
 * (whose `${...}` parts stay literal — a dynamic title is matched on its static prefix). */
const TITLE_RE = /\b(?:describe|it|test)(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

/**
 * A test index: every test file (repo-relative) mapped to the titles it declares.
 *
 * @typedef {Record<string, string[]>} TestIndex
 */

/**
 * Collect every spec/test file under `dir` (recursively).
 *
 * @param {string} root
 * @param {string} [dir]
 * @param {string[]} [out]
 * @returns {string[]} absolute paths
 */
export function listTestFiles(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listTestFiles(root, p, out);
    else if (/\.(test|spec)\.[cm]?[jt]s$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Every `describe`/`it`/`test` title in one file, in source order.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function titlesIn(source) {
  /** @type {string[]} */
  const out = [];
  for (const m of source.matchAll(TITLE_RE)) out.push(m[2]);
  return out;
}

/**
 * Build `{ "<relative path>": ["title", ...] }` for every test file under the repo root.
 *
 * @param {string} repoRoot
 * @param {string[]} [dirs]
 * @returns {TestIndex}
 */
export function buildTestIndex(repoRoot, dirs = ["tests", "e2e", "scripts"]) {
  /** @type {TestIndex} */
  const index = {};
  for (const d of dirs) {
    let files;
    try {
      files = listTestFiles(join(repoRoot, d));
    } catch {
      continue;
    }
    for (const f of files) {
      index[relative(repoRoot, f)] = titlesIn(readFileSync(f, "utf8"));
    }
  }
  return index;
}

/**
 * Check every evidence reference against the index.
 *
 * @param {{id: string, evidence?: import("./status.mjs").Evidence[]}[]} rows
 * @param {TestIndex} index
 * @returns {string[]} human-readable problems; empty = every reference resolves
 */
export function verifyEvidence(rows, index) {
  /** @type {string[]} */
  const problems = [];
  for (const row of rows) {
    for (const ev of row.evidence ?? []) {
      if (ev.file === "no test") continue;
      const titles = index[ev.file];
      if (!titles) {
        problems.push(`${row.id}: no such test file "${ev.file}"`);
        continue;
      }
      // The claimed name must be a title, or a distinctive SUBSTRING of one (titles are long and a
      // reference often quotes the part that matters). The reverse — a short title contained in a
      // long claim — is NOT accepted, or a two-word title like "map" would validate any sentence
      // containing it; the one exception is a dynamic title, which is referenced by its literal
      // static prefix.
      const ok = titles.some((t) => {
        if (t.includes(ev.name)) return true;
        const brace = t.indexOf("${");
        if (brace > 8) return ev.name.startsWith(t.slice(0, brace));
        return false;
      });
      if (!ok) problems.push(`${row.id}: "${ev.name}" is not a test title in ${ev.file}`);
    }
  }
  return problems;
}
