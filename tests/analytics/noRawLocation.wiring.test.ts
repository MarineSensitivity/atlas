// Fix round 1 gate: src/lib/analytics/** must never reference the live page location's `href` or
// fragment (`hash`) fields, or the document's own URL/location globals, ANYWHERE — not just outside
// a string literal, but nowhere in the file text at all (including comments), because gtag.js's own
// automatic behaviors (the config-triggered page_view, and — if a GA4 dashboard property setting is
// left on, see docs/analytics.md — its history-event page views) read the live browser location
// internally, bypassing anything this module computes. The only way to be sure this module never
// grows a code path that hands gtag.js a live reference is to keep the literal tokens for those
// globals out of the directory entirely, so a reviewer (or this test) can grep for them mechanically.
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
const ANALYTICS_DIR = join("src", "lib", "analytics");

// each pattern is matched as a literal substring, not a regex — a dotted property access or a
// dotted global name, exactly as it would appear in real code OR in a comment describing it.
const FORBIDDEN_PATTERNS = ["location.href", "location.hash", "document.URL", "document.location"];

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

/** scans every file under `<rootDir>/src/lib/analytics` for a forbidden literal substring. */
export function findRawLocationReferences(
  rootDir: string,
): { path: string; line: number; match: string }[] {
  const hits: { path: string; line: number; match: string }[] = [];
  for (const file of walk(join(rootDir, ANALYTICS_DIR))) {
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

describe("src/lib/analytics never references the live page location's href/fragment or document.URL/location", () => {
  it("finds zero occurrences across the real directory, code or comments", () => {
    expect(findRawLocationReferences(REPO_ROOT)).toEqual([]);
  });
});

describe("findRawLocationReferences — seeded fault (one of the four tokens planted, even in a comment)", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function makeFixtureRoot(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "atlas-no-raw-location-"));
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    return dir;
  }

  it("goes RED on a real reference to location.href", () => {
    const root = makeFixtureRoot({
      "src/lib/analytics/rogue.ts": `export const bad = location.href;\n`,
    });
    const hits = findRawLocationReferences(root);
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe("location.href");
  });

  it("goes RED even when the token is only inside a comment", () => {
    const root = makeFixtureRoot({
      "src/lib/analytics/rogue.ts": `// TODO: maybe read location.hash someday\nexport const ok = 1;\n`,
    });
    expect(findRawLocationReferences(root).length).toBeGreaterThan(0);
  });

  it("goes RED on document.location and document.URL", () => {
    const root = makeFixtureRoot({
      "src/lib/analytics/a.ts": `export const a = document.location;\n`,
      "src/lib/analytics/b.ts": `export const b = document.URL;\n`,
    });
    const hits = findRawLocationReferences(root);
    expect(hits.map((h) => h.match).sort()).toEqual(["document.URL", "document.location"]);
  });

  it("stays GREEN for a clean fixture tree, and ignores files outside src/lib/analytics", () => {
    const root = makeFixtureRoot({
      "src/lib/analytics/fine.ts": `export const ok = 1;\n`,
      "src/lib/release/other.ts": `export const bad = location.href;\n`, // outside this gate's scope
    });
    expect(findRawLocationReferences(root)).toEqual([]);
  });

  it("does not false-positive on the unrelated location.origin/pathname/search fields", () => {
    const root = makeFixtureRoot({
      "src/lib/analytics/fine.ts": `export const p = loc.origin + loc.pathname + loc.search;\n`,
    });
    expect(findRawLocationReferences(root)).toEqual([]);
  });
});
