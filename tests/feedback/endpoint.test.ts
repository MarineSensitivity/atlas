// round 2, Q4: `feedbackEndpoint()` (src/lib/feedback/endpoint.ts, read-only for this round -- the
// runbook fix is wiring `VITE_FEEDBACK_URL` into pages.yml, see tests/release/pagesEnvVars.wiring
// .test.ts) had no unit test at all before this file. Its own header already claims "an empty/unset
// env var ... must resolve to `null`", but nothing asserted a GitHub Pages repository variable left
// unset by Ben (docs/feedback.md step 5: he has not created the Sheet/Apps Script yet) actually
// hits that branch -- `${{ vars.VITE_FEEDBACK_URL }}` resolves to the EMPTY STRING, not `undefined`,
// when the variable does not exist, and an empty string is truthy-looking enough that a careless
// rewrite (`env ?? null` instead of the current `env && ...`) would ship silently broken.
import { afterEach, describe, expect, it, vi } from "vitest";
import { feedbackEndpoint } from "../../src/lib/feedback/endpoint";

describe("feedbackEndpoint (round 2, Q4)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("unset VITE_FEEDBACK_URL -> null (no build-time endpoint configured)", () => {
    vi.stubEnv("VITE_FEEDBACK_URL", undefined);
    expect(feedbackEndpoint()).toBeNull();
  });

  it(
    'VITE_FEEDBACK_URL="" (the actual shape an unset GitHub Actions repository variable ' +
      "resolves to, `${{ vars.VITE_FEEDBACK_URL }}`) -> null, not a broken fetch target",
    () => {
      vi.stubEnv("VITE_FEEDBACK_URL", "");
      expect(feedbackEndpoint()).toBeNull();
    },
  );

  it("whitespace-only VITE_FEEDBACK_URL trims to empty -> null", () => {
    vi.stubEnv("VITE_FEEDBACK_URL", "   ");
    expect(feedbackEndpoint()).toBeNull();
  });

  it("a non-URL VITE_FEEDBACK_URL (garbage value) -> null, fails closed rather than posting to junk", () => {
    vi.stubEnv("VITE_FEEDBACK_URL", "not-a-url");
    expect(feedbackEndpoint()).toBeNull();
  });

  it("a real https:// VITE_FEEDBACK_URL is returned verbatim", () => {
    vi.stubEnv("VITE_FEEDBACK_URL", "https://script.google.com/macros/s/AKfycb.../exec");
    expect(feedbackEndpoint()).toBe("https://script.google.com/macros/s/AKfycb.../exec");
  });

  it("a leading/trailing-whitespace VITE_FEEDBACK_URL is trimmed before use", () => {
    vi.stubEnv("VITE_FEEDBACK_URL", "  https://script.google.com/macros/s/x/exec  ");
    // the current implementation trims only for the truthiness/regex check, not the returned
    // value -- pin the ACTUAL behaviour so a future change to either half shows up as a diff here.
    expect(feedbackEndpoint()).toBe("https://script.google.com/macros/s/x/exec");
  });
});
