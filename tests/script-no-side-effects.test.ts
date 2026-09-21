// Verify that importing build scripts has no side effects (does not write files)
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const FILES_TO_PROTECT = ["src/lib/brand/tokens.json", "src/lib/ui/icon-paths.ts"];

function hashFile(path: string): string {
  const content = readFileSync(path, "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describe("build scripts have no import-time side effects", () => {
  it("importing export-tokens.mjs does not write tokens.json", async () => {
    const hash = hashFile(FILES_TO_PROTECT[0]);
    const mtime = statSync(FILES_TO_PROTECT[0]).mtime.getTime();

    // Delay slightly to ensure mtime would change if file is written
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Dynamic import should not trigger main()
    await import("../scripts/export-tokens.mjs");

    const newHash = hashFile(FILES_TO_PROTECT[0]);
    const newMtime = statSync(FILES_TO_PROTECT[0]).mtime.getTime();

    expect(newHash).toBe(hash);
    expect(newMtime).toBe(mtime);
  });

  it("importing build-icon-paths.mjs does not write icon-paths.ts", async () => {
    const hash = hashFile(FILES_TO_PROTECT[1]);
    const mtime = statSync(FILES_TO_PROTECT[1]).mtime.getTime();

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Dynamic import should not trigger main()
    await import("../scripts/build-icon-paths.mjs");

    const newHash = hashFile(FILES_TO_PROTECT[1]);
    const newMtime = statSync(FILES_TO_PROTECT[1]).mtime.getTime();

    expect(newHash).toBe(hash);
    expect(newMtime).toBe(mtime);
  });
});
