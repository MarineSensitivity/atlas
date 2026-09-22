import { describe, expect, it } from "vitest";
import { previewLinkFor } from "../../src/lib/release/previewLink";

describe("previewLinkFor (D15)", () => {
  it("path-based ver, current query + hash carried, never ?ver= on Pages", () => {
    expect(previewLinkFor("v9", { search: "?area=GA", hash: "#pl=abc" })).toBe(
      "https://preview.marinesensitivity.org/v9/atlas/?area=GA#pl=abc",
    );
  });

  it("no query/hash: a bare path", () => {
    expect(previewLinkFor("v9", { search: "", hash: "" })).toBe(
      "https://preview.marinesensitivity.org/v9/atlas/",
    );
  });

  it("a stray ?ver= in the current query is carried verbatim (harmless: path beats query)", () => {
    expect(previewLinkFor("v9", { search: "?ver=v7", hash: "" })).toBe(
      "https://preview.marinesensitivity.org/v9/atlas/?ver=v7",
    );
  });
});
