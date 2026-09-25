// R3-D1: the pure logic behind scripts/gallery-baselines-from-ci.mjs -- picking each screenshot's
// final (highest-retry) CI attempt and mapping its "-actual.png" filename to the baseline it
// should overwrite. The script's own gh-download/filesystem side effects are exercised by hand
// (see the R3-D1 report); this is the part a fixture can assert exactly.
import { describe, expect, it } from "vitest";
import {
  baselineNameFor,
  finalAttemptActuals,
  retryOf,
} from "../../scripts/gallery-baselines-from-ci-core.mjs";

describe("retryOf", () => {
  it("no -retryN suffix is attempt 0", () => {
    expect(retryOf("gallery-screenshots-every-section-navy-desktop-chromium")).toBe(0);
  });

  it("reads the retry number from the suffix", () => {
    expect(retryOf("gallery-screenshots-every-section-navy-desktop-chromium-retry1")).toBe(1);
    expect(retryOf("gallery-screenshots-every-section-navy-desktop-chromium-retry2")).toBe(2);
  });
});

describe("finalAttemptActuals", () => {
  it("keeps the only copy when a screenshot name appears once", () => {
    const paths = [
      "gallery-navy-desktop-chromium/gallery-navy-desktop-about-chromium-linux-actual.png",
    ];
    expect(finalAttemptActuals(paths)).toEqual(paths);
  });

  it("keeps only the HIGHEST-retry copy when the same screenshot name appears under several attempts", () => {
    const attempt0 =
      "gallery-navy-desktop-chromium/gallery-navy-desktop-about-chromium-linux-actual.png";
    const attempt1 =
      "gallery-navy-desktop-chromium-retry1/gallery-navy-desktop-about-chromium-linux-actual.png";
    const attempt2 =
      "gallery-navy-desktop-chromium-retry2/gallery-navy-desktop-about-chromium-linux-actual.png";
    // order in the input should not matter -- a real directory walk is not guaranteed to visit
    // retry directories in numeric order.
    expect(finalAttemptActuals([attempt1, attempt0, attempt2])).toEqual([attempt2]);
    expect(finalAttemptActuals([attempt2, attempt0, attempt1])).toEqual([attempt2]);
  });

  it("different screenshot names never collide, even across retry directories", () => {
    const about =
      "gallery-navy-desktop-chromium/gallery-navy-desktop-about-chromium-linux-actual.png";
    const panel =
      "gallery-navy-desktop-chromium-retry1/gallery-navy-desktop-panel-chromium-linux-actual.png";
    const kept = finalAttemptActuals([about, panel]);
    expect(kept).toHaveLength(2);
    expect(kept).toEqual(expect.arrayContaining([about, panel]));
  });

  it("empty input -> empty output", () => {
    expect(finalAttemptActuals([])).toEqual([]);
  });
});

describe("baselineNameFor", () => {
  it("strips the '-actual' suffix Playwright inserts before the extension", () => {
    expect(baselineNameFor("gallery-navy-desktop-about-chromium-linux-actual.png")).toBe(
      "gallery-navy-desktop-about-chromium-linux.png",
    );
  });

  it("null for a file that is not a *-actual.png (defensive)", () => {
    expect(baselineNameFor("gallery-navy-desktop-about-chromium-linux-diff.png")).toBeNull();
    expect(baselineNameFor("gallery-navy-desktop-about-chromium-linux-expected.png")).toBeNull();
    expect(baselineNameFor("readme.txt")).toBeNull();
  });
});
