// P10: Help > Docs must open THIS release's Atlas chapter, not the book root (Ben's live-app
// finding — see docsUrl.ts's own header). Red-first: this file failed before atlasDocsUrl() existed
// (root branch only) and fails again under the seeded fault "docsurl-always-root"
// (scripts/test-faults.mjs), which reverts the function to `return DOCS_ROOT` unconditionally.
import { describe, expect, it } from "vitest";
import { ATLAS_CHAPTER_PATH, DOCS_ROOT, atlasDocsUrl } from "../../src/lib/release/docsUrl";

describe("atlasDocsUrl (P10)", () => {
  it("public release: the version's own Atlas chapter on the public book", () => {
    expect(atlasDocsUrl("v7", "public")).toBe(
      "https://marinesensitivity.org/docs/v7/apps/atlas.html",
    );
  });

  it("restricted release: the chapter on the signed-in preview host, not the public book", () => {
    expect(atlasDocsUrl("v9", "restricted")).toBe(
      "https://preview.marinesensitivity.org/docs/v9/apps/atlas.html",
    );
  });

  it("restricted release honours an overridden preview base (test seam)", () => {
    expect(atlasDocsUrl("v9", "restricted", "https://preview.example.org")).toBe(
      "https://preview.example.org/docs/v9/apps/atlas.html",
    );
  });

  it("unknown access (no registry row) falls back to the book root, never a guessed chapter path", () => {
    expect(atlasDocsUrl("v99", "unknown")).toBe(DOCS_ROOT);
  });

  it("no version yet resolved falls back to the book root", () => {
    expect(atlasDocsUrl(null, "public")).toBe(DOCS_ROOT);
    expect(atlasDocsUrl(undefined, "restricted")).toBe(DOCS_ROOT);
  });

  it("the chapter path is exactly what the docs book publishes for apps/atlas.qmd", () => {
    expect(ATLAS_CHAPTER_PATH).toBe("apps/atlas.html");
  });
});
