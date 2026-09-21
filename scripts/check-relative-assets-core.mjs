// plan D2: `base: "./"` so the same dist/ runs under both /atlas/ and /v9/atlas/. An absolute
// `/assets/...` reference would break the moment the app is served from a version-prefixed path
// (the preview host), so no emitted file may contain one.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// a leading-slash reference to the assets dir, as it would appear in an attribute or a JS/CSS string:
// "/assets/..., '/assets/..., (/assets/... (CSS url(), unquoted). Requiring the quote/paren
// immediately before the slash already excludes "./assets/" and "../assets/" (there's a "."
// between the quote and the slash there, so this pattern simply never starts at that position) —
// which is the whole point of a relative base, so those must NOT match.
const ABSOLUTE_ASSETS_RE = /["'(]\/assets\//g;

const TEXT_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".svg", ".txt"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * @param {string} distDir
 * @param {(path: string) => string} readFile injected for testability
 * @returns {{ path: string, match: string }[]} every absolute /assets/ hit found
 */
export function findAbsoluteAssetUrls(distDir, readFile = (p) => readFileSync(p, "utf8")) {
  const hits = [];
  for (const file of walk(distDir)) {
    const ext = file.slice(file.lastIndexOf("."));
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const content = readFile(file);
    const matches = content.match(ABSOLUTE_ASSETS_RE);
    if (matches) for (const m of matches) hits.push({ path: relative(distDir, file), match: m });
  }
  return hits;
}
