// atlas-3 step 2: generates src/lib/ui/icon-paths.ts from @mdi/js (by export name) and the bespoke
// flower glyph. docs/design/spec.md §6 is the canonical name -> source table this reads from.
//
// Two rules this generator exists to enforce (spec §6, learned the hard way):
//   1. Import @mdi/js BY EXPORT NAME; never transcribe path data by hand. A first attempt typed 16
//      "MDI" paths from memory and 0 of 16 matched. `resolveIconPaths` throws if `@mdi/js` has no
//      such export, so a wrong name is a build error, not a wrong picture.
//   2. Bespoke glyphs are read from their own .svg source (src/lib/brand/glyphs/*.svg), never
//      retyped by hand.
//
// `generateIconPathsSource()` is a PURE function: given an already-resolved name -> path map, it
// returns the formatted file text, via prettier's own API, so the output is byte-identical to what
// `prettier --write` would produce and the regeneration test never has to shell out (a shell-out
// test previously rewrote the tracked file during `vitest run` — see tests/icon-paths.test.ts).
// Importing this module writes nothing; only `main()`, guarded at the bottom, touches the
// filesystem, and only when the script is run directly.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import prettier from "prettier";

export const ICON_MAP_FILE = "scripts/icon-map.json";
export const FLOWER_SVG_FILE = "src/lib/brand/glyphs/flower.svg";
export const OUTPUT_FILE = "src/lib/ui/icon-paths.ts";
const PRETTIER_CONFIG_FILE = ".prettierrc.json";

/** Pull the single `d` attribute out of a one-path glyph SVG (never hand-transcribed). */
export function glyphPathFromSvg(svg) {
  const all = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  if (all.length !== 1) {
    throw new Error(`expected exactly one <path d="..."> in the glyph, found ${all.length}`);
  }
  return all[0];
}

/**
 * Resolve the full name -> path map from @mdi/js (by export name) plus the bespoke glyphs.
 * @param {Record<string,string>} iconMap app icon name -> @mdi/js export name (scripts/icon-map.json)
 * @param {Record<string,string>} mdiModule the imported `@mdi/js` module (a fake object in tests)
 * @param {Record<string,string>} bespokeGlyphs app icon name -> raw path data, read from an .svg
 * @returns {Record<string,string>}
 */
export function resolveIconPaths(iconMap, mdiModule, bespokeGlyphs) {
  const paths = {};
  for (const [name, exportName] of Object.entries(iconMap)) {
    if (!(exportName in mdiModule)) {
      throw new Error(`@mdi/js has no export named "${exportName}" (icon "${name}")`);
    }
    paths[name] = mdiModule[exportName];
  }
  for (const [name, d] of Object.entries(bespokeGlyphs)) {
    if (name in paths) {
      throw new Error(
        `bespoke glyph "${name}" collides with an @mdi/js-backed icon of the same name`,
      );
    }
    paths[name] = d;
  }
  return paths;
}

/**
 * PURE: format the ICON_PATHS module source from an already-resolved name -> path map. Uses
 * prettier's own API (never a spawned `prettier` CLI) so the result is byte-identical to
 * `prettier --write`'s output. Keys are sorted so the output is deterministic regardless of the
 * input map's own key order.
 * @param {Record<string,string>} paths
 * @returns {Promise<string>}
 */
export async function generateIconPathsSource(paths) {
  const sortedNames = Object.keys(paths).sort();
  const entries = sortedNames
    .map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(paths[name])},`)
    .join("\n");
  const source = `/**
 * SVG path map for every icon named in docs/design/spec.md §6.
 *
 * GENERATED — do not hand-edit. Run \`node scripts/build-icon-paths.mjs\` to regenerate from:
 *   - @mdi/js, by export name (never transcribed by hand)
 *   - the bespoke flower glyph (src/lib/brand/glyphs/flower.svg)
 * tests/icon-paths.test.ts proves every MDI path matches its @mdi/js export exactly and that
 * regenerating this file in memory is byte-identical to what is committed here.
 */

export const ICON_PATHS: Record<string, string> = {
${entries}
} as const;

export type IconName = keyof typeof ICON_PATHS;
`;
  const { tabWidth, useTabs, singleQuote, semi, trailingComma, printWidth } = JSON.parse(
    readFileSync(PRETTIER_CONFIG_FILE, "utf8"),
  );
  return prettier.format(source, {
    tabWidth,
    useTabs,
    singleQuote,
    semi,
    trailingComma,
    printWidth,
    parser: "typescript",
  });
}

async function main() {
  const mdiModule = await import("@mdi/js");
  const iconMap = JSON.parse(readFileSync(ICON_MAP_FILE, "utf8"));
  const flowerPath = glyphPathFromSvg(readFileSync(FLOWER_SVG_FILE, "utf8"));
  const paths = resolveIconPaths(iconMap, mdiModule, { flower: flowerPath });
  const source = await generateIconPathsSource(paths);
  writeFileSync(OUTPUT_FILE, source);
  process.stdout.write(
    `build-icon-paths: wrote ${OUTPUT_FILE} (${Object.keys(paths).length} icons)\n`,
  );
}

// run only when executed directly (`node scripts/build-icon-paths.mjs`), never on import — so
// `vitest run` importing this module for its pure functions can never rewrite the committed file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
