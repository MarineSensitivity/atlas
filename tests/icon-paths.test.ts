// atlas-3 step 2: icon-paths mechanical verification
// Tests: every icon path equals @mdi/js export exactly; every path is valid SVG;
// no duplicates; no direct @mdi/js import in the output file; regeneration is byte-identical.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mdi from "@mdi/js";
import { ICON_PATHS } from "../src/lib/ui/icon-paths";

const ICON_MAP = JSON.parse(readFileSync("scripts/icon-map.json", "utf8"));
const ICON_PATHS_FILE = readFileSync("src/lib/ui/icon-paths.ts", "utf8");

// SVG path command characters and allowed symbols
const SVG_PATH_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9.\s,\-+eE()]*$/;

describe("icon-paths (atlas-3 step 2, mechanical)", () => {
  it("every icon name in scripts/icon-map.json exists in ICON_PATHS", () => {
    for (const name of Object.keys(ICON_MAP)) {
      expect(ICON_PATHS).toHaveProperty(name);
    }
  });

  it("every MDI icon path equals @mdi/js export character for character", () => {
    for (const [name, exportName] of Object.entries(ICON_MAP)) {
      const expected = mdi[exportName as keyof typeof mdi];
      const actual = ICON_PATHS[name as keyof typeof ICON_PATHS];
      expect(actual).toBe(expected);
    }
  });

  it("every path starts with M or m and contains only valid SVG path characters", () => {
    for (const [name, path] of Object.entries(ICON_PATHS)) {
      expect(path, `path ${name}`).toMatch(/^[Mm]/);
      expect(path, `path ${name}`).toMatch(SVG_PATH_CHARS);
    }
  });

  it("has no duplicate icon names", () => {
    const names = Object.keys(ICON_PATHS);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("does not contain a direct import of @mdi/js", () => {
    expect(ICON_PATHS_FILE).not.toMatch(/from\s+["']@mdi\/js["']/);
  });

  it("regenerates icon-paths.ts byte-identical to the committed file", async () => {
    const { execSync } = await import("node:child_process");
    try {
      execSync("node scripts/build-icon-paths.mjs", { encoding: "utf8" });
      const regenerated = readFileSync("src/lib/ui/icon-paths.ts", "utf8");
      expect(regenerated).toBe(ICON_PATHS_FILE);
    } catch (e) {
      throw new Error(`build-icon-paths failed: ${e}`);
    }
  });
});
