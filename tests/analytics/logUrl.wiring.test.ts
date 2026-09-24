// round 2, Q7: proves the Sheet-log beacon is actually WIRED, not just documented.
// `docs/analytics.md` and the orchestrator's own instructions to Ben claimed setting the
// repository variable `VITE_LOG_URL` was enough -- false, because neither Shell.svelte's nor
// Report.svelte's `createAnalytics({...})` call ever passed a `logUrl`, and `pages.yml` never
// forwarded the variable into `npx vite build` in the first place. This source-scans all three
// sites directly (the same approach `tests/release/pagesEnvVars.wiring.test.ts` and
// `tests/analytics/noRawLocation.wiring.test.ts` use for their own "is X really wired" gates --
// there is no way to actually run a `.svelte` component or a GitHub Actions workflow here), so a
// regression in any one of the three goes red even though `analyticsLogUrl()` itself
// (logUrl.test.ts) stays green in isolation.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");

describe("the Sheet-log beacon's logUrl is wired end to end (round 2, Q7)", () => {
  it("Shell.svelte passes logUrl: analyticsLogUrl() to createAnalytics()", () => {
    const src = readFileSync(join(ROOT, "src/shell/Shell.svelte"), "utf8");
    expect(src).toMatch(/logUrl:\s*analyticsLogUrl\(/);
  });

  it("Report.svelte passes logUrl: analyticsLogUrl() to createAnalytics()", () => {
    const src = readFileSync(join(ROOT, "src/report/Report.svelte"), "utf8");
    expect(src).toMatch(/logUrl:\s*analyticsLogUrl\(/);
  });

  it("pages.yml forwards VITE_LOG_URL from the repository variable into the published build", () => {
    const pagesYml = readFileSync(join(ROOT, ".github/workflows/pages.yml"), "utf8");
    expect(pagesYml).toMatch(/VITE_LOG_URL:\s*\$\{\{\s*vars\.VITE_LOG_URL\s*\}\}/);
  });
});
