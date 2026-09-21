import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// atlas-3 step 2, Deliverable 3/4: the gallery is the review surface and the Playwright screenshot
// baseline for every src/lib/ui component. This spec covers what tests/**/*.test.ts (vitest,
// pure logic, no DOM) cannot: real rendering, real focus, real keyboard behavior, and axe over the
// actual DOM in both themes at both widths.
//
// HERMETIC: the one external resource the gallery ever requests (the seal image, About.svelte's
// default VITE_SEAL_URL) is routed to a fixture -- this spec never touches the live network,
// matching e2e/shell.smoke.spec.ts's convention.

const THEMES = ["navy", "paper"] as const;
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

const SEAL_FIXTURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">' +
  '<circle cx="100" cy="100" r="90" fill="#123456"/></svg>';

async function routeSealFixture(page: Page) {
  await page.route("**/branding/mma-seal.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: SEAL_FIXTURE_SVG }),
  );
}

async function gotoGallery(page: Page, theme: (typeof THEMES)[number]) {
  await routeSealFixture(page);
  await page.goto(`/gallery.html?theme=${theme}`, { waitUntil: "networkidle" });
}

test.describe("screenshots: every section, both themes, phone and desktop widths", () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${theme} @ ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoGallery(page, theme);
        await expect(page).toHaveScreenshot(`gallery-${theme}-${viewport.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.02,
        });
      });
    }
  }
});

test.describe("axe: zero serious/critical findings, both themes, both widths", () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${theme} @ ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoGallery(page, theme);
        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
      });
    }
  }
});

test.describe("keyboard", () => {
  test("Tab reaches every CURRENT tab stop on the page (roving-tabindex groups excluded from the count on purpose)", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    await page.evaluate(() => {
      let i = 0;
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        if (el.tabIndex >= 0 && el.offsetParent !== null) {
          el.setAttribute("data-tabstop", String(i++));
        }
      }
    });
    const total = await page.evaluate(() => document.querySelectorAll("[data-tabstop]").length);
    expect(total).toBeGreaterThan(20); // sanity: the gallery really has many controls

    const visited = new Set<string>();
    for (let i = 0; i < total + 10; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => document.activeElement?.getAttribute("data-tabstop"));
      if (stop !== null && stop !== undefined) visited.add(stop);
    }
    expect(visited.size).toBe(total);
  });

  test("the rail's roving tabindex moves focus with arrow keys, wrapping at both ends", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const toolbar = page.locator("#rail [role='toolbar']").first();
    await toolbar.locator("button[aria-label='Layers']").focus();

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

  test("the inactive Flower tool (Species lens) is aria-disabled but stays reachable via roving tabindex", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const speciesToolbar = page.locator("#rail [role='toolbar']").nth(1);
    const layers = speciesToolbar.locator("button[aria-label='Layers']");
    const flower = speciesToolbar.locator("button[aria-label='Flower plot']");
    await expect(flower).toHaveAttribute("aria-disabled", "true");
    await expect(flower).not.toHaveAttribute("disabled", "");
    // it is not a static tabindex="-1" (that would be using tabindex as the disabling mechanism,
    // which spec.md §5.2 explicitly rules out) -- roving tabindex must be able to reach it, the
    // same as any enabled control in the group
    await layers.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(flower).toBeFocused();
    await expect(flower).toHaveAttribute("tabindex", "0");
  });

  test("Esc collapses a panel and moves focus to its pill; expanding returns focus to control 1", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const panelSection = page.locator("#panel");
    const collapseBtn = panelSection.locator('[data-panel-control="collapse"]');
    await collapseBtn.focus();
    await page.keyboard.press("Escape");
    const pill = panelSection.locator("button.panel-pill");
    await expect(pill).toBeFocused();
    await pill.press("Enter");
    await expect(panelSection.locator('[data-panel-control="collapse"]')).toBeFocused();
  });

  test("a modal traps focus and returns it to the opener on close (Esc = the top layer)", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const modalSection = page.locator("#modal");
    const openBtn = modalSection.getByRole("button", { name: "Open a modal" });
    await openBtn.focus();
    await page.keyboard.press("Enter");

    const dialog = modalSection.locator("dialog");
    await expect(dialog).toBeVisible();
    const focusInsideDialog = () =>
      page.evaluate(() => document.activeElement?.closest("dialog") !== null);
    expect(await focusInsideDialog()).toBe(true);

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInsideDialog()).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(openBtn).toBeFocused();
  });

  test("every panel-size control group has an accessible name on each of its three buttons", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const group = page.locator("#panel [role='group'][aria-label='Panel size']");
    const names = await group
      .locator("button")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(names).toEqual(["Collapse to a pill", "Half height", "Full height"]);
    for (const name of names) expect(name).toBeTruthy();
  });
});

test.describe("the seal (spec.md §9 / D10)", () => {
  test("renders at >= 72 CSS px only when VITE_SEAL is '1'; never when unset", async ({ page }) => {
    await gotoGallery(page, "navy");
    const on = page.locator("#about figure").nth(0);
    const off = page.locator("#about figure").nth(1);

    const seal = on.locator("img.seal");
    await expect(seal).toBeVisible();
    const box = await seal.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(72);
    expect(box!.height).toBeGreaterThanOrEqual(72);

    await expect(off.locator("img.seal")).toHaveCount(0);
  });
});
