// GATE (atlas-6 step 2): terra-draw and its MapLibre adapter are reached ONLY through
// `places/draw.ts`'s dynamic `import()` -- CLAUDE.md's "terra-draw* is a forbidden static marker
// ... it MUST be a lazy chunk". Same technique as `tests/geo/upload/lazyImports.test.ts` (a source
// scan, not just the build-time budget check, because nothing under `src/` reaches `draw.ts` in a
// static import graph today for the budget checker to walk — this holds the rule before the panel
// wires drawing into the entry).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const placesDir = fileURLToPath(new URL("../../src/places/", import.meta.url));
const PINNED = ["terra-draw", "terra-draw-maplibre-gl-adapter"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".svelte")) out.push(p);
  }
  return out;
}

/** `import ... from "x"` / `import "x"` at the top level -- NOT `import type` (erased under
 * `verbatimModuleSyntax`, costs nothing at runtime -- draw.ts's own type-only `TerraDrawEventListeners`
 * import relies on this exact exception) and NOT `await import("x")`. */
const staticImportsOf = (src: string): string[] =>
  [...src.matchAll(/(?:^|\n)\s*import\s(?!type\s)(?:[^;'"]*?\sfrom\s)?["']([^"']+)["']/g)].map(
    (m) => m[1],
  );

const dynamicImportsOf = (src: string): string[] =>
  [...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);

const files = walk(placesDir).map((p) => [p, readFileSync(p, "utf8")] as const);

describe("terra-draw and its adapter are dynamic imports, never static", () => {
  it("finds source files (an empty walk must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const [file, src] of files) {
    it(`${file.slice(placesDir.length)} imports no pinned draw library statically`, () => {
      const statics = staticImportsOf(src);
      for (const pkg of PINNED)
        expect(statics, `${file} statically imports ${pkg}`).not.toContain(pkg);
    });
  }

  it("draw.ts reaches both libraries dynamically", () => {
    const [, src] = files.find(([f]) => f.endsWith("draw.ts"))!;
    const dyn = dynamicImportsOf(src);
    expect(dyn).toContain("terra-draw");
    expect(dyn).toContain("terra-draw-maplibre-gl-adapter");
  });

  it("SEEDED FAULT: the same scan flags a static import", () => {
    const seeded = 'import { TerraDraw } from "terra-draw";\nexport const x = TerraDraw;\n';
    expect(staticImportsOf(seeded)).toContain("terra-draw");
  });
});
