import { describe, expect, it } from "vitest";
import { footerLines, shareUrlWithoutOrigin } from "../../src/lib/download/footer";

describe("shareUrlWithoutOrigin", () => {
  it("strips the scheme+host, keeping path/query/hash", () => {
    expect(
      shareUrlWithoutOrigin("https://marinesensitivity.org/atlas/?lens=species&sp=Fis-1"),
    ).toBe("/atlas/?lens=species&sp=Fis-1");
  });

  it("handles http too", () => {
    expect(shareUrlWithoutOrigin("http://localhost:4331/atlas/#h1")).toBe("/atlas/#h1");
  });

  it("falls back to '/' rather than an empty string for a bare origin", () => {
    expect(shareUrlWithoutOrigin("https://marinesensitivity.org")).toBe("/");
  });

  it("returns an already-relative/malformed URL unchanged, never throws", () => {
    expect(shareUrlWithoutOrigin("/atlas/?ver=v9")).toBe("/atlas/?ver=v9");
  });
});

describe("footerLines", () => {
  it("puts the title+unit on line 1 and the app/version/url on line 2", () => {
    const [l1, l2] = footerLines({
      title: "Sensitivity",
      unit: "score",
      ver: "v9",
      url: "https://marinesensitivity.org/atlas/?lyr=sensitivity",
    });
    expect(l1).toBe("Sensitivity · score");
    expect(l2).toBe("MarineSensitivity Atlas · v9 · /atlas/?lyr=sensitivity");
  });

  it("omits the unit separator when unit is absent", () => {
    const [l1] = footerLines({ title: "Walrus", ver: "v9", url: "https://x/y" });
    expect(l1).toBe("Walrus");
  });
});
