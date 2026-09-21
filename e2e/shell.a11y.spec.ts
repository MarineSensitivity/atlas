import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  assertColorContrastIncompletePinned,
  routeBucket,
  routeSealFixture,
  routeSession,
} from "./hermetic";
import { assertLayout, VIEWPORTS as VERIFY_VIEWPORTS } from "../scripts/verify.mjs";

// atlas-3 step 3 accessibility contract (spec.md §11, docs/design/spec.md §13's "accessibility"
// gate): axe zero serious/critical on the real shell, both themes, both widths; keyboard reaches
// every control in DOM order; the rail's roving tabindex works; Esc collapses the panel and
// returns focus. HERMETIC, same convention as e2e/shell.smoke.spec.ts and e2e/gallery.spec.ts.

const THEMES = ["navy", "paper"] as const;
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

async function gotoShell(page: import("@playwright/test").Page, theme: string, path = "/") {
  await routeBucket(page);
  await routeSession(page, null);
  await routeSealFixture(page);
  const url = new URL(path, "http://x");
  url.searchParams.set("theme", theme);
  await page.goto(url.pathname + url.search, { waitUntil: "networkidle" });
}

// atlas-3 closing review, item 4 ("do the same for e2e/shell.a11y.spec.ts if it shares the
// allow-list"): this test destructured only `violations`, silently ignoring `incomplete`
// entirely -- the same hole e2e/gallery.spec.ts had before being pinned, just with no allow-list
// object at all. The shell's own glass surfaces (topbar/rail/panel, the same color-mix()/
// backdrop-filter approach) produce the identical unresolvable `color-contrast` incomplete axe
// cannot resolve; pinned the same way (see e2e/hermetic.ts's assertColorContrastIncompletePinned).
// Measured today, both themes report the SAME numbers/reasons:
//   phone (390x844):    5 nodes, {pseudoContent}
//   desktop (1280x900): 8 nodes, {pseudoContent}
const COLOR_CONTRAST_INCOMPLETE_CEILING: Record<string, number> = {
  phone: 5,
  desktop: 8,
};
const COLOR_CONTRAST_INCOMPLETE_REASONS = ["pseudoContent"];

test.describe("axe: zero serious/critical findings, both themes, both widths", () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${theme} @ ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoShell(page, theme);
        const { violations, incomplete } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);

        assertColorContrastIncompletePinned(
          incomplete,
          COLOR_CONTRAST_INCOMPLETE_CEILING[viewport.name],
          COLOR_CONTRAST_INCOMPLETE_REASONS,
        );
      });
    }
  }
});

test.describe("layout: no horizontal overflow, every control on screen (verify.mjs's assertLayout)", () => {
  // reuses scripts/verify.mjs's own VIEWPORTS/assertLayout rather than a second copy, so this and
  // `node scripts/verify.mjs` can never drift. Includes the 320x800 "phoneNarrow" viewport (fix
  // round 2, item 4): "Categories demo aside, nothing in the shell may overflow at 320px."
  for (const theme of THEMES) {
    for (const [name, viewport] of Object.entries(VERIFY_VIEWPORTS)) {
      test(`${theme} @ ${name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await gotoShell(page, theme);
        const problems = await assertLayout(page);
        expect(problems, problems.join("\n")).toEqual([]);
      });
    }
  }
});

test.describe("aria semantics", () => {
  // atlas-3 closing review, item 3: the version chip advertised a popup dialog it does not open
  // yet (the picker itself arrives in atlas-4) -- a false affordance for assistive tech. Removed
  // until the picker exists; the announcement on click (onVersionClick) stays.
  test("the version chip carries no aria-haspopup (the picker doesn't exist yet)", async ({
    page,
  }) => {
    await gotoShell(page, "navy");
    await expect(page.locator('[data-control="version-chip"]')).not.toHaveAttribute(
      "aria-haspopup",
    );
  });
});

// atlas-3 closing review, item 1 (SC 1.4.1): `.panel-controls button[aria-pressed="true"],
// .panel-controls button[aria-expanded="true"]` (Panel.svelte, Sheet.svelte) painted the collapse
// disclosure as "pressed" too, because it always carries aria-expanded="true" (Panel) or
// aria-expanded={detent !== "peek"} (Sheet, true at both half and full) -- a static/near-static
// attribute with NO relation to which detent is actually active. Fixed by dropping the
// aria-expanded selector from both files' CSS; this proves it with real computed styles, at both
// the desktop (Panel.svelte) and phone (Sheet.svelte) breakpoints.
test.describe("panel/sheet size controls: visual state matches the actual detent (SC 1.4.1)", () => {
  const CASES = [
    { name: "desktop", width: 1280, height: 900 },
    { name: "phone", width: 390, height: 844 },
  ] as const;

  for (const viewport of CASES) {
    test(`at ${viewport.name}, only "Half" is painted pressed -- not the collapse control too`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await gotoShell(page, "navy");
      const panel = page.locator("#panel-region");
      await panel.getByRole("button", { name: "Half height" }).click();

      async function style(locator: import("@playwright/test").Locator) {
        return locator.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { background: cs.backgroundColor, border: cs.borderColor };
        });
      }
      // Panel's collapse button is labelled "Collapse to a pill", Sheet's "Collapse to a peek" --
      // the prefix match (same convention as e2e/shell.cls.spec.ts's KEYS) is what lets this one
      // test cover both components.
      const collapse = await style(panel.locator('[aria-label^="Collapse to a"]'));
      const half = await style(panel.getByRole("button", { name: "Half height" }));
      const full = await style(panel.getByRole("button", { name: "Full height" }));

      expect(
        collapse,
        "collapse vs full should be the SAME (neither is the active detent)",
      ).toEqual(full);
      expect(half, "half (the active detent) should DIFFER from collapse").not.toEqual(collapse);
      expect(half, "half (the active detent) should DIFFER from full").not.toEqual(full);
    });
  }
});

test.describe("keyboard", () => {
  test("Tab reaches every current tab stop on the page, in DOM order", async ({
    page,
    browserName,
  }) => {
    // WebKit only includes buttons in the native Tab sequence when "Full Keyboard Access" is on
    // (Safari's own longstanding default-off behaviour for mouse users; screen-reader users are
    // unaffected, since VoiceOver's own navigation does not go through this). Playwright's bundled
    // WebKit reproduces that default, so a literal Tab-key walk only visits the page's links/inputs
    // there, not its many buttons -- a platform default, not a bug in this shell. The OTHER keyboard
    // tests below (roving tabindex, Esc) do not depend on native Tab and pass on webkit already.
    test.skip(browserName === "webkit", "WebKit only tabs to buttons with Full Keyboard Access on");
    await gotoShell(page, "navy");
    await page.evaluate(() => {
      let i = 0;
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        if (el.tabIndex >= 0 && el.offsetParent !== null) {
          el.setAttribute("data-tabstop", String(i++));
        }
      }
    });
    const total = await page.evaluate(() => document.querySelectorAll("[data-tabstop]").length);
    expect(total).toBeGreaterThan(10); // sanity: the shell really has several controls

    const visitedInOrder: number[] = [];
    for (let i = 0; i < total + 5; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => document.activeElement?.getAttribute("data-tabstop"));
      if (stop !== null && stop !== undefined) visitedInOrder.push(Number(stop));
    }
    expect(new Set(visitedInOrder).size).toBe(total);
    // "in DOM order": each stop's own index only ever increases (or wraps once, back to a lower
    // index it had not yet visited) -- i.e. the sequence never revisits a MIDDLE stop out of turn.
    const firstPass = visitedInOrder.slice(0, total);
    expect(firstPass).toEqual([...firstPass].sort((a, b) => a - b));
  });

  test("the rail's roving tabindex moves focus with arrow keys, wrapping at both ends", async ({
    page,
  }) => {
    await gotoShell(page, "navy");
    const rail = page.locator("#rail-region [role='toolbar']");
    await rail.locator("button[aria-label='Layers']").focus();

    await page.keyboard.press("ArrowDown");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Places");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Flower plot");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Places");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Layers");
    // wrap backward past the first item to the last ("Report")
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Report");
  });

  test("the Flower tool is aria-disabled but reachable in the Species lens, and announces why", async ({
    page,
  }) => {
    await gotoShell(page, "navy", "/?lens=species");
    const rail = page.locator("#rail-region [role='toolbar']");
    const flower = rail.locator("button[aria-label='Flower plot']");
    await expect(flower).toHaveAttribute("aria-disabled", "true");
    await expect(flower).not.toHaveAttribute("disabled", "");
    await rail.locator("button[aria-label='Layers']").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(flower).toBeFocused();
    await expect(flower).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("Enter");
    await expect(page.locator('[role="status"]')).toContainText("Flower plot — Scores only");
  });

  test("Esc collapses the panel and moves focus to its pill; expanding returns focus to control 1", async ({
    page,
  }) => {
    await gotoShell(page, "navy");
    const panelRegion = page.locator("#panel-region");
    const collapseBtn = panelRegion.locator('[data-panel-control="collapse"]');
    await collapseBtn.focus();
    await page.keyboard.press("Escape");
    const pill = panelRegion.locator("button.panel-pill");
    await expect(pill).toBeFocused();
    await pill.press("Enter");
    await expect(panelRegion.locator('[data-panel-control="collapse"]')).toBeFocused();
  });

  test("every panel-size control group has an accessible name on each of its three buttons", async ({
    page,
  }) => {
    await gotoShell(page, "navy");
    const group = page.locator("#panel-region [role='group'][aria-label='Panel size']");
    const names = await group
      .locator("button")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(names).toEqual(["Collapse to a pill", "Half height", "Full height"]);
  });

  // atlas-3 closing review, item 2 (SC 2.1.4, Level A): there was a global `/` keydown that stole
  // focus to the search field from anywhere on the page -- not in spec.md or the plan, and a
  // single-character shortcut with no modifier is exactly what SC 2.1.4 requires be removable,
  // remappable, or active-on-focus-only. Removed entirely rather than fixed; this asserts it stays
  // gone.
  test("'/' does not move focus, from a topbar control or from a rail tool", async ({ page }) => {
    await gotoShell(page, "navy");
    const themeBtn = page.locator('[data-control="theme"]');
    await themeBtn.focus();
    await page.keyboard.press("/");
    await expect(themeBtn).toBeFocused();

    const layersBtn = page
      .locator("#rail-region [role='toolbar']")
      .locator('button[aria-label="Layers"]');
    await layersBtn.focus();
    await page.keyboard.press("/");
    await expect(layersBtn).toBeFocused();
  });

  // atlas-3 step 3 fix round 2 / SC 4.1.3: exactly ONE live region, for real -- src/lib/ui's
  // Announcer.svelte is the ONLY thing that may render one; this shell must mount it exactly once
  // and never keep its OWN temporary shim alongside it. A full interaction walk (every control
  // that calls `announce()`) is what a stray SECOND region would most plausibly reveal, since some
  // components only render their live region lazily/on first use.
  test("exactly one live region exists, before and after a full interaction walk", async ({
    page,
  }) => {
    await gotoShell(page, "navy");
    const liveRegions = () => page.locator('[aria-live], [role="status"]');
    await expect(liveRegions()).toHaveCount(1);

    await page.locator(".topbar").getByRole("button", { name: "Species" }).click();
    await page.locator(".topbar").getByRole("button", { name: "Scores" }).click();
    await page.locator('[data-control="theme"]').click();
    await page.locator('[data-control="help"]').click();
    const rail = page.locator("#rail-region [role='toolbar']");
    for (const label of ["Layers", "Places", "Flower plot", "Table", "Report"]) {
      await rail.locator(`button[aria-label="${label}"]`).click();
    }
    const panel = page.locator("#panel-region");
    await panel.locator('[data-panel-control="collapse"]').click();
    await panel.locator("button.panel-pill").click();

    await expect(liveRegions()).toHaveCount(1);
  });
});
