// The source-scan gate: EVERY parser library under src/lib/geo/upload/parsers/ is reached through
// a dynamic `import()`, never a static one.
//
// Why a source scan when `scripts/size-budget.mjs` already greps the built entry's static graph:
// the budget checker can only see what index.html actually reaches. Nothing in `src/` imports the
// upload pipeline yet (atlas-6 step 3's UI half is a separate agent), so a static
// `import shp from "shpjs"` here would pass the budget today and fail the day the panel lands —
// 46.7 KB gzip onto the critical path, at the worst possible moment to discover it. This file reads
// the source instead, so the rule holds before anything imports it. (`npm run build && npm run
// size-budget` is still run: the two gates cover different halves of the same rule.)
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const parsersDir = fileURLToPath(new URL("../../../src/lib/geo/upload/parsers/", import.meta.url));
const uploadDir = fileURLToPath(new URL("../../../src/lib/geo/upload/", import.meta.url));

/** the pinned parser libraries — package.json's `pinReasons` is the list, not a memory of it. */
const PINNED = ["shpjs", "@tmcw/togeojson", "flatgeobuf"];

const sourcesIn = (dir: string): [string, string][] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => [e.name, readFileSync(`${dir}${e.name}`, "utf8")]);

const parserSources = sourcesIn(parsersDir);
const uploadSources = [...sourcesIn(uploadDir), ...parserSources];

/**
 * `import ... from "x"` / `import "x"` at the top level — NOT `await import("x")`.
 *
 * `import type` is excluded on purpose: with `verbatimModuleSyntax` a type-only import is erased
 * before the bundler ever sees it, so it costs nothing at runtime. `parsers/index.ts` relies on
 * that to name the GeoPackage and XML dependency types while still loading every parser lazily.
 */
const staticImportsOf = (src: string): string[] =>
  [...src.matchAll(/(?:^|\n)\s*import\s(?!type\s)(?:[^;'"]*?\sfrom\s)?["']([^"']+)["']/g)].map(
    (m) => m[1],
  );

const dynamicImportsOf = (src: string): string[] =>
  [...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);

describe("every parser library is a dynamic import", () => {
  it("finds the parser sources at all (an empty directory must not pass vacuously)", () => {
    expect(parserSources.map(([n]) => n).sort()).toEqual([
      "flatgeobuf.ts",
      "geojson.ts",
      "geopackage.ts",
      "gpx.ts",
      "index.ts",
      "kml.ts",
      "shapefile.ts",
      "shpjs.d.ts",
      "wkt.ts",
      "xml.ts",
    ]);
  });

  for (const [name, src] of parserSources) {
    it(`${name} imports no pinned parser statically`, () => {
      const statics = staticImportsOf(src);
      for (const pkg of PINNED) {
        expect(statics, `${name} statically imports ${pkg}`).not.toContain(pkg);
        expect(
          statics.some((s) => s.startsWith(`${pkg}/`)),
          `${name} deep-imports ${pkg}`,
        ).toBe(false);
      }
    });
  }

  it("each pinned parser IS reached, dynamically, by exactly the module that owns it", () => {
    const dynamic = new Map(parserSources.map(([n, s]) => [n, dynamicImportsOf(s)]));
    expect(dynamic.get("shapefile.ts")).toContain("shpjs");
    expect(dynamic.get("kml.ts")).toContain("@tmcw/togeojson");
    expect(dynamic.get("gpx.ts")).toContain("@tmcw/togeojson");
    expect(dynamic.get("flatgeobuf.ts")?.some((s) => s.startsWith("flatgeobuf/"))).toBe(true);
    // WKT is hand-rolled by verdict: no dependency to import at all
    expect(dynamic.get("wkt.ts") ?? []).toHaveLength(0);
  });

  it("the dispatcher reaches every parser module dynamically too", () => {
    const [, index] = parserSources.find(([n]) => n === "index.ts")!;
    for (const mod of [
      "./geojson",
      "./shapefile",
      "./kml",
      "./gpx",
      "./flatgeobuf",
      "./wkt",
      "./geopackage",
    ]) {
      expect(dynamicImportsOf(index), mod).toContain(mod);
    }
    expect(staticImportsOf(index).filter((s) => s.startsWith("./"))).toEqual([]);
  });

  it("nothing anywhere under upload/ statically imports a pinned parser", () => {
    for (const [name, src] of uploadSources) {
      for (const pkg of PINNED) {
        expect(
          staticImportsOf(src).some((s) => s === pkg || s.startsWith(`${pkg}/`)),
          name,
        ).toBe(false);
      }
    }
  });

  it("nor does the upload pipeline pull in DuckDB: the GeoPackage engine is INJECTED", () => {
    // S4 rule 2 and D14: `spatial` is lazy, consented and best-effort, so `parsers/geopackage.ts`
    // takes a structural runtime and never imports @duckdb/duckdb-wasm itself
    for (const [name, src] of uploadSources) {
      expect(staticImportsOf(src), name).not.toContain("@duckdb/duckdb-wasm");
      expect(dynamicImportsOf(src), name).not.toContain("@duckdb/duckdb-wasm");
    }
  });

  it("the scan can actually fail: a static import of a pinned parser is detected", () => {
    // the seeded fault for THIS gate — a check that cannot fail is not a check
    const seeded = 'import shp from "shpjs";\nexport const x = shp;\n';
    expect(staticImportsOf(seeded)).toContain("shpjs");
    expect(dynamicImportsOf('const shp = (await import("shpjs")).default;')).toContain("shpjs");
    expect(staticImportsOf('const shp = (await import("shpjs")).default;')).toEqual([]);
  });
});
