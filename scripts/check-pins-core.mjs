// atlas-0 Deliverable 6 / Step 4: the spike verdicts in docs/spikes/*.md are the source of truth
// for two dependency pins (@duckdb/duckdb-wasm from S1, maplibre-gl from S2). A pin that drifts away
// from the verdict that justified it is the exact failure this repo cannot afford: S1's pin is the
// difference between an OPFS database that persists and one that silently loses every write, and
// S2's is the difference between shipping and not shipping a critical XSS advisory
// (GHSA-jrc7-96c5-q579, <= 6.4.0). package.json is JSON and cannot hold the reason inline
// (atlas-refs/"calcofi explore review.md" §11 lesson 10 wants it inline), so the reason lives in
// docs/spikes/ + package.json's "pinReasons" block and THIS check is what keeps the two from
// drifting apart silently.
//
// Contract: each verdict file ends with a line starting `**Verdict:**` that names every pin it
// implies as a `pkg@range` token inside backticks, e.g. `` `maplibre-gl@^6.10.0` ``. Every such pin
// must appear in package.json's dependencies/devDependencies with exactly that range.
import { readFileSync } from "node:fs";

const VERDICT_PREFIX = "**Verdict:**";
// `pkg@range` inside backticks; pkg may be scoped (@scope/name). The range runs to the closing
// backtick, so "^6.10.0" and "1.32.0" both round-trip verbatim.
const PIN_TOKEN = /`((?:@[^`@/\s]+\/)?[^`@\s]+)@([^`\s]+)`/g;

/**
 * every `pkg@range` pin named on the verdict line of one spike report.
 * @param {string} markdown full text of a docs/spikes/*.md file
 * @returns {{name: string, range: string}[]} in source order, deduped by name+range
 */
export function parseVerdictPins(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  // the verdict is one line, but a wrapped paragraph in a hand-written md file may continue onto
  // following lines; take from the `**Verdict:**` line to the next blank line.
  const start = lines.findIndex((l) => l.trimStart().startsWith(VERDICT_PREFIX));
  if (start === -1) return [];
  const block = [];
  for (let i = start; i < lines.length && lines[i].trim() !== ""; i++) block.push(lines[i]);

  const seen = new Set();
  const pins = [];
  for (const m of block.join("\n").matchAll(PIN_TOKEN)) {
    const key = `${m[1]}@${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push({ name: m[1], range: m[2] });
  }
  return pins;
}

/**
 * compare the pins a set of verdicts declares against what package.json actually declares.
 * @param {object} pkgJson parsed package.json
 * @param {{source: string, pins: {name: string, range: string}[]}[]} declared
 * @returns {string[]} human-readable problems; empty means green
 */
export function comparePins(pkgJson, declared) {
  const deps = { ...(pkgJson.devDependencies ?? {}), ...(pkgJson.dependencies ?? {}) };
  const problems = [];
  for (const { source, pins } of declared) {
    for (const { name, range } of pins) {
      const actual = deps[name];
      if (actual === undefined) {
        problems.push(`${source} pins ${name}@${range}, but package.json declares no ${name}`);
      } else if (actual !== range) {
        problems.push(
          `${source} pins ${name}@${range}, but package.json has ${name}@${actual} — the pin drifted ` +
            `from the verdict that justifies it (update both, or re-run the spike and rewrite the verdict)`,
        );
      }
    }
  }
  return problems;
}

/**
 * read the verdict files and package.json from disk and compare.
 * @param {string} pkgJsonPath
 * @param {string[]} verdictPaths
 * @returns {string[]} problems; empty means green
 */
export function checkPinsOnDisk(pkgJsonPath, verdictPaths) {
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const declared = verdictPaths.map((p) => ({
    source: p,
    pins: parseVerdictPins(readFileSync(p, "utf8")),
  }));
  return comparePins(pkgJson, declared);
}
