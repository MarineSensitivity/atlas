// "No module in src/lib imports `svelte` except state/" (atlas-2 Gates): the runtime — grid math,
// the place codec, the coverage twin — has to stay callable under plain Node, by Vitest here and by
// scripts/parity/ later. A single `import { $state } ...` would make every one of those untestable
// outside a browser bundle.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOTS = ["src/lib/grid", "src/lib/geo"]; // the directories this phase owns
const repo = fileURLToPath(new URL("../", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".svelte")) out.push(p);
  }
  return out;
}

describe("src/lib/{grid,geo} — plain TypeScript, runnable under Node", () => {
  const files = ROOTS.flatMap((r) => walk(join(repo, r)));

  it("finds the modules (an empty walk must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const f of files) {
    it(`${f.slice(repo.length)} does not import svelte`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/\bfrom\s+["']svelte(\/[\w-]+)?["']/);
      expect(src).not.toMatch(/\bimport\s+["']svelte(\/[\w-]+)?["']/);
      expect(src).not.toMatch(/\brequire\(\s*["']svelte/);
      expect(f.endsWith(".svelte")).toBe(false); // nor is any of them a component
    });
  }
});
