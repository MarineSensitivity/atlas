// D1 (Opus 5.5 eyes-on assessment, 2026-09-24, plans_todo/atlas-refs/): every desktop map's
// floating legend (ScoresLegend.svelte/SpeciesLegend.svelte) sat FIXED bottom-right
// (`right/bottom: var(--space-3)`) while the default right-docked panel (R1, `#panel-region`,
// z-index 16) fills that exact corner top-to-bottom -- the legend rendered UNDER the panel's
// glass, a blurred smudge with no key visible on every desktop map (x~965-1245, y~680-775 at
// 1280x800). Fix: `Shell.svelte` mirrors the panel's live `dock`/`maximized` state onto `.stage`
// (the legend's own positioned ancestor) as `data-panel-dock`/`data-panel-maximized`; the legend
// reads those to reposition clear of whichever corner the docked panel currently fills, and hides
// outright while the panel is maximized (it then covers the whole stage -- no free map left).
//
// RED-FIRST: this spec fails on the pre-fix tree (default dock=right: the legend's box intersects
// the panel's). Reuses `e2e/scores-hermetic.ts`'s `gotoScoresMap` (the same hermetic v7 boot/zones/
// titiler fixtures `e2e/scores.collapsed-panel.spec.ts` already proves renders a visible
// `[data-testid="scores-legend"]`), rather than building a second boot fixture.
import { expect, test, type Page } from "@playwright/test";
import { gotoScoresMap } from "./scores-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function legend(page: Page) {
  return page.locator('[data-testid="scores-legend"]');
}

function panelSurface(page: Page) {
  return page.locator("#panel-region .panel-surface");
}

/** the legend's box does not overlap the panel's, the rail's, or the attribution chip's. */
async function assertLegendClear(page: Page): Promise<void> {
  const legendBox = await legend(page).boundingBox();
  expect(legendBox, "legend has no box (not visible)").not.toBeNull();
  const panelBox = await page.locator("#panel-region").boundingBox();
  const railBox = await page.locator("#rail-region").boundingBox();
  const attributionBox = await page.locator('[data-testid="map-attribution"]').boundingBox();
  expect(panelBox, "panel has no box").not.toBeNull();
  expect(railBox, "rail has no box").not.toBeNull();
  expect(attributionBox, "attribution has no box").not.toBeNull();
  expect(
    intersects(legendBox!, panelBox!),
    `legend ${JSON.stringify(legendBox)} intersects the panel ${JSON.stringify(panelBox)}`,
  ).toBe(false);
  expect(
    intersects(legendBox!, railBox!),
    `legend ${JSON.stringify(legendBox)} intersects the rail ${JSON.stringify(railBox)}`,
  ).toBe(false);
  expect(
    intersects(legendBox!, attributionBox!),
    `legend ${JSON.stringify(legendBox)} intersects the attribution chip ${JSON.stringify(attributionBox)}`,
  ).toBe(false);
}

test.describe("D1: the desktop legend stays clear of the panel at every dock", () => {
  test("dock=right (the default): the legend does not sit under the panel", async ({ page }) => {
    await gotoScoresMap(page, "v7");
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "right");
    await assertLegendClear(page);
  });

  test("dock=left: still clear of the panel, the rail and the attribution chip", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    await panelSurface(page).getByRole("button", { name: "Dock left" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "left");
    await assertLegendClear(page);
  });

  test("dock=bottom: still clear of the panel, the rail and the attribution chip", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    await panelSurface(page).getByRole("button", { name: "Dock bottom" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "bottom");
    await assertLegendClear(page);
  });

  test("dock=right, resized to its widest (720px): the invariant still holds", async ({ page }) => {
    await gotoScoresMap(page, "v7");
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowLeft"); // 380 + 8*50 -> clamps at 720
    await expect(handle).toHaveAttribute("aria-valuenow", "720");
    await assertLegendClear(page);
  });

  test("dock=bottom, resized taller: the invariant still holds", async ({ page }) => {
    await gotoScoresMap(page, "v7");
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    await panelSurface(page).getByRole("button", { name: "Dock bottom" }).click();
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowUp"); // 380 + 6*50 = 680
    await expect(handle).toHaveAttribute("aria-valuenow", "680");
    await assertLegendClear(page);
  });

  test("maximized: the legend hides (the panel covers the whole stage -- no free map left)", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    await panelSurface(page).getByRole("button", { name: "Full screen" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "true");
    await expect(legend(page)).not.toBeVisible();
  });
});
