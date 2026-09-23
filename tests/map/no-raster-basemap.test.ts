// GATE: CARTO's raster basemap literals (`dark_all`, `light_all` — the two path segments
// `basemaps.cartocdn.com/{dark_all,light_all}/{z}/{x}/{y}.png` used) never appear under
// `src/lib/map` again. CARTO's raster endpoint started answering with an "API KEY REQUIRED"
// watermark (owner report, 2026-09-23); the fix is CARTO's keyless VECTOR GL style
// (`layers/basemap.ts#loadBasemapStyle`), and this is the permanent regression guard that nobody
// reinstates the raster branch later (e.g. "to save a round trip") without this test going red.
// Same source-scan technique `tests/map/no-fitbounds.test.ts` already uses.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RASTER_BASEMAP_FAULT_DIR } from "../fixtures/map/faults";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** every `.ts`/`.svelte` file under `dir`, recursively. */
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

const RASTER_BASEMAP_RE = /dark_all|light_all/;

/** the scanner itself, so the gate and its seeded fault run the SAME code. */
export function findRasterBasemapLiterals(dirs: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of listFiles(dir)) {
      if (RASTER_BASEMAP_RE.test(readFileSync(file, "utf8"))) offenders.push(relative(ROOT, file));
    }
  }
  return offenders;
}

const SCANNED = [join(ROOT, "src/lib/map")];

describe("no CARTO raster-basemap literal (dark_all/light_all) under src/lib/map", () => {
  it("finds no match", () => {
    expect(findRasterBasemapLiterals(SCANNED)).toEqual([]);
  });

  it("is not vacuous: the scanned directory really contains source files", () => {
    expect(listFiles(join(ROOT, "src/lib/map")).length).toBeGreaterThan(4);
  });

  it("SEEDED FAULT: the same scan flags tests/fixtures/map/raster-basemap-fault/", () => {
    expect(findRasterBasemapLiterals([join(ROOT, RASTER_BASEMAP_FAULT_DIR)])).toEqual([
      "tests/fixtures/map/raster-basemap-fault/basemap.ts",
    ]);
  });
});
