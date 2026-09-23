// U0 walk 5: keyboard only (Tab order, focus visibility, Esc, arrow keys where a widget claims
// them) on chromium 1280x800 dark; then one pass each on webkit and firefox.
import {
  ENGINES,
  createLog,
  dismissWelcome,
  focused,
  load,
  openContext,
  search,
  settle,
  shot,
} from "./lib.mjs";

const log = createLog(process.env.ENGINES ? `engines-${process.env.ENGINES}` : "keyboard");
const live = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[aria-live]")].map((n) => n.textContent.trim()).join(" | "),
  );
if (!process.env.ENGINES) {
  const browser = await ENGINES.chromium.launch();
  try {
    const { page } = await openContext(browser, { width: 1280, height: 800 });
    await load(page, "");
    await page.waitForTimeout(2500);
    log.note("welcome-initial-focus", { focus: await focused(page) });
    const inModal = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      inModal.push(await focused(page));
    }
    log.note("welcome-tab-cycle", { inModal });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    log.note("welcome-esc", {
      dialogs: await page.locator("dialog[open]").count(),
      focus: await focused(page),
    });
    await settle(page);

    // Tab through the whole page from the top
    await page.evaluate(() => document.activeElement?.blur());
    const order = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused(page));
      if (i === 0) await shot(page, "shell-kbd-skiplink-1280-dark");
    }
    log.note("tab-order", { order });

    // rail: roving focus + arrows
    await page.locator("#rail-region button.hexbtn").first().focus();
    const rail = [await focused(page)];
    for (const k of ["ArrowDown", "ArrowDown", "ArrowUp", "End", "Home"]) {
      await page.keyboard.press(k);
      rail.push(`${k} -> ${await focused(page)}`);
    }
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    rail.push(
      `Enter -> panel title ${await page
        .locator(".panel-title")
        .textContent()
        .catch(() => null)}; focus ${await focused(page)}`,
    );
    log.note("rail-arrows", { rail });

    // Esc inside the panel collapses it; where does focus go; Enter restores
    await page.locator("#panel-region button").first().focus();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    const afterEsc = await focused(page);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    log.note("panel-esc", { afterEsc, afterEnter: await focused(page) });

    // the map itself: can a keyboard user pan/zoom, pick a cell?
    await page
      .locator(".maplibregl-canvas")
      .focus()
      .catch(() => {});
    const cam0 = await page.evaluate(() => window.__atlasMap.handle.map.getCenter().toArray());
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("=");
    await page.waitForTimeout(1200);
    const cam1 = await page.evaluate(() => [
      window.__atlasMap.handle.map.getCenter().toArray(),
      window.__atlasMap.handle.map.getZoom(),
    ]);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
    log.note("map-keyboard", { focus: await focused(page), cam0, cam1, url: await search(page) });

    // version chip -> picker -> Esc returns focus
    await page.locator("[data-control=version-chip]").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const pickerFocus = await focused(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    log.note("version-picker-kbd", { pickerFocus, back: await focused(page) });

    // species combobox with arrows
    await page
      .getByRole("radio", { name: "Species" })
      .or(page.getByRole("button", { name: "Species", exact: true }))
      .first()
      .focus();
    await page.keyboard.press("Enter");
    await settle(page, 25_000);
    await page.waitForTimeout(2000);
    const combo = page.getByRole("combobox", { name: "Search species" });
    await combo.focus();
    await page.keyboard.type("walrus", { delay: 60 });
    await page.waitForTimeout(2000);
    await page.keyboard.press("ArrowDown");
    const ad1 = await combo.getAttribute("aria-activedescendant");
    await page.keyboard.press("ArrowDown");
    const ad2 = await combo.getAttribute("aria-activedescendant");
    await page.keyboard.press("Enter");
    await settle(page, 25_000);
    log.note("combobox-kbd", {
      ad1,
      ad2,
      url: await search(page),
      live: await live(page),
      focus: await focused(page),
    });

    // the lens switch by arrows (radio group?)
    await page
      .getByRole("radio", { name: "Species" })
      .or(page.getByRole("button", { name: "Species", exact: true }))
      .first()
      .focus();
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(1500);
    log.note("lens-arrows", { url: await search(page), focus: await focused(page) });
  } finally {
    log.save();
    await browser.close();
  }
}

// one pass on webkit and firefox: first paint + the Table tool + a theme flip
const ONLY = process.env.ENGINES ? process.env.ENGINES.split(",") : ["webkit", "firefox"];
for (const engine of ONLY) {
  const browser = await ENGINES[engine].launch();
  try {
    const { page, consoleErrors } = await openContext(browser, {
      width: 1280,
      height: 800,
      clipboard: false,
    });
    const t = await load(page, "?unit=programarea");
    await dismissWelcome(page);
    await settle(page, 30_000);
    await page.waitForTimeout(5000);
    const map = await page.evaluate(() => {
      const m = window.__atlasMap?.handle?.map;
      return m
        ? {
            layers: m.getStyle().layers.length,
            basemap: m.getStyle().layers.filter((l) => l.id.startsWith("basemap-")).length,
          }
        : null;
    });
    await page.getByRole("button", { name: "Table", exact: true }).first().click();
    await page.waitForTimeout(5000);
    log.note(`engine-${engine}`, { ...t, map, errors: consoleErrors.slice(0, 6) });
    if (engine === "firefox") await shot(page, `scores-table-1280-dark-${engine}`);
    // Tab from the top on this engine
    await page.evaluate(() => document.activeElement?.blur());
    const order = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused(page));
    }
    log.note(`engine-${engine}-tabs`, { order });
  } catch (e) {
    log.note(`engine-${engine}-error`, { e: String(e).slice(0, 400) });
  } finally {
    log.save();
    await browser.close();
  }
}
