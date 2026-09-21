import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findAbsoluteAssetUrls } from "../scripts/check-relative-assets-core.mjs";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function makeDist(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "atlas-relative-assets-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

describe("findAbsoluteAssetUrls (plan D2, base: './')", () => {
  it("flags an absolute /assets/ URL", () => {
    const d = makeDist({ "index.html": '<script src="/assets/index-abc.js"></script>' });
    expect(findAbsoluteAssetUrls(d)).toHaveLength(1);
  });

  it("does not flag a relative ./assets/ or ../assets/ URL", () => {
    const d = makeDist({
      "index.html": '<script src="./assets/index-abc.js"></script>',
      "assets/nested.css": `.x { background: url("../assets/img.png"); }`,
    });
    expect(findAbsoluteAssetUrls(d)).toEqual([]);
  });

  it("flags an absolute URL inside CSS url(), unquoted", () => {
    const d = makeDist({ "assets/a.css": ".x { background: url(/assets/img.png); }" });
    expect(findAbsoluteAssetUrls(d)).toHaveLength(1);
  });
});
