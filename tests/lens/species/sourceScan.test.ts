// The species lens' source-scan gate (atlas-5's review checklist): five tokens that must never
// appear anywhere under src/lens/species/**, each one the name of a bug this phase exists to retire.
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
// Written as a scanner over a root directory so the seeded-fault fixture below can plant each token
// in a temp tree and prove the check really fails — same shape as tests/raster/ramps.wiring.test.ts.
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
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const LENS_DIR = join("src", "lens", "species");

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

export function findForbiddenTokens(
  rootDir: string,
): { path: string; line: number; token: string; why: string }[] {
  const hits: { path: string; line: number; token: string; why: string }[] = [];
  for (const file of walk(join(rootDir, LENS_DIR))) {
    if (!/\.(ts|svelte|js)$/.test(file)) continue;
    const rel = relative(rootDir, file);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, i) => {
        for (const [token, why] of FORBIDDEN_TOKENS) {
          if (text.includes(token)) hits.push({ path: rel, line: i + 1, token, why });
        }
      });
  }
  return hits;
}

describe("src/lens/species/** contains none of the five retired tokens", () => {
  it("scans a non-empty set of files (a vacuous pass is a failed gate)", () => {
    expect(walk(join(REPO_ROOT, LENS_DIR)).filter((f) => f.endsWith(".ts")).length).toBeGreaterThan(
      4,
    );
  });

  it("finds zero hits in the real lens", () => {
    const hits = findForbiddenTokens(REPO_ROOT);
    expect(
      hits.map((h) => `${h.path}:${h.line} '${h.token}' — ${h.why}`),
      "a retired token is back in the species lens",
    ).toEqual([]);
  });
});

describe("the gate can fail (seeded fault)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function fixture(contents: string): string {
    const root = mkdtempSync(join(tmpdir(), "species-scan-"));
    dirs.push(root);
    const dir = join(root, LENS_DIR, "data");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "planted.ts"), contents);
    return root;
  }

  for (const [token, why] of FORBIDDEN_TOKENS) {
    it(`catches '${token}' (${why})`, () => {
      const hits = findForbiddenTokens(fixture(`export const x = "${token}";\n`));
      expect(hits.map((h) => h.token)).toContain(token);
    });
  }

  it("passes a clean tree", () => {
    expect(findForbiddenTokens(fixture("export const x = 1;\n"))).toEqual([]);
  });
});
