// atlas-8 phase review M8 (SC 2.4.2 Page Titled, cheap missing test): report.html is the third of
// the three entry points docs/accessibility.md claims a title for, alongside index.html
// (e2e/shell.a11y.spec.ts) and gallery.html (e2e/gallery.spec.ts). Its own suite,
// e2e/report.spec.ts, is a different round's file (see this round's plan) -- this is a SEPARATE,
// minimal spec so that file need not be touched, reusing its already-exported hermetic fixtures
// (e2e/report-hermetic.ts, not a `*.spec.ts` itself, so Playwright never double-runs it).
import { expect, test } from "@playwright/test";
import { gotoReport } from "./report-hermetic";

test("report.html has its own descriptive title", async ({ page }) => {
  await gotoReport(page, { ver: "v7" });
  await expect(page).toHaveTitle("MarineSensitivity Atlas — Report");
});
