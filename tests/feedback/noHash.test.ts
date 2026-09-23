// Deliverable 4's own copy of tests/analytics/noRawLocation.wiring.test.ts's technique: the URL
// `feedbackIssueUrl` reports is passed in by the CALLER (Shell.svelte builds it from the reactive
// `Sel`, via `formatSel(sel).search` -- never `location.search` -- and hands `pageUrlFromLocation` a
// plain object) precisely so nothing under src/lib/feedback/ ever has to read the live page
// location itself. This scans the whole directory (code AND comments) for the three ways that
// discipline could regress: a literal `location.href`/`location.hash` read (the fragment leaks), or
// `window.location` (the same live global by another name). Zero occurrences allowed.
//
// SEEDED FAULT, wired into `npm run test:faults` (tests/faults/feedback-location-href.patch):
// `pageUrlFromLocation` rewritten to ignore its `loc` argument and `return location.href` instead --
// in a real browser this reads the SAME live page location Shell.svelte already holds as `loc`, so
// it silently starts leaking the hash (a drawn place's geometry) into the "Report a problem" link.
// That patch turns THIS test red (the literal substring appears in the real, shipped file) AND turns
// e2e/feedback.spec.ts red (the control's real `href` now contains the hash) -- see this repo's
// GATES.md, pattern 3.
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
const FEEDBACK_DIR = join("src", "lib", "feedback");

const FORBIDDEN_PATTERNS = ["location.href", "location.hash", "window.location"];

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

/** scans every file under `<rootDir>/src/lib/feedback` for a forbidden literal substring. */
export function findRawLocationReferences(
  rootDir: string,
): { path: string; line: number; match: string }[] {
  const hits: { path: string; line: number; match: string }[] = [];
  for (const file of walk(join(rootDir, FEEDBACK_DIR))) {
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

describe("src/lib/feedback never references the live page location's href/hash, or window.location", () => {
  it("finds zero occurrences across the real directory, code or comments", () => {
    expect(findRawLocationReferences(REPO_ROOT)).toEqual([]);
  });
});

describe("findRawLocationReferences — seeded fault (one of the three tokens planted, even in a comment)", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function makeFixtureRoot(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "atlas-feedback-no-hash-"));
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    return dir;
  }

  it("goes RED on a real reference to location.href (the exact Deliverable 4 seeded fault)", () => {
    const root = makeFixtureRoot({
      "src/lib/feedback/issueUrl.ts": `export function pageUrlFromLocation() { return location.href; }\n`,
    });
    const hits = findRawLocationReferences(root);
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe("location.href");
  });

  it("goes RED even when the token is only inside a comment", () => {
    const root = makeFixtureRoot({
      "src/lib/feedback/rogue.ts": `// TODO: maybe read location.hash someday\nexport const ok = 1;\n`,
    });
    expect(findRawLocationReferences(root).length).toBeGreaterThan(0);
  });

  it("goes RED on window.location", () => {
    const root = makeFixtureRoot({
      "src/lib/feedback/a.ts": `export const a = window.location.pathname;\n`,
    });
    const hits = findRawLocationReferences(root);
    expect(hits.map((h) => h.match)).toEqual(["window.location"]);
  });

  it("stays GREEN for a clean fixture tree, and ignores files outside src/lib/feedback", () => {
    const root = makeFixtureRoot({
      "src/lib/feedback/fine.ts": `export const ok = 1;\n`,
      "src/lib/release/other.ts": `export const bad = location.href;\n`, // outside this gate's scope
    });
    expect(findRawLocationReferences(root)).toEqual([]);
  });

  it("does not false-positive on the unrelated origin/pathname/search fields", () => {
    const root = makeFixtureRoot({
      "src/lib/feedback/fine.ts": `export const p = loc.origin + loc.pathname + loc.search;\n`,
    });
    expect(findRawLocationReferences(root)).toEqual([]);
  });
});
