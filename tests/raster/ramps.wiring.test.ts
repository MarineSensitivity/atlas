// Wiring gate for raster/ramps.ts's module contract: "THE ONLY place a color ramp is defined." A
// hex-literal color (or an array of them) anywhere else under src/ is a sign that some other file is
// (re)defining a ramp/palette instead of importing ramps.ts. `src/lib/brand/**` is exempt — brand
// tokens are a SEPARATE, already-governed exception (scripts/check-hex-literals.mjs), not a ramp.
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
const HEX_LITERAL_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const BRAND_PREFIX = join("src", "lib", "brand"); // governed separately by check-hex-literals.mjs

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

/** scans `<rootDir>/src` (excluding src/lib/brand/**, ramps.ts's own governed exception) for a bare
 * hex color literal — the heuristic for "a second ramp or palette array". */
export function findRampLiteralsOutsideRamps(
  rootDir: string,
): { path: string; line: number; match: string }[] {
  const hits: { path: string; line: number; match: string }[] = [];
  for (const file of walk(join(rootDir, "src"))) {
    const rel = relative(rootDir, file);
    if (rel.startsWith(BRAND_PREFIX)) continue;
    if (!/\.(ts|svelte|js)$/.test(file)) continue;
    const content = readFileSync(file, "utf8");
    content.split("\n").forEach((text, i) => {
      for (const m of text.matchAll(HEX_LITERAL_RE)) {
        hits.push({ path: rel, line: i + 1, match: m[0] });
      }
    });
  }
  return hits;
}

describe("raster/ramps.ts is the only ramp/palette definition under src/ (brand/** excepted)", () => {
  it("finds zero hex-literal colors anywhere under src/ outside src/lib/brand/**", () => {
    expect(findRampLiteralsOutsideRamps(REPO_ROOT)).toEqual([]);
  });

  it("ramps.ts itself contains no hardcoded hex stops — palette colors come from boot.json only", () => {
    const content = readFileSync(join(REPO_ROOT, "src/lib/raster/ramps.ts"), "utf8");
    expect(content.match(HEX_LITERAL_RE)).toBeNull();
  });
});

describe("findRampLiteralsOutsideRamps — seeded fault (a second ramp planted outside ramps.ts)", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function makeFixtureRoot(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "atlas-ramp-wiring-"));
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    return dir;
  }

  it("goes RED when a second palette array is planted in an unrelated src/ file", () => {
    const root = makeFixtureRoot({
      "src/lens/scores/legend.ts": `export const rogueRamp = ["#9E0142", "#D53E4F", "#3288BD"];\n`,
    });
    const hits = findRampLiteralsOutsideRamps(root);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe(join("src", "lens", "scores", "legend.ts"));
  });

  it("stays GREEN for a clean fixture tree with no stray hex literals", () => {
    const root = makeFixtureRoot({
      "src/lib/raster/ramps.ts": `export const noop = 1;\n`,
      "src/lens/scores/legend.ts": `export const label = "spectral_r";\n`,
    });
    expect(findRampLiteralsOutsideRamps(root)).toEqual([]);
  });

  it("stays GREEN for a hex literal under src/lib/brand/** (governed by check-hex-literals.mjs instead)", () => {
    const root = makeFixtureRoot({
      "src/lib/brand/tokens.css": `:root { --brand-navy: #0b2a4a; }\n`,
    });
    expect(findRampLiteralsOutsideRamps(root)).toEqual([]);
  });
});
