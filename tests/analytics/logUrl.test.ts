// round 2, Q7: `analyticsLogUrl()` (src/lib/analytics/logUrl.ts) had no unit test at all before
// this file, the same gap `tests/feedback/endpoint.test.ts` closed for `feedbackEndpoint()` --
// pin the "unset repository variable resolves to the EMPTY STRING, not undefined" shape and the
// https-only fail-closed behaviour so a careless rewrite can't ship a broken or junk Sheet-log
// target silently.
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsLogUrl } from "../../src/lib/analytics/logUrl";

describe("analyticsLogUrl (round 2, Q7)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('unset VITE_LOG_URL -> "" (analytics.ts\'s own default for an absent logUrl)', () => {
    vi.stubEnv("VITE_LOG_URL", undefined);
    expect(analyticsLogUrl()).toBe("");
  });

  it(
    'VITE_LOG_URL="" (the actual shape an unset GitHub Actions repository variable resolves ' +
      'to, `${{ vars.VITE_LOG_URL }}`) -> ""',
    () => {
      vi.stubEnv("VITE_LOG_URL", "");
      expect(analyticsLogUrl()).toBe("");
    },
  );

  it('whitespace-only VITE_LOG_URL trims to empty -> ""', () => {
    vi.stubEnv("VITE_LOG_URL", "   ");
    expect(analyticsLogUrl()).toBe("");
  });

  it('a non-https VITE_LOG_URL (e.g. http://) fails closed to ""', () => {
    vi.stubEnv("VITE_LOG_URL", "http://script.google.com/macros/s/x/exec");
    expect(analyticsLogUrl()).toBe("");
  });

  it('a garbage VITE_LOG_URL fails closed to ""', () => {
    vi.stubEnv("VITE_LOG_URL", "not-a-url");
    expect(analyticsLogUrl()).toBe("");
  });

  it("a whitespace-padded https:// VITE_LOG_URL is trimmed and returned", () => {
    vi.stubEnv("VITE_LOG_URL", "  https://script.google.com/macros/s/x/exec  ");
    expect(analyticsLogUrl()).toBe("https://script.google.com/macros/s/x/exec");
  });
});
