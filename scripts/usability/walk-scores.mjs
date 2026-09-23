// U0 walk 1: a first-time visitor on desktop 1280x800, OS dark, pointer only -- the scores lens.
import {
  ENGINES,
  createLog,
  dismissWelcome,
  focused,
  load,
  openContext,
  project,
  search,
  settle,
  shot,
  visibleText,
} from "./lib.mjs";

const log = createLog("scores");
const browser = await ENGINES.chromium.launch();
try {
  const { page, consoleErrors, failed, ctx } = await openContext(browser, {
    width: 1280,
    height: 800,
  });

  // 1. first visit, no parameters
  const t = await load(page, "");
  const welcomeText = await visibleText(page, "[role=dialog]:visible, dialog[open]");
  log.note("first-visit", { ...t, welcomeText, url: await search(page) });
  await shot(page, "shell-welcome-1280-dark");

  // 2. "Take a Tour"
  const tour = page.getByRole("button", { name: /take a tour/i }).first();
  if (await tour.isVisible().catch(() => false)) {
    await tour.click();
    await page.waitForTimeout(800);
    const live = await page.evaluate(() =>
      [...document.querySelectorAll("[aria-live]")].map((n) => n.textContent.trim()).join(" | "),
    );
    const dialogStill = await page.locator("[role=dialog]:visible, dialog[open]").count();
    log.note("take-a-tour", { live, dialogStillOpen: dialogStill, focus: await focused(page) });
  }

  // 3. Explore
  await dismissWelcome(page);
  await settle(page);
  log.note("explore", { focus: await focused(page), url: await search(page) });
  await shot(page, "scores-default-1280-dark");

  // the "Layers" panel as a first-timer reads it: native selects with a detached chevron?
  const selectBoxes = await page.evaluate(() =>
    [...document.querySelectorAll(".panel-region select")].map((s) => {
      const r = s.getBoundingClientRect();
      const wrap = s.parentElement.getBoundingClientRect();
      return {
        label: s.getAttribute("aria-label") || s.getAttribute("aria-labelledby"),
        w: Math.round(r.width),
        wrapW: Math.round(wrap.width),
      };
    }),
  );
  log.note("layers-selects", { selectBoxes });

  // 4. hover a Program Area (Shiny repaints the hovered zone + shows a popup)
  const gulf = await project(page, -90.5, 27.2);
  await page.mouse.move(gulf.x, gulf.y);
  await page.waitForTimeout(1200);
  const hoverPopup = await page.locator(".maplibregl-popup, .atlas-popup").count();
  log.note("hover-zone", {
    hoverPopup,
    cursor: await page.evaluate(
      () => getComputedStyle(document.querySelector(".maplibregl-canvas")).cursor,
    ),
  });

  // 5. click a cell in the Gulf
  await page.mouse.click(gulf.x, gulf.y);
  await page.waitForTimeout(3500);
  const popup = await visibleText(page, ".maplibregl-popup, .atlas-popup");
  log.note("click-cell", {
    popup,
    url: await search(page),
    announce: await page.evaluate(() =>
      [...document.querySelectorAll("[aria-live]")].map((n) => n.textContent.trim()).join(" | "),
    ),
  });
  await shot(page, "scores-cellpopup-1280-dark");

  // 6. Flower tool for that cell
  await page.getByRole("button", { name: "Flower plot", exact: true }).first().click();
  await page.waitForTimeout(5000);
  log.note("flower-cell", { panel: (await visibleText(page, "#panel-region"))?.slice(0, 600) });
  await shot(page, "scores-flower-1280-dark");

  // 7. Table tool (species/zones) and its composition view
  await page.getByRole("button", { name: "Table", exact: true }).first().click();
  await page.waitForTimeout(6000);
  const tableText = (await visibleText(page, "#panel-region"))?.slice(0, 900);
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll("#panel-region [role=tab], #panel-region button")]
      .map((b) => b.textContent.trim())
      .filter(Boolean)
      .slice(0, 25),
  );
  log.note("table-cell", { tableText, tabs });
  await shot(page, "scores-table-1280-dark");
  const comp = page
    .locator("#panel-region")
    .getByRole("tab", { name: /composition/i })
    .or(page.locator("#panel-region").getByRole("button", { name: /composition/i }));
  if (await comp.count()) {
    await comp.first().click();
    await page.waitForTimeout(5000);
    log.note("composition", { text: (await visibleText(page, "#panel-region"))?.slice(0, 500) });
    await shot(page, "scores-treemap-1280-dark");
  } else {
    log.note("composition", { found: false });
  }

  // 8. Report tool (rail) and the top-bar Report button
  await page.getByRole("button", { name: "Report", exact: true }).first().click();
  await page.waitForTimeout(1500);
  log.note("report-rail", { panel: await visibleText(page, "#panel-region") });
  await page.locator("[data-control=report-top]").click();
  await page.waitForTimeout(800);
  log.note("report-topbar", {
    panel: await visibleText(page, "#panel-region"),
    pages: ctx.pages().length,
  });
  await shot(page, "scores-reporttool-1280-dark");

  // 9. Help (?)
  await page.locator("[data-control=help]").click();
  await page.waitForTimeout(800);
  log.note("help", {
    focus: await focused(page),
    live: await page.evaluate(() =>
      [...document.querySelectorAll("[aria-live]")].map((n) => n.textContent.trim()).join(" | "),
    ),
  });

  // 10. About card expanded
  const aboutBtn = page.locator("#about-region button").first();
  await aboutBtn.click();
  await page.waitForTimeout(800);
  log.note("about", { text: await visibleText(page, "#about-region") });
  await shot(page, "shell-about-1280-dark");
  await aboutBtn.click();

  // 11. scores search box: type, press Enter
  const sb = page.locator("[data-control=search] input").first();
  await sb.click();
  await sb.fill("St. George Basin");
  await sb.press("Enter");
  await page.waitForTimeout(1500);
  log.note("scores-search", {
    url: await search(page),
    listbox: await page.locator("[role=listbox]:visible").count(),
    panelTitle: await visibleText(page, ".panel-title"),
  });

  // 12. Layers: program areas, a different layer, viridis, flat map
  await page.getByRole("button", { name: "Layers", exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.locator("select[aria-label='Spatial units']").selectOption({ index: 1 });
  await settle(page);
  const pa = await project(page, -169.0, 56.0);
  await page.mouse.click(pa.x, pa.y);
  await page.waitForTimeout(3500);
  log.note("click-zone", {
    popup: await visibleText(page, ".maplibregl-popup, .atlas-popup"),
    url: await search(page),
  });
  await shot(page, "scores-zonepopup-1280-dark");

  const lyr = page.locator("select[aria-labelledby=scores-lyr-label]");
  const opts = await lyr.locator("option").allTextContents();
  log.note("layer-options", { n: opts.length, first: opts.slice(0, 12) });
  const mammal = opts.findIndex((o) => /mammal/i.test(o));
  if (mammal >= 0) await lyr.selectOption({ index: mammal });
  await page.locator("select[aria-label='Color palette']").selectOption("viridis");
  await settle(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  log.note("layer-mammal-viridis", { url: await search(page) });
  await shot(page, "scores-mammal-viridis-1280-dark");

  // 13. flat map (Sphere off)
  await page
    .getByRole("switch", { name: /sphere/i })
    .first()
    .click()
    .catch(async () => {
      await page.locator("[aria-label='Sphere (globe projection)']").first().click();
    });
  await settle(page);
  log.note("mercator", { url: await search(page) });

  // 14. collapse the panel, then click a cell (M1)
  const panelOpen = await page.locator("[data-panel-control=collapse]").count();
  if (panelOpen) await page.locator("[data-panel-control=collapse]").click();
  await page.waitForTimeout(800);
  const before = await search(page);
  const c2 = await project(page, -122.0, 36.0);
  await page.mouse.click(c2.x, c2.y);
  await page.waitForTimeout(3000);
  log.note("collapsed-click", {
    before,
    after: await search(page),
    popup: await page.locator(".maplibregl-popup, .atlas-popup").count(),
  });
  await shot(page, "scores-collapsed-1280-dark");

  // 15. restore via the pill, go Full height
  await page.locator(".panel-pill").click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Full height" }).click();
  await page.waitForTimeout(800);
  const panelRect = await page.evaluate(() => {
    const r = document.querySelector(".panel-surface")?.getBoundingClientRect();
    return (
      r && {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }
    );
  });
  log.note("full-height", { panelRect });
  await shot(page, "scores-panelfull-1280-dark");
  await page.getByRole("button", { name: "Half height" }).click();

  // 16. Share
  await page.locator("[data-control=share]").click();
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e}`));
  log.note("share", { clip });

  // 17. Report a problem (opens GitHub in a new tab)
  const [popupPage] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null),
    page.locator("[data-control=feedback]").click(),
  ]);
  if (popupPage) {
    await popupPage.waitForLoadState("domcontentloaded").catch(() => {});
    log.note("report-a-problem", { url: popupPage.url().slice(0, 600) });
    await popupPage.close();
  }

  // 18. version picker
  await page.locator("[data-control=version-chip]").click();
  await page.waitForTimeout(1500);
  log.note("version-picker", {
    text: await visibleText(page, "[role=dialog]:visible, dialog[open]"),
  });
  await shot(page, "shell-versionpicker-1280-dark");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  log.note("version-picker-esc", { focus: await focused(page) });

  // 19. theme toggle
  const themeLabel = await page.locator("[data-control=theme]").getAttribute("aria-label");
  await page.locator("[data-control=theme]").click();
  await settle(page);
  log.note("theme-toggle", {
    themeLabel,
    url: await search(page),
    dataTheme: await page.evaluate(() => document.documentElement.dataset.theme),
  });

  log.note("errors", { consoleErrors: consoleErrors.slice(0, 20), failed: failed.slice(0, 30) });
} finally {
  log.save();
  await browser.close();
}
