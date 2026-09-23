// atlas-4 fix round 2 (D13): Shell.svelte used to statically import every lens' panel component
// (ScoresLens, the four species panel/legend/picker/notFound components, Places,
// VersionPickerModal, WelcomeModal) -- 450.4 KB gzip static, 0.4 KB over `scripts/size-budget.mjs`'s
// 450 KB budget, and a species-only deep link downloaded the entire scores lens it never renders
// (measured: `e2e/species.smoke.spec.ts`'s cold first-pixel spec at 2,742 ms). The fix moved every
// `.svelte` PANEL component under `src/lens/**` and `src/places/**` behind a dynamic `import()`,
// chosen by `sel.lens` (Places by `activeTool === "places"`) -- see Shell.svelte's own "lazy
// lens/panel chunks" header comment. This is the SAME source-scan technique
// `tests/places/lazyImports.test.ts` and `tests/geo/upload/lazyImports.test.ts` already use for
// terra-draw/the upload parsers: `npm run build && npm run size-budget` can only prove this AFTER a
// real build; this proves the rule holds in the source, so a re-added static import goes red before
// a build is ever needed to notice.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHELL_PATH = "src/shell/Shell.svelte";
const SHELL_SVELTE = readFileSync(SHELL_PATH, "utf8");
const SHELL_DIR = dirname(fileURLToPath(new URL(`../../${SHELL_PATH}`, import.meta.url)));

/** `import ... from "x"` / `import "x"` at the top level -- NOT `import type` (erased under
 * `verbatimModuleSyntax`, costs nothing at runtime) and NOT `await import("x")`. Same regex as
 * `tests/places/lazyImports.test.ts`/`tests/geo/upload/lazyImports.test.ts`. */
const staticImportsOf = (src: string): string[] =>
  [...src.matchAll(/(?:^|\n)\s*import\s(?!type\s)(?:[^;'"]*?\sfrom\s)?["']([^"']+)["']/g)].map(
    (m) => m[1],
  );

const dynamicImportsOf = (src: string): string[] =>
  [...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);

/** a REAL `.svelte` SFC component reached from `src/lens/**` or `src/places/**` -- as opposed to a
 * plain, runes-using data/wiring module named `*.svelte.ts` (e.g. `state.svelte.ts`,
 * `placesMap.svelte.ts`), whose import specifier ALSO ends in literal ".svelte" once TypeScript's
 * extension is dropped. Disambiguated on disk: an SFC resolves to `<spec>` itself; a `*.svelte.ts`
 * module resolves to `<spec>.ts` instead. Shell.svelte's own header comment explains why the
 * latter is allowed to stay static (needed before a lens' panel component ever mounts, and it
 * never imports a `.svelte` SFC itself). */
const isLensOrPlacesSvelteImport = (spec: string): boolean => {
  if (!/^\.\.\/(lens|places)\//.test(spec) || !spec.endsWith(".svelte")) return false;
  const resolved = resolve(SHELL_DIR, spec);
  return existsSync(resolved) && !existsSync(`${resolved}.ts`);
};

describe("Shell.svelte never statically imports a lens/places .svelte panel component", () => {
  it("Shell.svelte source scan finds nothing (a missing file must not pass vacuously)", () => {
    expect(SHELL_SVELTE.length).toBeGreaterThan(1000);
  });

  it("no static import of a .svelte file under src/lens/ or src/places/", () => {
    const statics = staticImportsOf(SHELL_SVELTE).filter(isLensOrPlacesSvelteImport);
    expect(statics, `statically imports: ${statics.join(", ")}`).toEqual([]);
  });

  it("every lens/places panel component IS reached, but only dynamically", () => {
    const dynamic = dynamicImportsOf(SHELL_SVELTE);
    for (const mod of [
      "../lens/scores/ScoresLens.svelte",
      "../lens/scores/VersionPickerModal.svelte",
      "../lens/scores/WelcomeModal.svelte",
      // 0.10.21 fix 1: the scores lens' MAP-INPUT store (`.svelte.ts`, not an SFC -- see
      // `isLensOrPlacesSvelteImport`'s own comment) is dynamic here TOO, unlike species'
      // `state.svelte` below. It must exist whenever `sel.lens === "scores"` regardless of
      // whether `ScoresLens.svelte` (the panel body) has ever mounted -- that gap (map inputs
      // living only where a possibly-collapsed panel could compute them) was the 0.10.17 bug.
      "../lens/scores/state.svelte",
      "../lens/species/SpeciesLens.svelte",
      "../lens/species/SpeciesPicker.svelte",
      "../lens/species/SpeciesLegend.svelte",
      "../lens/species/NotFoundModal.svelte",
      "../places/Places.svelte",
    ]) {
      expect(dynamic, `Shell.svelte never dynamically imports ${mod}`).toContain(mod);
    }
  });

  // the pure data/wiring modules a lens' panel component needs BEFORE it loads are allowed to stay
  // static -- Shell.svelte's own header comment on `createSpeciesLens`/`createPlacesMapStore`.
  it("the species/places data-layer modules stay static (not svelte files, so not gated here)", () => {
    const statics = staticImportsOf(SHELL_SVELTE);
    expect(statics).toContain("../lens/species/state.svelte");
    expect(statics).toContain("../places/placesMap.svelte");
  });

  // 0.10.21 fix 1: `isLensOrPlacesSvelteImport`'s own disambiguation (a `*.svelte.ts` module is
  // NEVER flagged, on purpose, so species'/places' data layers above can stay static) means a
  // static import of the SCORES lens' `.svelte.ts` data layer would slip past the "no static
  // import of a .svelte panel component" test silently -- extending the scan here, in the source
  // (not only in Shell.svelte's own comment), states the rule this repo actually wants: unlike
  // species, the scores lens' map-input store is heavy enough (pulls `mapInputs.ts`/`boot.ts`/
  // `raster.ts`/`zoneFill.ts` -- `state.svelte.ts`'s own header) that it must be gated OUT of a
  // species-only session's bundle exactly like a `.svelte` panel component would be.
  it("0.10.21: unlike species, the scores lens' data-layer module stays OUT of the statics", () => {
    const statics = staticImportsOf(SHELL_SVELTE);
    expect(statics).not.toContain("../lens/scores/state.svelte");
  });

  it("SEEDED FAULT: the same scan flags a reintroduced static import of ScoresLens.svelte", () => {
    const seeded =
      'import ScoresLens from "../lens/scores/ScoresLens.svelte";\nexport const x = ScoresLens;\n';
    const statics = staticImportsOf(seeded).filter(isLensOrPlacesSvelteImport);
    expect(statics).toContain("../lens/scores/ScoresLens.svelte");
  });

  // 0.10.21: the SAME seeded-fault technique, for the `.svelte.ts` case the test just above polices
  // -- a reintroduced static import of the scores data layer must show up in the raw statics list
  // (not filtered through `isLensOrPlacesSvelteImport`, which would wrongly clear it, per that
  // function's own comment).
  it("SEEDED FAULT: the same scan flags a reintroduced static import of scores/state.svelte", () => {
    const seeded =
      'import { createScoresLens } from "../lens/scores/state.svelte";\n' +
      "export const x = createScoresLens;\n";
    const statics = staticImportsOf(seeded);
    expect(statics).toContain("../lens/scores/state.svelte");
  });
});
