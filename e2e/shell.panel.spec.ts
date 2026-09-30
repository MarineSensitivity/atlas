// R1 (docs/usability.md §7, owner decision 2026-09-24) + R4-B (2026-09-30): the dockable panel --
// docked LEFT by default with the rail attached to its outer edge, ONE "move to the other side"
// button (dock-bottom and Full screen retired), drag-resize + arrow-key resize on the map-facing
// edge, Table taking the whole stage by itself, collapse to a pill (a click on the ACTIVE rail entry
// collapses too), remembered per viewport in localStorage, NEVER the URL. HERMETIC, same convention
// as e2e/keyboard-walk.spec.ts (whose BOOT fixture -- `units: []`, zones read verbatim from
// boot.json -- this file borrows the shape of, so no PMTiles/titiler route is needed either).
//
// The owner's zones-table acceptance case (2026-09-24, with a screenshot): the Table tool's
// wide-content tabs are what a full-stage surface is FOR (usability M6). Proven on the ZONES tab
// (boot-data only, no DuckDB engine): Table gets the whole stage with every column visible and no
// horizontal scroll.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs } from "./map-hermetic";

test.describe.configure({ mode: "serial" });

const VER = "v7";
const COMPOSITE_KEY = "score_overall";
const COMPONENT_KEYS = ["c1", "c2", "c3", "c4", "c5", "c6"];
const N_ZONES = 20;

function zoneMetrics(i: number): Record<string, number> {
  const metrics: Record<string, number> = { [COMPOSITE_KEY]: 100 - i };
  for (const k of COMPONENT_KEYS) metrics[k] = (i * 7) % 100;
  return metrics;
}

const BOOT = {
  ver: VER,
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  grid: { grid_id: "test05r" },
  release: { status: "release", access: "public" },
  units: [], // no drawable unit published -- the zones table ranks boot.zones verbatim, no engine
  zones: {
    programarea: Array.from({ length: N_ZONES }, (_, i) => ({
      key: `Z${i}`,
      name: `Zone ${i}`,
      metrics: zoneMetrics(i),
    })),
  },
  datasets: [],
  layers: [
    { metric_key: COMPOSITE_KEY, label: "Overall score", category: "composite", order: 1 },
    ...COMPONENT_KEYS.map((k, i) => ({
      metric_key: k,
      label: `Component ${i + 1}`,
      category: "component",
      order: i + 2,
    })),
  ],
};

async function gotoApp(page: Page, path = "/") {
  await blockWasm(page);
  await routeBucket(page, VER, BOOT);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.goto(path);
  await waitForHydration(page);
}

/** the rail entry, scoped to the rail (the collapsed pill and the panel header carry names too). */
function railButton(page: Page, name: string) {
  return page.locator('#rail-region [role="toolbar"]').getByRole("button", { name, exact: true });
}

async function gotoTable(page: Page, path = "/") {
  await gotoApp(page, path);
  await railButton(page, "Table").click();
  await page.getByRole("button", { name: "Zones", exact: true }).click();
  await expect(page.getByRole("table", { name: /^Zones ranked by/ })).toBeVisible();
}

function panelSurface(page: Page) {
  return page.locator("#panel-region .panel-surface");
}

async function urlSnapshot(page: Page) {
  return page.evaluate(() => ({ search: location.search, hash: location.hash }));
}

test.describe("R4-B: left by default, one move-to-the-other-side button", () => {
  test("the panel and its rail start on the LEFT; the swap button moves both, and back", async ({
    page,
  }) => {
    await gotoApp(page);
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "left");
    await expect(page.locator("#rail-region")).toHaveAttribute("data-dock", "left");
    const before = await urlSnapshot(page);

    await panelSurface(page).getByRole("button", { name: "Move panel to the right" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "right");
    await expect(page.locator("#rail-region")).toHaveAttribute("data-dock", "right");
    // R1: layout is chrome -- never the URL.
    expect(await urlSnapshot(page)).toEqual(before);

    await panelSurface(page).getByRole("button", { name: "Move panel to the left" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "left");
    await expect(page.locator("#rail-region")).toHaveAttribute("data-dock", "left");
  });

  test("dock-bottom and Full screen are gone from the header", async ({ page }) => {
    await gotoApp(page);
    for (const name of ["Dock bottom", "Dock left", "Dock right", "Full screen", "Restore"]) {
      await expect(panelSurface(page).getByRole("button", { name })).toHaveCount(0);
    }
  });

  // the rail is ATTACHED to the panel: on the screen edge, panel beside it, a small gap, on either
  // side -- the regression `rail-detached-from-panel` would be a rail stuck at the old left edge
  // while the panel docks right (or a gap that grows with the panel).
  for (const dock of ["left", "right"] as const) {
    test(`the rail sits on the OUTER edge and the panel opens beside it (dock ${dock})`, async ({
      page,
    }) => {
      await gotoApp(page);
      if (dock === "right") {
        await panelSurface(page).getByRole("button", { name: "Move panel to the right" }).click();
        await expect(page.locator("#rail-region")).toHaveAttribute("data-dock", "right");
      }
      const stage = (await page.locator("#stage").boundingBox())!;
      const rail = (await page.locator("#rail-region").boundingBox())!;
      const panel = (await page.locator("#panel-region").boundingBox())!;
      if (dock === "left") {
        expect(rail.x - stage.x, "rail is on the left screen edge").toBeLessThan(20);
        const gap = panel.x - (rail.x + rail.width);
        expect(gap, "panel starts beside the rail").toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(16);
      } else {
        expect(
          stage.x + stage.width - (rail.x + rail.width),
          "rail is on the right edge",
        ).toBeLessThan(20);
        const gap = rail.x - (panel.x + panel.width);
        expect(gap, "panel ends beside the rail").toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(16);
      }
      expect(Math.abs(rail.y - panel.y), "rail and panel tops align").toBeLessThanOrEqual(1);
    });
  }
});

test.describe("R1: drag-resize and arrow-key resize on the map-facing edge", () => {
  test("dragging the resize handle changes the reported size, clamped to 320-720", async ({
    page,
  }) => {
    await gotoApp(page); // default dock: left, Layers open
    const handle = panelSurface(page).locator(".resize-handle");
    const box = await handle.boundingBox();
    if (!box) throw new Error("resize handle has no box");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const before = await page
      .locator("#panel-region")
      .evaluate((el) => el.style.getPropertyValue("--panel-size"));

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // dock=left: the map-facing edge is the RIGHT edge; dragging further right grows the panel.
    await page.mouse.move(startX + 150, startY, { steps: 5 });
    await page.mouse.up();

    const after = await page
      .locator("#panel-region")
      .evaluate((el) => el.style.getPropertyValue("--panel-size"));
    expect(after).not.toBe(before);
    const afterPx = Number(after.replace("px", ""));
    expect(afterPx).toBeGreaterThan(Number(before.replace("px", "")));
    expect(afterPx).toBeLessThanOrEqual(720);
  });

  test("arrow keys resize by 10px, Shift+arrow by 50px, on the dock=left handle", async ({
    page,
  }) => {
    await gotoApp(page);
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    await expect(handle).toHaveAttribute("aria-valuenow", "380");
    // dock=left: ArrowRight grows.
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "390");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "440");
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "430");
  });

  test("dock=right reverses which arrow grows the panel", async ({ page }) => {
    await gotoApp(page);
    await panelSurface(page).getByRole("button", { name: "Move panel to the right" }).click();
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "390");
  });
});

test.describe("R4-B: Table takes the full stage; leaving it restores the side dock", () => {
  test("Table fills the stage beside the rail, with no backdrop and no resize handle", async ({
    page,
  }) => {
    await gotoTable(page);
    const region = page.locator("#panel-region");
    await expect(region).toHaveAttribute("data-maximized", "true");
    await expect(page.locator(".panel-backdrop")).toHaveCount(0);
    await expect(panelSurface(page).locator(".resize-handle")).toHaveCount(0);
    const box = (await region.boundingBox())!;
    const stage = (await page.locator("#stage").boundingBox())!;
    const rail = (await page.locator("#rail-region").boundingBox())!;
    // stage minus the rail and the two 12px insets -- never under the rail, never a docked 380
    expect(box.width).toBeGreaterThan(stage.width - rail.width - 60);
    expect(box.x, "the table starts beside the rail, not under it").toBeGreaterThanOrEqual(
      rail.x + rail.width,
    );
    expect(box.width).toBeGreaterThan(800);
    // the panel's OWN content box (one level in) drops the 720px docked ceiling too -- not just the
    // frame around it (R1's V1 regression, now for the full-stage Table)
    const panelBox = (await page.locator(".panel").boundingBox())!;
    expect(panelBox.width, "the panel's own box is capped below the stage").toBeGreaterThan(800);
  });

  test("leaving Table restores the side dock at the size the panel had", async ({ page }) => {
    await gotoApp(page);
    const region = page.locator("#panel-region");
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "430");

    await railButton(page, "Table").click();
    await expect(region).toHaveAttribute("data-maximized", "true");
    await railButton(page, "Layers").click();
    await expect(region).toHaveAttribute("data-maximized", "false");
    await expect(region).toHaveAttribute("data-dock", "left");
    await expect(region).toHaveAttribute("style", /--panel-size:\s*430px/);
    const box = (await region.boundingBox())!;
    expect(Math.round(box.width)).toBe(430);
  });

  test("Details and Report open as a side panel, not full stage", async ({ page }) => {
    await gotoApp(page);
    for (const name of ["Details", "Report"]) {
      await railButton(page, name).click();
      await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "false");
    }
  });
});

test.describe("R4-B: collapse -- the pill, and the rail (which stays) reopens it", () => {
  test("collapse -> pill -> a rail click reopens the SAME tool", async ({ page }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Collapse to a pill" }).click();
    await expect(page.locator("#panel-region .panel-pill")).toBeVisible();
    await expect(page.locator("#rail-region")).toBeVisible();
    await railButton(page, "Table").click();
    await expect(page.locator("#panel-region .panel-surface")).toBeVisible();
  });

  test("a click on the ACTIVE rail entry collapses the panel; the rail stays; any entry reopens", async ({
    page,
  }) => {
    await gotoApp(page);
    await expect(panelSurface(page)).toBeVisible();
    await railButton(page, "Layers").click(); // Layers is the active tool
    await expect(page.locator("#panel-region .panel-pill")).toBeVisible();
    await expect(page.locator("#rail-region")).toBeVisible();
    await railButton(page, "Details").click(); // a different entry opens it, on that tool
    await expect(panelSurface(page)).toBeVisible();
    await expect(railButton(page, "Details")).toHaveAttribute("aria-current", "true");
  });

  test("Esc collapses the panel", async ({ page }) => {
    await gotoApp(page);
    await panelSurface(page).getByRole("button", { name: "Collapse to a pill" }).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#panel-region .panel-pill")).toBeVisible();
  });
});

test.describe("R1: geometry is chrome -- remembered per viewport, never the URL", () => {
  test("side + size survive a reload; the URL never carried them", async ({ page }) => {
    await gotoApp(page);
    await panelSurface(page).getByRole("button", { name: "Move panel to the right" }).click();
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    await page.keyboard.press("Shift+ArrowLeft"); // dock=right: ArrowLeft grows
    await expect(handle).toHaveAttribute("aria-valuenow", "430");
    const url = await urlSnapshot(page);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");

    await page.reload();
    await waitForHydration(page);
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "right");
    await expect(page.locator("#panel-region")).toHaveAttribute("style", /--panel-size:\s*430px/);
  });

  test("a stored bottom dock or maximized from an older build loads as the default side, not an error", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "atlas.panel.shell.desktop",
        JSON.stringify({ collapsed: false, maximized: true, dock: "bottom", size: 500 }),
      );
    });
    await gotoApp(page);
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "left");
    await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "false");
    await expect(page.locator("#panel-region")).toHaveAttribute("style", /--panel-size:\s*500px/);
  });
});

// ===================================================================================================
// the owner's acceptance case (2026-09-24): the Table tool's wide-content tab, now on the full stage.
// ===================================================================================================

/** every `<th>` in the zones table's header row is within the SCROLLABLE region's own visible box
 * (its right edge does not exceed the container's), and the container has no horizontal overflow. */
async function assertAllColumnsVisible(page: Page, minColumns: number) {
  const container = page.locator(".zones-table");
  const table = page.getByRole("table", { name: /^Zones ranked by/ });
  const headers = table.locator("thead th");
  const count = await headers.count();
  expect(count).toBeGreaterThanOrEqual(minColumns);

  const overflow = await container.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, "the zones table scrolls horizontally").toBeLessThanOrEqual(1);

  const containerBox = await container.boundingBox();
  for (let i = 0; i < count; i++) {
    const box = await headers.nth(i).boundingBox();
    expect(box, `column ${i} has no box`).not.toBeNull();
    expect(
      box!.x + box!.width,
      `column ${i}'s header is not within the table's visible box`,
    ).toBeLessThanOrEqual(containerBox!.x + containerBox!.width + 1);
  }
}

test.describe("owner's acceptance case: the full-stage Table shows every column, no horizontal scroll", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("all 10 columns (Select/Rank/Zone/Score + 6 components) fit with no scroll", async ({
    page,
  }) => {
    await gotoTable(page);
    await assertAllColumnsVisible(page, 10);
  });
});
