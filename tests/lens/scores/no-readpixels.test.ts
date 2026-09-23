// GATE (fix round 3, the scores click popup): `readPixels(` never appears under `src/lens/scores`
// — the popup's "displayed layer's value" must come from `analysis/queries.ts#cellValue()` (the
// wide `cell` Parquet tile), never a sampled raster pixel (plan D4: "numbers never come from the
// tile server"). A source scan is the available form for the same reason
// `tests/map/no-fitbounds.test.ts` uses one: nothing about a WRONG data source is otherwise
// distinguishable from a unit test's return value alone — both a tile read and a Parquet read can
// hand back the number 42.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (/\.(ts|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

const READ_PIXELS_RE = /\breadPixels\s*\(/;

/** the scanner itself, so the gate and its seeded fault run the SAME code. */
export function findReadPixelsCalls(dirs: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of listFiles(dir)) {
      if (READ_PIXELS_RE.test(readFileSync(file, "utf8"))) offenders.push(relative(ROOT, file));
    }
  }
  return offenders;
}

const SCANNED = [join(ROOT, "src/lens/scores")];

describe("no readPixels under src/lens/scores", () => {
  it("finds no call", () => {
    expect(findReadPixelsCalls(SCANNED)).toEqual([]);
  });

  it("is not vacuous: the scanned directory really contains source files", () => {
    expect(listFiles(join(ROOT, "src/lens/scores")).length).toBeGreaterThan(4);
  });

  it("SEEDED FAULT: the same scan flags tests/fixtures/lens/scores/readpixels-fault/", () => {
    expect(
      findReadPixelsCalls([join(ROOT, "tests/fixtures/lens/scores/readpixels-fault")]),
    ).toEqual(["tests/fixtures/lens/scores/readpixels-fault/probe.ts"]);
  });
});
