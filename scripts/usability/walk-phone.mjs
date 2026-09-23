// U0 walk 4b: the phone, 390x844 touch, both themes: first paint, the sheet's detents (buttons and
// the grabber), where the bottom tool rail is at each detent, a tap on a scored cell, the species
// lens (is there a way to search?), Places.
import {
  ENGINES,
  createLog,
  dismissWelcome,
  load,
  openContext,
  search,
  settle,
  shot,
  visibleText,
} from "./lib.mjs";

const log = createLog("phone");
const browser = await ENGINES.chromium.launch();
const rect = (page, s) =>
  page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  }, s);
/** is the element at the centre of `sel` the element itself (or inside it)? i.e. can a tap reach it */
const reachable = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return hit ? e.contains(hit) || hit.contains(e) : false;
  }, sel);
try {
  for (const theme of ["dark", "light"]) {
    const { page, ctx } = await openContext(browser, {
      width: 390,
      height: 844,
      colorScheme: theme,
      touch: true,
    });
    const t = await load(page, `?theme=${theme}`);
    await page.waitForTimeout(2500);
    if (theme === "dark") await shot(page, "shell-welcome-390-dark");
    await dismissWelcome(page);
    await settle(page, 25_000);
    await page.waitForTimeout(3000);
    const vis = await page.evaluate(() => {
      const v = (s) => {
        const e = document.querySelector(s);
        return (
          !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0
        );
      };
      return {
        legend: v(".scores-legend"),
        about: v("#about-region"),
        search: v("[data-control=search]"),
        share: v("[data-control=share]"),
        report: v("[data-control=report-top]"),
        help: v("[data-control=help]"),
        feedback: v("[data-control=feedback]"),
      };
    });
    log.note(`phone-${theme}`, {
      ...t,
      vis,
      sheet: await rect(page, ".sheet"),
      rail: await rect(page, "#rail-region"),
      railReachable: await reachable(page, "#rail-region button"),
      url: await search(page),
    });
    await shot(page, `scores-default-390-${theme}`);
    if (theme !== "dark") {
      await ctx.close();
      continue;
    }
    // detents by button
    for (const d of ["Collapse to a peek", "Full height", "Half height"]) {
      await page.getByRole("button", { name: d }).click();
      await page.waitForTimeout(900);
      log.note(`detent-${d}`, {
        sheet: await rect(page, ".sheet"),
        rail: await rect(page, "#rail-region"),
        railReachable: await reachable(page, "#rail-region button"),
      });
    }
    // the grabber claims "Drag to resize the sheet": drag it down with touch-like pointer moves
    const g = await page.locator(".sheet-grab").boundingBox();
    const before = await page.evaluate(() => document.querySelector(".sheet")?.className);
    await page.mouse.move(g.x + g.width / 2, g.y + 3);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y + 300, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    log.note("grabber-drag", {
      before,
      after: await page.evaluate(() => document.querySelector(".sheet")?.className),
    });
    // tap a scored cell that is on screen with the sheet at peek
    await page.getByRole("button", { name: "Collapse to a peek" }).click();
    await page.waitForTimeout(800);
    const target = await page.evaluate(() => {
      const m = window.__atlasMap.handle.map;
      const r = m.getContainer().getBoundingClientRect();
      for (const [lng, lat] of [
        [-152, 57.5],
        [-125, 44],
        [-124.5, 40.5],
        [-160, 55],
      ]) {
        const p = m.project([lng, lat]);
        if (p.x > 10 && p.x < r.width - 10 && p.y > 10 && p.y < r.height - 120)
          return { lng, lat, x: p.x + r.left, y: p.y + r.top };
      }
      return null;
    });
    if (target) {
      await page.touchscreen.tap(target.x, target.y);
      await page.waitForTimeout(8000);
      log.note("tap-cell", {
        target,
        url: await search(page),
        popup: await visibleText(page, ".atlas-popup"),
        sheet: await page.evaluate(() => document.querySelector(".sheet")?.className),
      });
      await shot(page, "scores-tapcell-390-dark");
    } else log.note("tap-cell", { target: null });
    // species on the phone
    await page.getByRole("button", { name: "Species", exact: true }).first().click();
    await settle(page, 25_000);
    await page.waitForTimeout(3000);
    log.note("phone-species", {
      url: await search(page),
      comboboxes: await page.getByRole("combobox").count(),
      visibleComboboxes: await page.locator("[role=combobox]:visible").count(),
    });
    await page
      .getByRole("button", { name: "Half height" })
      .click()
      .catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, "species-default-390-dark");
    // places via the rail, at peek so the rail can be reached
    await page
      .getByRole("button", { name: "Collapse to a peek" })
      .click()
      .catch(() => {});
    await page.waitForTimeout(800);
    await page
      .getByRole("button", { name: "Places", exact: true })
      .first()
      .click({ timeout: 8000 })
      .catch((e) => log.note("places-tap-failed", { e: String(e).split("\n")[0] }));
    await page.waitForTimeout(3000);
    log.note("phone-places", {
      title: await visibleText(page, ".sheet h2"),
      sheet: await page.evaluate(() => document.querySelector(".sheet")?.className),
    });
    await ctx.close();
  }
} finally {
  log.save();
  await browser.close();
}
