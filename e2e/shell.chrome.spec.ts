// R2 (docs/usability.md §7, owner decision 2026-09-24): "About this release" leaves the on-map
// bottom-left card for an (i) popover-dialog top-right; "Feedback" (the old "Report a problem"
// link) moves into the top bar beside it; on the phone both -- plus Share/Report/Help -- live
// under one ⋯ overflow menu (`role="menu"`, arrow keys, Esc). HERMETIC, same convention as
// e2e/shell.a11y.spec.ts.
//
// R2, round 2 (owner finding on live 0.10.36 at 390x844): the guided tour was reachable ONLY
// through the desktop (?) Help menu, so a phone visitor had no way to start it at all. The ⋯
// menu's "Help" item is now two items -- "Take a tour" (the same tour start the desktop Help
// menu's own button uses, see e2e/tour.spec.ts for the full step-by-step walk) and "Docs"
// (unchanged) -- and "Send feedback" is renamed to exactly "Feedback" (owner decision R2),
// matching the desktop top-bar control's own label.
//
// Also covers the map-chrome parity audit (2026-09-24): MapLibre + CARTO/OSM attribution, visible
// with no interaction at both viewports -- a labelled region OUTSIDE `#map` (never a MapLibre-
// injected in-map control), since `#map` carries `role="img"` and ARIA forbids a role=img element
// having accessible descendants at all (Shell.svelte's own header comment on `.map-attribution`).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { SCORES_TOUR_STEPS } from "../src/shell/tour";

async function gotoShell(page: Page, viewport: { width: number; height: number }) {
  await routeBucket(page, "v7");
  await routeSession(page, null);
  await routeSealFixture(page);
  await page.setViewportSize(viewport);
  await page.goto("/?theme=navy");
  await waitForHydration(page);
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

test.describe("R2: About popover", () => {
  test("the (i) button opens a dialog with release/app/seal/links, at >= 72px", async ({
    page,
  }) => {
    await gotoShell(page, DESKTOP);
    const trigger = page.locator('[data-control="about"]');
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "About this release" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("v7");
    await expect(dialog).toContainText("Atlas");

    // D10: the seal, when it renders, is never smaller than 72px on its own plate.
    const seal = dialog.locator("img[alt^='Seal of the']");
    if (await seal.count()) {
      const box = await seal.boundingBox();
      expect(box, "seal has no box").not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(72);
      expect(box!.height).toBeGreaterThanOrEqual(72);
    }

    await expect(dialog.getByRole("link", { name: "Documentation" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "GitHub" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "What changed" })).toBeVisible();
  });

  test("a restricted release carries the watermark note; a public one does not", async ({
    page,
  }) => {
    await routeBucket(page, "v9");
    await routeSession(page, { preview: true, ver: "v9" });
    await routeSealFixture(page);
    await page.setViewportSize(DESKTOP);
    await page.goto("/?ver=v9&theme=navy");
    await waitForHydration(page);

    await page.locator('[data-control="about"]').click();
    const dialog = page.getByRole("dialog", { name: "About this release" });
    await expect(dialog).toContainText("pre-release under review");
  });

  test("the public release (v7, this file's default fixture) shows no restricted note", async ({
    page,
  }) => {
    await gotoShell(page, DESKTOP);
    await page.locator('[data-control="about"]').click();
    const dialog = page.getByRole("dialog", { name: "About this release" });
    await expect(dialog).not.toContainText("pre-release under review");
  });
});

test.describe("R2: Send feedback", () => {
  // U3 (round 2) landed after this control did: `onFeedbackClick` is now Shell.svelte's own
  // `openFeedback()` (the real FeedbackDialog.svelte, lazy-loaded), not a plain `feedbackHref`
  // navigation -- see TopBarActions.svelte's own header for the one-line rewiring. This still
  // stays behind ONE function boundary: e2e/feedback.spec.ts's own dialog-content/submit
  // assertions are untouched by that (they already click `[data-control="feedback"]`, which now
  // resolves to THIS top-bar control instead of the removed on-map anchor) -- this spec only
  // proves BOTH of R2's own triggers (the desktop control, the phone ⋯ item) reach the same
  // dialog, which is R2's own concern.
  test("the top-bar Feedback control opens the real feedback dialog", async ({ page }) => {
    await gotoShell(page, DESKTOP);
    const feedback = page.locator('[data-control="feedback"]');
    await expect(feedback).toHaveText(/Feedback/);
    // the href fallback (JS disabled/failed, middle-click) is still a real GitHub issue link --
    // unaffected by the dialog now handling a plain left click instead.
    await expect(feedback).toHaveAttribute("href", /github\.com/);
    await feedback.click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Feedback" })).toBeVisible();
  });

  test("the phone ⋯ menu's Feedback item opens the same real feedback dialog", async ({ page }) => {
    await gotoShell(page, PHONE);
    await page.locator('[data-control="more-menu"]').click();
    const menu = page.getByRole("menu", { name: "More" });
    // R2 round 2: "Send feedback" -> exactly "Feedback" (owner decision), matching the desktop
    // top-bar control's own label.
    await menu.getByRole("menuitem", { name: "Feedback" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Feedback" })).toBeVisible();
  });
});

test.describe("R2: phone ⋯ overflow menu", () => {
  test("at 390x844, the ⋯ trigger opens a role=menu with Share/Report/Feedback/About/Take a tour/Docs", async ({
    page,
  }) => {
    await gotoShell(page, PHONE);
    const trigger = page.locator('[data-control="more-menu"]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const menu = page.getByRole("menu", { name: "More" });
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitem");
    // R2 round 2: "Help" split into "Take a tour" + "Docs" (the tour was unreachable on the phone
    // otherwise), "Send feedback" renamed to "Feedback" -- final order below.
    await expect(items).toHaveCount(6);
    const labels = await items.evaluateAll((els) => els.map((e) => e.textContent?.trim()));
    expect(labels).toEqual([
      "Share",
      "Report",
      "Feedback",
      "About this release",
      "Take a tour",
      "Docs",
    ]);

    // opening the menu moves focus to its first item.
    await expect(items.first()).toBeFocused();
  });

  test("arrow keys move focus within the menu, wrapping at both ends", async ({ page }) => {
    await gotoShell(page, PHONE);
    await page.locator('[data-control="more-menu"]').click();
    const menu = page.getByRole("menu", { name: "More" });
    const items = menu.getByRole("menuitem");

    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.first()).toBeFocused();
    // wrap backward past the first item to the last.
    await page.keyboard.press("ArrowUp");
    await expect(items.last()).toBeFocused();
  });

  test("Esc closes the menu and returns focus to the ⋯ trigger", async ({ page }) => {
    await gotoShell(page, PHONE);
    const trigger = page.locator('[data-control="more-menu"]');
    await trigger.click();
    await expect(page.getByRole("menu", { name: "More" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "More" })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("selecting 'About this release' from the menu opens the About dialog", async ({ page }) => {
    await gotoShell(page, PHONE);
    await page.locator('[data-control="more-menu"]').click();
    await page.getByRole("menuitem", { name: "About this release" }).click();
    await expect(page.getByRole("dialog", { name: "About this release" })).toBeVisible();
  });

  // R2 round 2 (owner finding, live 0.10.36 at 390x844): the tour was unreachable on the phone
  // once the welcome modal was dismissed -- "Take a tour" now runs the SAME tour start the desktop
  // Help menu's own button uses (Shell.svelte's `onHelpTakeTour`). The full step-by-step walk
  // (every anchor resolves, keyboard trap, axe) is e2e/tour.spec.ts's job on the desktop viewport;
  // this only proves the phone trigger reaches it and Esc leaves the shell exactly as it found it.
  test("selecting 'Take a tour' starts the SAME tour the desktop Help menu uses; Esc restores the URL", async ({
    page,
  }) => {
    await gotoShell(page, PHONE);
    const before = page.url();

    await page.locator('[data-control="more-menu"]').click();
    await page.getByRole("menuitem", { name: "Take a tour" }).click();

    // the ⋯ menu closes before the tour starts (onMoreItemClick calls closeMore() first).
    await expect(page.getByRole("menu", { name: "More" })).toHaveCount(0);

    const popover = page.locator(".driver-popover");
    await expect(popover).toBeVisible({ timeout: 10_000 });
    // the default lens on load is "scores" (no `sp` in the URL, defaultLens()), so the first step
    // is SCORES_TOUR_STEPS[0] ("map") -- an anchor that exists at every viewport, phone included.
    await expect(page.locator(".driver-popover-title")).toHaveText(SCORES_TOUR_STEPS[0].title);

    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    expect(page.url()).toBe(before);
  });

  test("desktop shows no ⋯ trigger; phone shows no direct Feedback/About buttons", async ({
    page,
  }) => {
    await gotoShell(page, DESKTOP);
    await expect(page.locator('[data-control="more-menu"]')).toBeHidden();

    await gotoShell(page, PHONE);
    await expect(page.locator('[data-control="feedback"]')).toBeHidden();
    await expect(page.locator('[data-control="about"]')).toBeHidden();
  });
});

test.describe("map-chrome parity audit: MapLibre + CARTO/OSM attribution", () => {
  for (const [name, viewport] of [
    ["desktop 1280x800", { width: 1280, height: 800 }],
    ["phone 390x844", PHONE],
  ] as const) {
    test(`${name}: both credits are visible with no interaction`, async ({ page }) => {
      await gotoShell(page, viewport);
      const attribution = page.locator('[data-testid="map-attribution"]');
      await expect(attribution).toBeVisible();
      await expect(attribution).toContainText("MapLibre");
      await expect(attribution).toContainText("CARTO");
      await expect(attribution).toContainText("OpenStreetMap");
      // a real, followable link (a basemap credit is conventionally a link, not just a label).
      await expect(attribution.getByRole("link", { name: "MapLibre" })).toHaveAttribute(
        "href",
        "https://maplibre.org/",
      );
    });
  }

  test("#map keeps role=img with no accessible descendants -- the attribution is OUTSIDE it, and axe stays green", async ({
    page,
  }) => {
    await gotoShell(page, DESKTOP);
    const map = page.locator("#map");
    await expect(map).toHaveAttribute("role", "img");
    // the attribution is a SIBLING, not a child, of #map.
    await expect(map.locator('[data-testid="map-attribution"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="map-attribution"]')).toHaveCount(1);

    const { violations } = await new AxeBuilder({ page }).include("#map").analyze();
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
