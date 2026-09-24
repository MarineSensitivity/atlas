// R1 (docs/usability.md §7, owner decision 2026-09-24): the dockable panel -- dock left/right/
// bottom, drag-resize + arrow-key resize on the map-facing edge, maximize-to-stage with Esc
// restore and a focus trap, remembered per viewport in localStorage, NEVER the URL. HERMETIC, same
// convention as e2e/keyboard-walk.spec.ts (whose BOOT fixture -- `units: []`, zones read verbatim
// from boot.json -- this file borrows the shape of, so no PMTiles/titiler route is needed either).
//
// The owner's species/zones-table acceptance case (2026-09-24, with a screenshot): the Table
// tool's wide-content tabs are what a dockable/resizable/maximizable panel is FOR (usability M6).
// Proven here on the ZONES tab (boot-data only, no DuckDB engine): maximize gives it the whole
// stage with every column visible and no horizontal scroll; the widest left/right dock (720px)
// shows at least six; bottom dock gives it the full stage width and >= 8 rows visible; Esc from
// maximize restores the previous dock AND the table's own scroll position (no remount losing
// state). SpeciesTable.svelte got the IDENTICAL fix (`table-layout: fixed` + ellipsis, same commit)
// but proving it end-to-end needs a real DuckDB-WASM + Parquet fixture (report.spec.ts's own
// `routeEngineFixtures`) that this round did not build -- a known gap, called out in the report
// rather than silently skipped.
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

async function gotoTable(page: Page, path = "/") {
  await blockWasm(page);
  await routeBucket(page, VER, BOOT);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.goto(path);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Zones", exact: true }).click();
  await expect(page.getByRole("table", { name: /^Zones ranked by/ })).toBeVisible();
}

function panelSurface(page: Page) {
  return page.locator("#panel-region .panel-surface");
}

async function urlSnapshot(page: Page) {
  return page.evaluate(() => ({ search: location.search, hash: location.hash }));
}

test.describe("R1: dock left / right / bottom", () => {
  for (const dock of ["left", "bottom", "right"] as const) {
    test(`dock ${dock}: the button is pressed, and #panel-region reports it`, async ({ page }) => {
      await gotoTable(page);
      const before = await urlSnapshot(page);
      await panelSurface(page)
        .getByRole("button", { name: `Dock ${dock}` })
        .click();
      await expect(
        panelSurface(page).getByRole("button", { name: `Dock ${dock}` }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", dock);
      // R1: layout is chrome -- never the URL.
      expect(await urlSnapshot(page)).toEqual(before);
    });
  }
});

test.describe("R1: drag-resize and arrow-key resize on the map-facing edge", () => {
  test("dragging the resize handle changes the reported size, clamped to 320-720", async ({
    page,
  }) => {
    await gotoTable(page); // default dock: right
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
    // dock=right: the map-facing edge is the LEFT edge; dragging further left grows the panel.
    await page.mouse.move(startX - 150, startY, { steps: 5 });
    await page.mouse.up();

    const after = await page
      .locator("#panel-region")
      .evaluate((el) => el.style.getPropertyValue("--panel-size"));
    expect(after).not.toBe(before);
    const afterPx = Number(after.replace("px", ""));
    expect(afterPx).toBeGreaterThan(Number(before.replace("px", "")));
    expect(afterPx).toBeLessThanOrEqual(720);
  });

  test("arrow keys resize by 10px, Shift+arrow by 50px, on the dock=right handle", async ({
    page,
  }) => {
    await gotoTable(page);
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    await expect(handle).toHaveAttribute("aria-valuenow", "380");
    // dock=right: ArrowLeft grows.
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "390");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "440");
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "430");
  });

  test("dock=left reverses which arrow grows the panel", async ({ page }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Dock left" }).click();
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "390");
  });

  test("dock=bottom resizes with Up/Down, and reports height, not width", async ({ page }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Dock bottom" }).click();
    const handle = panelSurface(page).locator(".resize-handle");
    await expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await expect(handle).toHaveAttribute("aria-valuenow", "390");
  });
});

test.describe("R1: maximize", () => {
  test("maximize fills the stage, shows a backdrop, and Esc restores the previous dock", async ({
    page,
  }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Dock left" }).click();
    const before = await urlSnapshot(page);

    await panelSurface(page).getByRole("button", { name: "Full screen" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "true");
    await expect(page.locator(".panel-backdrop")).toBeVisible();
    const region = await page.locator("#panel-region").boundingBox();
    const stage = await page.locator("#stage").boundingBox();
    expect(region!.width).toBeGreaterThan(stage!.width * 0.9);
    expect(region!.height).toBeGreaterThan(stage!.height * 0.9);

    await page.keyboard.press("Escape");
    await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "false");
    // Esc restored the dock the panel had BEFORE maximizing (left, from above) -- not silently
    // reset to the default (right).
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "left");
    expect(await urlSnapshot(page)).toEqual(before);
  });

  // V1 fix (Opus eyes-on review, 2026-09-24, desktop 1280x800): "desktop Full screen panel is
  // capped at 720px" -- `#panel-region[data-maximized="true"]` (shell.css) already spanned the
  // whole stage, but Panel.svelte's OWN `.panel` element (the actual content box, one level
  // further in) still carried its docked-width ceiling (`max-width: 720px`, R1's own docked/half
  // limit) UNCONDITIONALLY -- so a maximized panel's box stayed 720px wide inside a full-width
  // frame, above `region!.width` in the test above (which only checks the outer `#panel-region`
  // and would not have caught this). `.rail-region` floats OVER the stage (`position: absolute`,
  // not in flow), so it costs the panel no width -- the panel should reach very nearly the full
  // stage width, not just >90% of it.
  test("the panel's own content box (not just #panel-region) drops its 720px cap when maximized", async ({
    page,
  }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Full screen" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "true");
    const panelBox = await page.locator(".panel").boundingBox();
    const stageBox = await page.locator("#stage").boundingBox();
    const railBox = await page.locator("#rail-region").boundingBox();
    const railWidth = railBox?.width ?? 0;
    expect(panelBox!.width).toBeGreaterThanOrEqual(stageBox!.width - railWidth - 2);
  });

  test("focus is trapped inside the maximized panel (Tab wraps, never escapes to the rail)", async ({
    page,
  }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Full screen" }).click();
    // shift-tab from the surface (which took focus on maximize) reaches the LAST focusable
    // control inside it; one more shift-tab must wrap back to the last again, never leave.
    await page.keyboard.press("Shift+Tab");
    const lastName = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    for (let i = 0; i < 15; i++) await page.keyboard.press("Tab");
    const stillInside = await page.evaluate(
      () => !!document.activeElement?.closest(".panel-surface--maximized"),
    );
    expect(stillInside, `focus escaped the maximized panel (last stop: ${lastName})`).toBe(true);
  });

  test("clicking the backdrop also restores", async ({ page }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Full screen" }).click();
    // U1 fix round (CI run 35956406448): `.panel-surface--maximized` now paints ABOVE the
    // backdrop (z-index 31 vs 30, see Panel.svelte's own header on that fix) so the panel's OWN
    // controls are clickable while maximized -- a real bug the backdrop's previously-higher
    // z-index caused. Maximized, the panel fills the whole `.stage`, so the backdrop's only
    // still-reachable area is the 48px topbar strip above it (`.topbar`'s own z-index, 20, stays
    // lower than the backdrop's 30, unchanged by this fix) -- click there, not the element's
    // default center (which now lands on the panel's own content).
    await page.locator(".panel-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "false");
  });
});

test.describe("R1: collapse still works (the pre-existing pill), and the rail reopens it", () => {
  test("collapse -> pill -> a rail click reopens the SAME tool", async ({ page }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Collapse to a pill" }).click();
    await expect(page.locator("#panel-region .panel-pill")).toBeVisible();
    // the collapsed pill's OWN accessible name is also "Table" (the active tool) -- scope to the
    // rail so this click cannot resolve ambiguously to either button.
    await page
      .locator('#rail-region [role="toolbar"]')
      .getByRole("button", { name: "Table", exact: true })
      .click();
    await expect(page.locator("#panel-region .panel-surface")).toBeVisible();
    await expect(page.locator(".panel-title")).toHaveText("Table");
  });
});

test.describe("R1: geometry is chrome -- remembered per viewport, never the URL", () => {
  test("dock + size survive a reload; the URL never carried them", async ({ page }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Dock bottom" }).click();
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    await page.keyboard.press("Shift+ArrowUp");
    await expect(handle).toHaveAttribute("aria-valuenow", "430");
    const url = await urlSnapshot(page);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");

    await page.reload();
    await waitForHydration(page);
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "bottom");
    await expect(page.locator("#panel-region")).toHaveAttribute("style", /--panel-size:\s*430px/);
  });
});

// ===================================================================================================
// the owner's acceptance case (2026-09-24): the Table tool's wide-content tabs, at every dock this
// panel model offers. See this file's header for the species-tab scoping decision.
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

/** rows whose bounding box is (at least partly) inside the scroll container's visible viewport. */
async function countVisibleRows(page: Page): Promise<number> {
  return page.locator(".zones-table").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll("tbody tr")];
    return rows.filter((r) => {
      const rr = r.getBoundingClientRect();
      return rr.bottom > rect.top && rr.top < rect.bottom;
    }).length;
  });
}

test.describe("owner's acceptance case: maximize shows every column, no horizontal scroll", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("maximize: all 10 columns (Select/Rank/Zone/Score + 6 components) fit with no scroll", async ({
    page,
  }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Full screen" }).click();
    await assertAllColumnsVisible(page, 10);
  });

  test("the widest left/right dock (720px) shows at least six columns, no scroll", async ({
    page,
  }) => {
    await gotoTable(page);
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    for (let i = 0; i < 34; i++) await page.keyboard.press("Shift+ArrowLeft"); // 380 + 34*50 -> clamps at 720
    await expect(handle).toHaveAttribute("aria-valuenow", "720");
    await assertAllColumnsVisible(page, 6);
  });

  test("bottom dock: full stage width, and at least ~8 rows visible", async ({ page }) => {
    await gotoTable(page);
    await panelSurface(page).getByRole("button", { name: "Dock bottom" }).click();
    const handle = panelSurface(page).locator(".resize-handle");
    await handle.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowUp"); // 380 + 6*50 = 680
    await expect(handle).toHaveAttribute("aria-valuenow", "680");

    const region = await page.locator("#panel-region").boundingBox();
    const stage = await page.locator("#stage").boundingBox();
    expect(region!.width).toBeGreaterThan(stage!.width * 0.9);

    await expect
      .poll(() => countVisibleRows(page), { message: "rows visible in the bottom-docked table" })
      .toBeGreaterThanOrEqual(8);
  });

  test("Esc from maximize restores the previous dock, and the table's scroll position survives (no remount)", async ({
    page,
  }) => {
    await gotoTable(page);
    const scrollRegion = page.locator(".zones-table");
    await scrollRegion.evaluate((el) => (el.scrollTop = 120));
    await expect.poll(() => scrollRegion.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    await panelSurface(page).getByRole("button", { name: "Full screen" }).click();
    await page.keyboard.press("Escape");

    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "right");
    // a remount would reset this to 0 -- Panel.svelte's {:else} branch (and everything inside it,
    // including TablePanel/ZonesTable) never unmounts across a maximize toggle (only `collapsed`
    // switches branches; `maximized` is a class/attribute on the SAME element tree).
    expect(await scrollRegion.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });
});
