// atlas-8 step 3, pyramid row "Accessibility": **axe everywhere**. The pyramid's wording is "axe
// (zero serious/critical) on every matrix state + the gallery + the report", and until this file
// the axe coverage was four shell states (e2e/shell.a11y.spec.ts: 2 themes x 2 widths), four
// gallery states (e2e/gallery.spec.ts) and one report state (e2e/report.spec.ts) -- nine of the
// 174 runs (58 named view states x 3 viewports) `scripts/verify.mjs` enumerates. A lens panel, a
// legend, a popup or a table that only appears under one `?lyr=`/`?unit=`/`?sp=` combination was
// never audited at all.
//
// The state list is IMPORTED from scripts/verify.mjs (`STATE_MATRIX`), never copied: the matrix and
// the way each of its states is reached (`gotoState()`, extracted in this same change) are one
// definition, exactly as `assertLayout`/`VIEWPORTS` already are for e2e/shell.a11y.spec.ts. Add a
// state there and it is audited here on the next run, automatically.
//
// CHROMIUM ONLY, by the plan's own wording ("axe ... on chromium"): axe-core evaluates the same
// computed accessibility tree in every engine, and the per-engine differences this repo actually
// cares about are KEYBOARD ones (e2e/keyboard-walk.spec.ts, which does run on all three). The
// webkit/firefox projects skip this file via playwright.config.ts's per-project `testIgnore`, so a
// full run reports 179 audits, not 179 audits plus 358 skips.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { gotoState, STATE_MATRIX, VIEWPORTS } from "../scripts/verify.mjs";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { gotoReport } from "./report-hermetic";

// one axe run is a few seconds and each state boots a real MapLibre map; serial would be ~20
// minutes. Every test here is independent (its own page, its own routes), so they parallelise
// across Playwright's workers exactly as separate spec files would.
test.describe.configure({ mode: "parallel" });

/** the same rule set e2e/shell.a11y.spec.ts and e2e/places.spec.ts already audit with. */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** the matrix's own desktop viewport (scripts/verify.mjs's `VIEWPORTS.desktop`), for the pages that
 * are not part of the state matrix (the gallery, the report, the denial dialog) and whose per-width
 * axe coverage already lives in their own specs. */
const DESKTOP = VIEWPORTS.desktop as { width: number; height: number };

async function seriousOrCritical(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

function summarize(bad: Awaited<ReturnType<typeof seriousOrCritical>>): string {
  return JSON.stringify(
    bad.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.html).slice(0, 4),
    })),
    null,
    2,
  );
}

// every state x every viewport `scripts/verify.mjs` itself runs -- the same 58 x 3 = 174 runs its
// own summary line reports, so "axe on every matrix state" means the same set of pages `npm run
// verify` means by it, not a desktop-only subset. Width is not cosmetic here: below 900 px the
// panel is a `Sheet`, not a `Panel` (different DOM, different controls), and the floating legends
// are `display: none`.
test.describe("axe: zero serious/critical on every scripts/verify.mjs matrix state", () => {
  for (const [viewportName, viewport] of Object.entries(
    VIEWPORTS as Record<string, { width: number; height: number }>,
  )) {
    for (const state of STATE_MATRIX as Array<{ name: string; kind: string; path: string }>) {
      test(`${state.name} @ ${viewportName}`, async ({ page, baseURL }) => {
        await page.setViewportSize(viewport);
        await gotoState(page, baseURL!, state);
        const bad = await seriousOrCritical(page);
        expect(bad, summarize(bad)).toEqual([]);
      });
    }
  }
});

// the gallery is a second, independent Rollup build (vite.gallery.config.ts) that lands in the SAME
// dist/, so this config's `vite preview` serves it too -- no second server needed. e2e/gallery.spec.ts
// audits it per theme/width with the pinned `incomplete` triage; this is the "+ the gallery" half of
// the pyramid row, kept beside the matrix so one run covers the whole sentence.
test.describe("axe: zero serious/critical on the gallery", () => {
  for (const theme of ["navy", "paper"] as const) {
    test(`gallery (theme=${theme})`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await routeSealFixture(page);
      await page.goto(`/gallery.html?theme=${theme}`);
      await page.waitForSelector(".gallery", { state: "attached" });
      const bad = await seriousOrCritical(page);
      expect(bad, summarize(bad)).toEqual([]);
    });
  }
});

// "+ the report": report.html in both of its access states (a public release, and a restricted one
// on a preview session -- the latter adds the gold PREVIEW banner and the print watermark, extra
// nodes the public document never renders), through e2e/report-hermetic.ts's own fixtures.
test.describe("axe: zero serious/critical on report.html", () => {
  for (const [name, opts] of [
    ["public release (v7)", { ver: "v7", preview: false }],
    ["restricted release on a preview session (v9)", { ver: "v9", preview: true }],
  ] as const) {
    test(name, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await gotoReport(page, opts);
      await expect(page.locator(".progress-line").first()).toContainText("Done");
      const bad = await seriousOrCritical(page);
      expect(bad, summarize(bad)).toEqual([]);
    });
  }
});

// the one state the matrix structurally cannot reach: the D6 denial notice. `?ver=v9` on the public
// host falls through to latest.txt and AUTO-OPENS the version picker dialog (Shell.svelte's
// `early.denied` handler) -- a modal rendered without any user action, i.e. exactly the kind of
// surface an axe sweep of "normal" states never sees.
test.describe("axe: zero serious/critical on the auto-opened denial dialog (D15)", () => {
  test("public host + ?ver=v9", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await routeBucket(page, "v7");
    await routeSession(page, null);
    await routeSealFixture(page);
    await page.goto("/?ver=v9");
    await waitForHydration(page);
    await expect(page.getByRole("dialog", { name: "Data release" })).toBeVisible();
    const bad = await seriousOrCritical(page);
    expect(bad, summarize(bad)).toEqual([]);
  });
});
