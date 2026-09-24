// P round item 1 (owner-reported, marked fixed earlier -- P3 -- but never worked live): no
// published app bundle (v6-v9) carries a `name` on its `zones.programarea` rows -- verified live,
// `s3://oceanmetrics.io-public/marine-atlas/v7/app/boot.json`, every row is
// `{key, n_cells, area_km2, n_taxa, metrics, coverage}`, no `name` at all -- so `paLabel()`'s
// "bundle name" branch never fires and every Program Area label in the app fell back to the bare
// 3-letter acronym forever, even after the P3 "Name (KEY)" formatting itself shipped.
//
// This generates the APP-SIDE fallback table `src/lib/zones/programAreaNames.ts` from the
// canonical Program Area geometry (`MarineSensitivity/workflows` CLAUDE.md: "Program-Area geometry
// belongs to the zone-set vintage, not to a release" -- the v2 file is canonical for v2-v9 alike):
//   ~/_big/msens/derived/v2/ply_programareas_2026.gpkg, layer `ply_programareas_2026`,
//   fields `programarea_key` / `programarea_name` (verified: its 20 keys match v7's real
//   `boot.json` `zones.programarea` keys exactly).
//
// Regenerate with:
//   node scripts/gen-program-area-names.mjs
// Reads `GPKG_PATH` env var to override the default source path. Requires the `duckdb` CLI with
// its `spatial` extension on PATH (`brew install duckdb`; the extension self-installs on first
// use). This is NOT part of `npm run build`/CI -- the source .gpkg lives outside this repo, only on
// a laptop that has the workflows data checked out -- the OUTPUT is committed, static data, the
// same convention `scripts/build-icon-paths.mjs` / `src/lib/ui/icon-paths.ts` already follow.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import prettier from "prettier";

export const DEFAULT_GPKG_PATH = "/Users/bbest/_big/msens/derived/v2/ply_programareas_2026.gpkg";
export const GPKG_LAYER = "ply_programareas_2026";
export const OUTPUT_FILE = "src/lib/zones/programAreaNames.ts";
const PRETTIER_CONFIG_FILE = ".prettierrc.json";

/**
 * Read `programarea_key` -> `programarea_name` out of the canonical gpkg via the `duckdb` CLI's
 * `spatial` extension. Throws (never returns an empty/partial table silently) when the CLI is
 * missing, the file can't be read, or a row lacks either field.
 * @param {string} gpkgPath
 * @param {typeof execFileSync} execFile injected for tests
 * @returns {Record<string,string>}
 */
export function readProgramAreaNames(gpkgPath, execFile = execFileSync) {
  const sql =
    `INSTALL spatial; LOAD spatial; ` +
    `SELECT programarea_key, programarea_name FROM ST_Read(${JSON.stringify(gpkgPath)}, ` +
    `layer=${JSON.stringify(GPKG_LAYER)}) ORDER BY programarea_key;`;
  const out = execFile("duckdb", ["-json", "-c", sql], { encoding: "utf8" });
  const rows = JSON.parse(out);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`no rows read from ${gpkgPath} (layer ${GPKG_LAYER})`);
  }
  /** @type {Record<string,string>} */
  const names = {};
  for (const r of rows) {
    if (typeof r.programarea_key !== "string" || typeof r.programarea_name !== "string") {
      throw new Error(`row missing programarea_key/programarea_name: ${JSON.stringify(r)}`);
    }
    names[r.programarea_key] = r.programarea_name;
  }
  return names;
}

/**
 * PURE: format the `programAreaNames.ts` module source from an already-resolved key -> name map.
 * Uses prettier's own API (never a spawned `prettier` CLI) so the result is byte-identical to
 * `prettier --write`'s output. Keys sorted so the output is deterministic regardless of the
 * source rows' own order.
 * @param {Record<string,string>} names
 * @returns {Promise<string>}
 */
export async function generateProgramAreaNamesSource(names) {
  const sortedKeys = Object.keys(names).sort();
  const entries = sortedKeys
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(names[k])},`)
    .join("\n");
  const source = `/**
 * Program Area acronym -> full name -- the app-side fallback \`paLabel()\` (src/places/zoneStats.ts)
 * reads when a published app bundle carries no \`name\` on a \`zones.programarea\` row, true of every
 * release through v9 (verified live against v7's own \`boot.json\`). Precedence in \`paLabel\`: the
 * bundle's own \`name\` first, then this table, then the bare key.
 *
 * GENERATED -- do not hand-edit. Run \`node scripts/gen-program-area-names.mjs\` to regenerate from
 * the canonical geometry \`~/_big/msens/derived/v2/ply_programareas_2026.gpkg\` (the
 * \`ply_programareas_2026\` layer's \`programarea_key\`/\`programarea_name\` fields) -- the same file
 * the workflows API reads for Program-Area geometry at every version. ${sortedKeys.length} rows.
 */

export const PROGRAM_AREA_NAMES: Record<string, string> = {
${entries}
};
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
  const gpkgPath = process.env.GPKG_PATH ?? DEFAULT_GPKG_PATH;
  const names = readProgramAreaNames(gpkgPath);
  const source = await generateProgramAreaNamesSource(names);
  writeFileSync(OUTPUT_FILE, source);
  process.stdout.write(
    `gen-program-area-names: wrote ${OUTPUT_FILE} (${Object.keys(names).length} rows)\n`,
  );
}

// run only when executed directly (`node scripts/gen-program-area-names.mjs`), never on import --
// so `vitest run` importing this module for its pure functions can never rewrite the committed file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
