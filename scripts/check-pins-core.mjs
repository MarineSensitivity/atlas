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
//
// atlas-0 review fix round 1, F2 (guard): the root package.json is not the only place maplibre-gl can
// be declared — every spikes/*/package.json is a real page that really executes (Playwright drives
// it), so a spike still stuck on a `^5.24.0`-shaped range is still inside GHSA-jrc7-96c5-q579. This is
// a floor check, not an exact-pin check (a spike is allowed a wider range than the app's own pin, as
// long as its floor never dips below the patched version).
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

// --- minimal semver: just enough to answer "does this range admit a version below a floor?" ---------
// Deliberately not a general range solver (no `||`, hyphen ranges, `x`/`*`, or build metadata) — this
// repo's package.json files only ever write `^X.Y.Z`, `~X.Y.Z`, `>=X.Y.Z` or an exact `X.Y.Z`, and all
// four share one property: they are a contiguous range starting AT the written version with no gaps
// below it, so the range's own floor (the version literally written) is exactly the smallest version it
// can resolve to. Answering "does it admit a version below F" therefore reduces to "is the floor < F".

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** @param {string} v @returns {{major:number,minor:number,patch:number,pre:string|null}} */
export function parseVersion(v) {
  const m = VERSION_RE.exec(String(v).trim());
  if (!m) throw new Error(`not a plain semver version: "${v}"`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

/** @returns {-1|0|1} a<b / a==b / a>b, by semver precedence (a version WITH a prerelease sorts before
 * the same major.minor.patch without one; prerelease identifiers themselves compare as plain strings —
 * good enough here, none of the versions this module compares carry multi-field prereleases). */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (const k of /** @type {const} */ (["major", "minor", "patch"])) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}

const RANGE_RE = /^(?:\^|~|>=)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * the smallest version a `^`/`~`/`>=`/exact range can resolve to (see the block comment above for why
 * that is always just the version written).
 * @param {string} range
 * @returns {string}
 */
export function rangeFloor(range) {
  const m = RANGE_RE.exec(String(range).trim());
  if (!m) {
    throw new Error(
      `unsupported range form (only ^X.Y.Z, ~X.Y.Z, >=X.Y.Z or an exact X.Y.Z are handled): "${range}"`,
    );
  }
  return m[1];
}

/**
 * @param {string} range
 * @param {string} floorVersion
 * @returns {boolean} true if `range` can resolve to a version strictly below `floorVersion`
 */
export function rangeAdmitsBelow(range, floorVersion) {
  return compareVersions(rangeFloor(range), floorVersion) < 0;
}

// GHSA-jrc7-96c5-q579: critical (CVSS 10.0) XSS sanitizer bypass, vulnerable_version_range "<= 6.4.0",
// first_patched_version "6.4.1" (docs/spikes/S2.md). Every published 5.x release is inside it.
export const MAPLIBRE_SAFE_FLOOR = "6.4.1";

/**
 * atlas-0 review fix round 1, F2 (guard): every spikes/*\/package.json is a real page a browser really
 * executes, not just documentation — so a spike declaring a maplibre-gl range whose floor is below the
 * patched version is exactly as dangerous as it would be in the app's own package.json.
 * @param {string[]} pkgJsonPaths every spikes/*\/package.json path found on disk
 * @param {(path: string) => object} readPkgJson defaults to reading + JSON-parsing the file; injectable
 *   for tests
 * @returns {string[]} problems; empty means green
 */
export function checkSpikeMaplibreFloor(
  pkgJsonPaths,
  readPkgJson = (p) => JSON.parse(readFileSync(p, "utf8")),
) {
  const problems = [];
  for (const p of pkgJsonPaths) {
    const pkg = readPkgJson(p);
    const deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
    const range = deps["maplibre-gl"];
    if (range === undefined) continue; // this spike doesn't depend on maplibre-gl at all

    let unsafe;
    try {
      unsafe = rangeAdmitsBelow(range, MAPLIBRE_SAFE_FLOOR);
    } catch (err) {
      problems.push(
        `${p} declares maplibre-gl@${range}, which this checker's minimal range parser cannot read ` +
          `(${err.message}) — widen scripts/check-pins-core.mjs's parser or pin an exact version`,
      );
      continue;
    }
    if (unsafe) {
      problems.push(
        `${p} declares maplibre-gl@${range}, which admits a version below ${MAPLIBRE_SAFE_FLOOR} — ` +
          `every published 5.x release is inside the critical advisory GHSA-jrc7-96c5-q579 ` +
          `(docs/spikes/S2.md); bump it to at least ^${MAPLIBRE_SAFE_FLOOR}`,
      );
    }
  }
  return problems;
}
