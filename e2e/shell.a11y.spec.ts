import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession } from "./hermetic";
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

test.describe("axe: zero serious/critical findings, both themes, both widths", () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${theme} @ ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoShell(page, theme);
        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
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
    // tests below (roving tabindex, Esc, the / shortcut) do not depend on native Tab and pass on
    // webkit already.
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

  test("the search field is reachable and the / shortcut focuses it", async ({ page }) => {
    await gotoShell(page, "navy");
    await page.locator("body").click({ position: { x: 5, y: 5 } }); // ensure nothing is focused
    await page.keyboard.press("/");
    await expect(page.getByLabel("Search species and places")).toBeFocused();
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
