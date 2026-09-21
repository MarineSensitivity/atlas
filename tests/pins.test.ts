import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPinsOnDisk, comparePins, parseVerdictPins } from "../scripts/check-pins-core.mjs";

// atlas-0 Deliverable 6: the two dependency pins are decided by spikes S1 and S2 and written on the
// verdict line of docs/spikes/S1.md and S2.md. This test is the seeded-fault gate for that
// decision: if package.json's @duckdb/duckdb-wasm or maplibre-gl range ever drifts from the verdict
// that justifies it, this goes red. Both pins are load-bearing beyond "it builds": S1's pin is the
// difference between an OPFS database that persists and one that silently loses every write, and
// anything below maplibre-gl 6.4.1 is inside the critical advisory GHSA-jrc7-96c5-q579.

const root = fileURLToPath(new URL("..", import.meta.url));
const SPIKES_DIR = `${root}docs/spikes`;
const S1 = `${SPIKES_DIR}/S1.md`;
const S2 = `${SPIKES_DIR}/S2.md`;
const PKG = `${root}package.json`;

// every verdict file that exists, not a hard-coded list: a spike report written later must be
// covered by this gate the moment it lands, without anyone remembering to add it here.
const verdictFiles = (): string[] =>
  readdirSync(SPIKES_DIR)
    .filter((f) => /^S\d+\.md$/.test(f))
    .sort()
    .map((f) => `${SPIKES_DIR}/${f}`);

describe("parseVerdictPins (one rule per case)", () => {
  it("reads a scoped pin off the verdict line", () => {
    const md = "text\n\n**Verdict:** pin it — pins: `@duckdb/duckdb-wasm@1.32.0`.\n";
    expect(parseVerdictPins(md)).toEqual([{ name: "@duckdb/duckdb-wasm", range: "1.32.0" }]);
  });

  it("reads an unscoped pin with a caret range", () => {
    const md = "**Verdict:** adopt 6.x; pins: `maplibre-gl@^6.10.0`.\n";
    expect(parseVerdictPins(md)).toEqual([{ name: "maplibre-gl", range: "^6.10.0" }]);
  });

  it("reads several pins from one wrapped verdict paragraph, deduped", () => {
    const md =
      "**Verdict:** both — pins: `maplibre-gl@^6.10.0` and\n" +
      "`@duckdb/duckdb-wasm@1.32.0`, plus `maplibre-gl@^6.10.0` again.\n\ntrailing prose\n";
    expect(parseVerdictPins(md)).toEqual([
      { name: "maplibre-gl", range: "^6.10.0" },
      { name: "@duckdb/duckdb-wasm", range: "1.32.0" },
    ]);
  });

  it("stops at the blank line after the verdict, so later prose cannot inject a pin", () => {
    const md = "**Verdict:** pins: `maplibre-gl@^6.10.0`.\n\nsee also `left-pad@1.0.0`\n";
    expect(parseVerdictPins(md)).toEqual([{ name: "maplibre-gl", range: "^6.10.0" }]);
  });

  it("returns nothing when there is no verdict line at all", () => {
    expect(parseVerdictPins("# notes\n\nno verdict here\n")).toEqual([]);
  });

  it("ignores a `pkg@range` token that is not on the verdict line", () => {
    const md = "the harness used `@duckdb/duckdb-wasm@1.33.1-dev57.0`\n\n**Verdict:** no pins.\n";
    expect(parseVerdictPins(md)).toEqual([]);
  });
});

describe("comparePins (one rule per case)", () => {
  const declared = (pins: { name: string; range: string }[]) => [{ source: "S.md", pins }];

  it("is green when package.json matches the verdict exactly", () => {
    const pkg = { dependencies: { "maplibre-gl": "^6.10.0" } };
    expect(comparePins(pkg, declared([{ name: "maplibre-gl", range: "^6.10.0" }]))).toEqual([]);
  });

  it("is RED when the range drifts (the seeded fault this gate exists for)", () => {
    const pkg = { dependencies: { "maplibre-gl": "^5.24.0" } };
    const problems = comparePins(pkg, declared([{ name: "maplibre-gl", range: "^6.10.0" }]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("maplibre-gl@^5.24.0");
    expect(problems[0]).toContain("drifted");
  });

  it("is RED on a caret added to an exact pin (^1.32.0 is not 1.32.0)", () => {
    const pkg = { dependencies: { "@duckdb/duckdb-wasm": "^1.32.0" } };
    const problems = comparePins(pkg, declared([{ name: "@duckdb/duckdb-wasm", range: "1.32.0" }]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("^1.32.0");
  });

  it("is RED when the dependency is missing entirely", () => {
    const problems = comparePins({}, declared([{ name: "maplibre-gl", range: "^6.10.0" }]));
    expect(problems).toEqual([
      "S.md pins maplibre-gl@^6.10.0, but package.json declares no maplibre-gl",
    ]);
  });

  it("accepts a pin declared under devDependencies", () => {
    const pkg = { devDependencies: { vite: "^8.3.0" } };
    expect(comparePins(pkg, declared([{ name: "vite", range: "^8.3.0" }]))).toEqual([]);
  });
});

describe("the real repo: package.json must match the spike verdicts", () => {
  it("has no pin drift across any docs/spikes/S*.md verdict", () => {
    expect(checkPinsOnDisk(PKG, verdictFiles())).toEqual([]);
  });

  // regression guards on the two facts a later agent is most likely to undo by accident.
  it("S1.md still pins @duckdb/duckdb-wasm away from npm `latest` (dev57 loses OPFS writes)", () => {
    const pins = parseVerdictPins(readFileSync(S1, "utf8"));
    expect(pins).toContainEqual({ name: "@duckdb/duckdb-wasm", range: "1.32.0" });
  });

  it("S2.md still pins maplibre-gl at 6.4.1+ (every 5.x is inside GHSA-jrc7-96c5-q579)", () => {
    const pins = parseVerdictPins(readFileSync(S2, "utf8"));
    expect(pins).toContainEqual({ name: "maplibre-gl", range: "^6.10.0" });
  });
});
