// GATE (atlas-6, the subplan's own "seeded faults, red then restored" list): source-scan guards for
// the four faults that need no browser to prove, the same technique tests/state/invariants.test.ts
// and tests/shell/shell-invariants.test.ts already use for their own "this must never appear in the
// source" rules. Each `it` names the fault it catches; running it against a deliberately reverted
// line (see this file's own history / the commit message) is the "red" half.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const placesDir = fileURLToPath(new URL("../../src/places/", import.meta.url));

function filesOf(dir: string, ext: string): [string, string][] {
  const out: [string, string][] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...filesOf(p, ext));
    else if (name.name.endsWith(ext)) out.push([p, readFileSync(p, "utf8")]);
  }
  return out;
}

const allTs = filesOf(placesDir, ".ts");
const allSvelte = filesOf(placesDir, ".svelte");
const allSource = [...allTs, ...allSvelte];

describe("a place is never stored outside #pl= (localStorage is Recent's OWN log, never the live list)", () => {
  it("finds the source files (an empty walk must not pass vacuously)", () => {
    expect(allSource.length).toBeGreaterThan(10);
  });

  // recents.ts is the ONE module allowed to touch window.localStorage directly -- every other
  // file's read of the CURRENT places list must come from decoding #pl= (model.ts's
  // placesFromHash), never from a second, independently-persisted copy.
  for (const [file, src] of allSource) {
    if (file.endsWith("recents.ts") || file.endsWith("recents.test.ts")) continue;
    it(`${file.slice(placesDir.length)} never reads/writes localStorage directly`, () => {
      expect(src).not.toMatch(/\blocalStorage\.(setItem|getItem)\s*\(/);
    });
  }

  it("SEEDED FAULT: the scan flags a file that stores places outside recents.ts", () => {
    const seeded = 'window.localStorage.setItem("atlas.places.live", hashFromPlaces(next));\n';
    expect(seeded).toMatch(/\blocalStorage\.(setItem|getItem)\s*\(/);
  });
});

describe("the drawn/entered outline is always redrawn from the DECODED geometry, never the raw one", () => {
  it("Places.svelte's onDrawFinish redraws the outline from `place.geometry` (the analysed, stored copy), not the raw `rawGeometry` terra-draw handed back", () => {
    const [, src] = allSource.find(([f]) => f.endsWith("Places.svelte"))!;
    const fn = src.slice(
      src.indexOf("function onDrawFinish"),
      src.indexOf("function ensureDrawSession"),
    );
    expect(fn).toContain("featureCollectionOf(densifyGeometry(place.geometry))");
    expect(fn).not.toMatch(/densifyGeometry\(rawGeometry\)/);
  });

  it("SEEDED FAULT: displaying the raw geometry instead is exactly what this scan catches", () => {
    const seeded = "mapStore.setOutline(featureCollectionOf(densifyGeometry(rawGeometry)));";
    expect(seeded).toMatch(/densifyGeometry\(rawGeometry\)/);
  });
});

describe("accepting the share ladder writes the simplified geometry back to #pl= BEFORE anything else — the numbers on screen are always the link's", () => {
  it("ShareDialog.svelte's accept() calls selStore.set with the ladder's own result (fit.places)", () => {
    const [, src] = allSource.find(([f]) => f.endsWith("ShareDialog.svelte"))!;
    const fn = src.slice(
      src.indexOf("async function accept"),
      src.indexOf("async function copyLink"),
    );
    expect(fn).toMatch(/selStore\.set\(\{\s*pl:\s*hashFromPlaces\(fit\.places\)\s*\}\)/);
  });

  it("SEEDED FAULT: accepting without writing back (numbers stay stale) is exactly what this scan catches", () => {
    const seeded = "async function accept() {\n    onclose();\n  }\n";
    expect(seeded).not.toMatch(/selStore\.set\(\{\s*pl:\s*hashFromPlaces\(fit\.places\)\s*\}\)/);
  });
});

describe("a name is never inserted as HTML — every {@html} would bypass Svelte's own text escaping", () => {
  for (const [file, src] of allSvelte) {
    it(`${file.slice(placesDir.length)} contains no {@html} directive`, () => {
      expect(src).not.toMatch(/\{@html\b/);
    });
  }

  it("SEEDED FAULT: the scan flags a file using {@html} to render a name", () => {
    const seeded = "<span>{@html place.name}</span>";
    expect(seeded).toMatch(/\{@html\b/);
  });
});
