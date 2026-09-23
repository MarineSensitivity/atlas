// The species lens' source-scan gate (atlas-5's review checklist): five tokens that must never
// appear anywhere under src/lens/species/** OR src/lib/map/**, each one the name of a bug this
// phase exists to retire.
//
//   native_asset  the 86,857-row asset registry the shard replaces (and the 21.7 MB / 156 MB
//                 split() blow-up of section 11.1). Nothing in the lens may read it.
//   mdl_bbox      the per-model min/max over the 17 M-row cell table — the app's most expensive
//                 query. The shard carries the extent precomputed.
//   7200 / 3600   global05's hardcoded grid constants, which are WRONG for v1-v7 (usa05 is
//                 3103 x 2006 from 141.10E on a 0-360 frame). The grid is always read from
//                 boot.grid via lib/grid.
//   fitBounds(    the camera is DATA here (camera.ts returns bounds + padding); only the map
//                 module calls the map. A call from the lens is how an unwrapped bbox gets
//                 normalized on the way.
//
// atlas-8: widened on two axes the atlas-5 review carried forward as an unpinned gap.
// (1) SCOPE: the scan used to cover only src/lens/species/**, so a hardcoded 7200/3600 or a
//     fitBounds( call moved one directory up into src/lib/map/** (which the species lens also
//     calls into) was invisible to it. docs/map.md's own contract already forbids fitBounds(
//     everywhere under src/lib/map (tests/map/no-fitbounds.test.ts) -- this file's job is the
//     other four tokens, which had no map-module coverage at all.
// (2) ALIASING: a plain per-file text scan cannot see `export const NC = 7200` in one file and
//     `import { NC } from "./constants"; ...nc: NC...` in another -- the literal "7200" never
//     appears in the importing file's own text. `findForbiddenTokens` now follows ONE hop of
//     relative imports per scanned file (resolving `.ts`/`.svelte`/`/index.ts`, the same
//     extension-guessing scripts/parity/ts-resolve.mjs uses for a bundler-style repo) and scans
//     the resolved target's text too, attributing the hit to the file that imported it.
//
// Written as a scanner over a root directory so the seeded-fault fixture below can plant each token
// in a temp tree and prove the check really fails — same shape as tests/raster/ramps.wiring.test.ts.
import {
  existsSync,
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
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCANNED_DIRS = [join("src", "lens", "species"), join("src", "lib", "map")];

/** every forbidden token, with the reason it is forbidden (printed on failure). */
export const FORBIDDEN_TOKENS: [token: string, why: string][] = [
  ["native_asset", "the asset registry the taxon shard replaces"],
  ["mdl_bbox", "the bbox aggregate the precomputed extent replaces"],
  ["7200", "a hardcoded global05 grid constant (wrong for v1-v7)"],
  ["3600", "a hardcoded global05 grid constant (wrong for v1-v7)"],
  ["fitBounds(", "the lens returns camera DATA; only the map module calls the map"],
];

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

/** every RELATIVE import specifier textually present in `source` (bare/package specifiers are
 * out of scope: an alias smuggled in through a dependency is a different problem). */
function relativeImportSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /\bfrom\s+["'](\.[^"']+)["']/g;
  for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

/** resolve a relative import specifier from `fromFile`'s directory to a real file on disk, the
 * same extension-guessing a bundler-resolution repo needs (no `.ts` on an extensionless import). */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.svelte`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** strips line and block comments before token-matching: the rule is about a token USED as a
 * value, not one merely discussed. Load-bearing once the scan follows an import one hop --
 * grid.ts's own header comment explains, in prose, exactly why 7200/3600 must never be
 * hardcoded, and transitively scanning its RAW text without this would flag that explanation as
 * a violation of the rule it is stating. A best-effort strip (not a real parser), same tolerance
 * every other plain-text scanner in this repo already accepts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

export function findForbiddenTokens(
  rootDir: string,
): { path: string; line: number; token: string; why: string; via?: string }[] {
  const hits: { path: string; line: number; token: string; why: string; via?: string }[] = [];
  const scan = (file: string, rel: string, via?: string) => {
    if (!/\.(ts|svelte|js)$/.test(file) || !existsSync(file)) return;
    const raw = readFileSync(file, "utf8");
    stripComments(raw)
      .split("\n")
      .forEach((line, i) => {
        for (const [token, why] of FORBIDDEN_TOKENS) {
          if (line.includes(token)) hits.push({ path: rel, line: i + 1, token, why, via });
        }
      });
    // one hop only: an alias two levels removed is a different (unbounded) problem, and one hop
    // already closes the gap the atlas-5 review actually found (a constant re-exported from a
    // sibling module one import away).
    if (via) return;
    for (const spec of relativeImportSpecifiers(raw)) {
      const target = resolveImport(file, spec);
      if (target) scan(target, relative(rootDir, target), rel);
    }
  };
  for (const dir of SCANNED_DIRS) {
    for (const file of walk(join(rootDir, dir))) scan(file, relative(rootDir, file));
  }
  return hits;
}

describe("src/lens/species/** and src/lib/map/** contain none of the five retired tokens", () => {
  it("scans a non-empty set of files (a vacuous pass is a failed gate)", () => {
    for (const dir of SCANNED_DIRS) {
      expect(
        walk(join(REPO_ROOT, dir)).filter((f) => f.endsWith(".ts")).length,
        `${dir} should contain real source files`,
      ).toBeGreaterThan(3);
    }
  });

  it("finds zero hits in the real lens and map module", () => {
    const hits = findForbiddenTokens(REPO_ROOT);
    expect(
      hits.map(
        (h) => `${h.path}:${h.line} '${h.token}' — ${h.why}${h.via ? ` (via ${h.via})` : ""}`,
      ),
      "a retired token is back in the species lens or the map module",
    ).toEqual([]);
  });
});

describe("the gate can fail (seeded fault)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function fixture(contents: string, lensDir = join("src", "lens", "species")): string {
    const root = mkdtempSync(join(tmpdir(), "species-scan-"));
    dirs.push(root);
    const dir = join(root, lensDir, "data");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "planted.ts"), contents);
    return root;
  }

  for (const [token, why] of FORBIDDEN_TOKENS) {
    it(`catches '${token}' (${why}) under src/lens/species/**`, () => {
      const hits = findForbiddenTokens(fixture(`export const x = "${token}";\n`));
      expect(hits.map((h) => h.token)).toContain(token);
    });

    it(`catches '${token}' under src/lib/map/** too (the widened scope)`, () => {
      const hits = findForbiddenTokens(
        fixture(`export const x = "${token}";\n`, join("src", "lib", "map")),
      );
      expect(hits.map((h) => h.token)).toContain(token);
    });
  }

  it("passes a clean tree", () => {
    expect(findForbiddenTokens(fixture("export const x = 1;\n"))).toEqual([]);
  });

  it("catches a constant ALIASED one import hop away (the aliasing gap)", () => {
    // `constants.ts` never appears under the scanned lens dir at all -- only a re-export of it
    // does, one relative import away. A plain per-file text scan sees neither "7200" nor "3600"
    // anywhere under src/lens/species/**; this is exactly the gap the atlas-5 review named.
    const root = mkdtempSync(join(tmpdir(), "species-scan-alias-"));
    dirs.push(root);
    const grid = join(root, "src", "lib", "grid");
    mkdirSync(grid, { recursive: true });
    writeFileSync(join(grid, "constants.ts"), "export const GLOBAL05_NC = 7200;\n");
    const lens = join(root, "src", "lens", "species", "data");
    mkdirSync(lens, { recursive: true });
    writeFileSync(
      join(lens, "usesAlias.ts"),
      'import { GLOBAL05_NC } from "../../../lib/grid/constants";\nexport const nc = GLOBAL05_NC;\n',
    );
    const hits = findForbiddenTokens(root);
    expect(hits.map((h) => h.token)).toContain("7200");
    expect(hits.find((h) => h.token === "7200")?.via).toBe(
      join("src", "lens", "species", "data", "usesAlias.ts"),
    );
  });

  it("does NOT follow a bare/package import (out of scope, not a false negative worth chasing)", () => {
    const root = mkdtempSync(join(tmpdir(), "species-scan-bare-"));
    dirs.push(root);
    const lens = join(root, "src", "lens", "species", "data");
    mkdirSync(lens, { recursive: true });
    writeFileSync(
      lens + "/usesPkg.ts",
      'import { NC } from "some-package";\nexport const nc = NC;\n',
    );
    expect(findForbiddenTokens(root)).toEqual([]);
  });
});
