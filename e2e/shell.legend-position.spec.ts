// D1 (Opus 5.5 eyes-on assessment, 2026-09-24, plans_todo/atlas-refs/): every desktop map's
// floating legend (ScoresLegend.svelte/SpeciesLegend.svelte) must never sit under the docked panel
// (`#panel-region`, z-index 16) -- once it rendered UNDER the panel's glass, a blurred smudge with
// no key visible. `Shell.svelte` mirrors the panel's live `dock`/`maximized` state onto `.stage`
// (the legend's own positioned ancestor) as `data-panel-dock`/`data-panel-maximized`; the legend
// reads those to float over free map on the side OPPOSITE the panel, and hides outright while the
// panel takes the whole stage.
//
// R4-B (2026-09-30): the panel docks LEFT by default with the rail attached to its outer edge, so
// the legend takes the bottom-RIGHT corner (stacked above the attribution chip, which moved there
// too) and mirrors to bottom-left when the panel is moved right. Dock-bottom and Full screen
// retired; Table (`data-maximized="true"`) takes the whole stage and hides the legend.
//
// RED-FIRST: this spec fails when the legend's box intersects the panel's or the rail's. Reuses
// `e2e/scores-hermetic.ts`'s `gotoScoresMap` (the same hermetic v7 boot/zones/titiler fixtures
// `e2e/scores.collapsed-panel.spec.ts` already proves renders a visible
// `[data-testid="scores-legend"]`), rather than building a second boot fixture.
import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./hermetic";
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

test.describe("D1/R4-B: the desktop legend stays clear of the panel and rail on both sides", () => {
  test("dock=left (the default): the legend is bottom-right, clear of the panel, rail and credit", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "left");
    await assertLegendClear(page);
    const stage = (await page.locator("#stage").boundingBox())!;
    const box = (await legend(page).boundingBox())!;
    expect(box.x + box.width / 2, "the legend sits in the right half").toBeGreaterThan(
      stage.x + stage.width / 2,
    );
  });

  test("dock=right: the legend mirrors to bottom-left, still clear of the panel, rail and credit", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    await panelSurface(page).getByRole("button", { name: "Move panel to the right" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "right");
    await assertLegendClear(page);
    const stage = (await page.locator("#stage").boundingBox())!;
    const box = (await legend(page).boundingBox())!;
    expect(box.x + box.width / 2, "the legend sits in the left half").toBeLessThan(
      stage.x + stage.width / 2,
    );
  });

  for (const dock of ["left", "right"] as const) {
    test(`dock=${dock}, resized to its widest (720px): the invariant still holds`, async ({
      page,
    }) => {
      await gotoScoresMap(page, "v7");
      await expect(legend(page)).toBeVisible({ timeout: 15_000 });
      if (dock === "right") {
        await panelSurface(page).getByRole("button", { name: "Move panel to the right" }).click();
      }
      const handle = panelSurface(page).locator(".resize-handle");
      await handle.focus();
      // the arrow that GROWS the panel is toward the map: Right on a left dock, Left on a right one
      const grow = dock === "left" ? "Shift+ArrowRight" : "Shift+ArrowLeft";
      for (let i = 0; i < 8; i++) await page.keyboard.press(grow); // 380 + 8*50 -> clamps at 720
      await expect(handle).toHaveAttribute("aria-valuenow", "720");
      await assertLegendClear(page);
    });
  }

  test("Table takes the whole stage: the legend hides (no free map left)", async ({ page }) => {
    await gotoScoresMap(page, "v7");
    await expect(legend(page)).toBeVisible({ timeout: 15_000 });
    await page
      .locator('#rail-region [role="toolbar"]')
      .getByRole("button", { name: "Table", exact: true })
      .click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "true");
    await expect(legend(page)).not.toBeVisible();
  });
});

// R4-A made the legend card ~50px taller once it carries a histogram (`/cog/statistics`) and a
// clicked-value marker; R4-B owns its mirrored position, so the same invariant is asserted with
// BOTH present, on both sides. The stats route is registered AFTER `gotoScoresMap` (which routes the
// whole titiler host to a PNG stub -- a later registration wins) and the page is reloaded so the
// legend's fetch goes through it. The marker comes from picking a Program Area in the top-bar
// search (engine-free: the zone's value is read from boot.json).
test.describe("R4-B: the taller legend (histogram + marker) still clears the panel on both sides", () => {
  const STATS = {
    b1: {
      min: 0,
      max: 90,
      histogram: [
        [5, 20, 40, 10],
        [0, 22, 45, 67, 90],
      ],
    },
  };

  async function gotoTallLegend(page: Page): Promise<void> {
    await gotoScoresMap(page, "v7");
    await page.route(
      (url) =>
        url.hostname === "titiler-v8.marinesensitivity.org" &&
        url.pathname.startsWith("/cog/statistics"),
      (route) => route.fulfill({ status: 200, contentType: "application/json", json: STATS }),
    );
    await page.reload();
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    await expect(legend(page).getByTestId("legend-histogram")).toBeVisible({ timeout: 15_000 });
    const input = page.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await input.fill("GAA");
    await expect(page.getByRole("option", { name: /GAA/ })).toBeVisible();
    await input.press("Enter");
    await expect(legend(page).getByTestId("legend-marker")).toBeVisible({ timeout: 15_000 });
  }

  for (const dock of ["left", "right"] as const) {
    test(`dock=${dock}: histogram + marker present, the legend stays fully on screen and clear`, async ({
      page,
    }) => {
      await gotoTallLegend(page);
      if (dock === "right") {
        await panelSurface(page).getByRole("button", { name: "Move panel to the right" }).click();
        await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "right");
      }
      await assertLegendClear(page);
      const box = (await legend(page).boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.x, "legend left edge on screen").toBeGreaterThanOrEqual(0);
      expect(box.y, "legend top edge on screen").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "legend right edge on screen").toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height, "legend bottom edge on screen").toBeLessThanOrEqual(vp.height);
    });
  }
});
