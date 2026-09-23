// U0 walk 2: the species lens on desktop 1280x800, OS dark, pointer -- then stale deep links.
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

const log = createLog("species");
const browser = await ENGINES.chromium.launch();
const live = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[aria-live]")].map((n) => n.textContent.trim()).join(" | "),
  );
try {
  const { page, consoleErrors, failed } = await openContext(browser, { width: 1280, height: 800 });
  await load(page, "");
  await dismissWelcome(page);
  await settle(page);

  // 1. switch lens
  const t0 = Date.now();
  await page
    .getByRole("radio", { name: "Species" })
    .or(page.getByRole("button", { name: "Species", exact: true }))
    .first()
    .click();
  await settle(page, 30_000);
  log.note("lens-species", {
    ms: Date.now() - t0,
    url: await search(page),
    panel: (await visibleText(page, "#panel-region"))?.slice(0, 700),
    title: await page.title(),
  });

  // 2. search combobox
  const input = page.getByRole("combobox", { name: "Search species" });
  await input.click();
  await input.fill("humpback");
  await page.waitForTimeout(2500);
  const options = await page.getByRole("option").allTextContents();
  log.note("search-humpback", { n: options.length, options: options.slice(0, 8) });
  await shot(page, "species-search-1280-dark");
  // a user who typed "humpback" is after the whale; it is not the first row (alphabetical by
  // scientific name), so pick it by name the way they would have to
  const whaleRank = options.findIndex((o) => /Megaptera/.test(o));
  log.note("humpback-whale-rank", { rank: whaleRank + 1, of: options.length });
  await page
    .getByRole("option", { name: /Megaptera/ })
    .first()
    .click();
  await settle(page, 30_000);
  log.note("pick-humpback", {
    url: await search(page),
    panel: (await visibleText(page, "#panel-region"))?.slice(0, 900),
    title: await page.title(),
    legend: await visibleText(page, "[data-testid=species-legend], .species-legend"),
  });
  await shot(page, "species-humpback-1280-dark");

  // 3. click value inside the range
  const p = await project(page, -70.0, 42.0);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(4000);
  log.note("click-value", {
    popup: await visibleText(page, ".maplibregl-popup, .atlas-popup"),
    url: await search(page),
  });
  await shot(page, "species-clickvalue-1280-dark");
  await page.keyboard.press("Escape");

  // 4. inputs + representation
  const pills = await page.evaluate(() =>
    [...document.querySelectorAll("#panel-region .layer-bar button, #panel-region .layer-bar span")]
      .map(
        (b) =>
          `${b.tagName}:${b.textContent.trim()}${b.getAttribute("aria-disabled") ? "(aria-disabled)" : ""}`,
      )
      .slice(0, 20),
  );
  const rep = await page.locator("[data-testid=representation] button").allTextContents();
  log.note("inputs", { pills, rep });
  if (rep.length > 1) {
    await page.locator("[data-testid=representation] button").nth(1).click();
    await settle(page);
    log.note("rep-toggle", { url: await search(page) });
    await shot(page, "species-rep-1280-dark");
  }

  // 5. a non-US species: first with US only on, then off
  await input.click();
  await input.fill("wrybill");
  await page.waitForTimeout(2500);
  const usOn = await page.getByRole("option").allTextContents();
  const dropdown = (await visibleText(page, ".picker-dropdown"))?.slice(0, 300);
  log.note("search-wrybill-usonly", { n: usOn.length, dropdown });
  const usSwitch = page
    .locator(".picker-dropdown")
    .getByRole("switch")
    .or(page.locator(".picker-dropdown input[type=checkbox]"))
    .first();
  if (await usSwitch.count()) {
    await usSwitch.click();
    await page.waitForTimeout(1500);
    log.note("us-toggle", {
      dropdownOpen: await page.locator(".picker-dropdown").count(),
      focus: await focused(page),
    });
    await input.click();
    await input.fill("");
    await input.fill("wrybill");
    await page.waitForTimeout(2500);
  }
  const usOff = await page.getByRole("option").allTextContents();
  log.note("search-wrybill-all", {
    n: usOff.length,
    options: usOff.slice(0, 5),
    url: await search(page),
  });
  if (usOff.length) {
    await page.getByRole("option").first().click();
    await settle(page, 30_000);
    log.note("pick-wrybill", {
      url: await search(page),
      panel: (await visibleText(page, "#panel-region"))?.slice(0, 600),
    });
    await shot(page, "species-nonus-1280-dark");
  }

  // 6. the Flower tool in the species lens (faded) and Table / Report there
  await page
    .getByRole("button", { name: /flower plot/i })
    .first()
    .click({ force: true });
  await page.waitForTimeout(800);
  log.note("species-flower", {
    live: await live(page),
    panel: await visibleText(page, "#panel-region .panel-title"),
  });
  await page.getByRole("button", { name: "Table", exact: true }).first().click();
  await page.waitForTimeout(1500);
  log.note("species-table", { panel: (await visibleText(page, "#panel-region"))?.slice(0, 300) });

  // 7. stale / wrong deep links, fresh context each (a recipient of a link)
  for (const [name, q] of [
    ["legacy-mdl_seq", "?mdl_seq=54383"],
    ["bogus-sp", "?lens=species&sp=ms_merge%7CWORMS%3A999999999"],
    ["bogus-lyr", "?lyr=not_a_metric&unit=programarea"],
    ["bogus-cell", "?sel=cell:999999999"],
    ["bogus-ver", "?ver=v99"],
  ]) {
    const c = await openContext(browser, { width: 1280, height: 800 });
    await load(c.page, q, { timeout: 40_000 });
    await c.page.waitForTimeout(6000);
    const dlg = await visibleText(c.page, "[role=dialog]:visible, dialog[open]");
    log.note(`deeplink-${name}`, {
      q,
      url: await search(c.page),
      dialog: dlg?.slice(0, 500),
      live: await live(c.page),
      errors: c.consoleErrors.slice(0, 5),
    });
    if (name === "bogus-sp") await shot(c.page, `species-deeplink-${name}-1280-dark`);
    await c.ctx.close();
  }

  log.note("errors", {
    consoleErrors: consoleErrors.slice(0, 20),
    failed: failed.slice(0, 30),
    focus: await focused(page),
  });
} finally {
  log.save();
  await browser.close();
}
