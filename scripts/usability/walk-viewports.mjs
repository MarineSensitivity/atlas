// U0 walk 4: the viewport x theme sweep (1440x900, 1024x768; ?theme=dark|light), the OS-light
// first visit with no parameter, the restricted-release denial and a resize across the 900 px
// breakpoint. The phone is walk-phone.mjs.
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

const log = createLog("viewports");
const browser = await ENGINES.chromium.launch();
const mapPainted = (page) =>
  page.evaluate(() => {
    const m = window.__atlasMap?.handle?.map;
    if (!m) return null;
    const layers = m.getStyle().layers;
    return {
      basemap: layers.filter((l) => l.id.startsWith("basemap-")).length,
      raster: layers
        .filter((l) => l.type === "raster" && !l.id.startsWith("basemap-"))
        .map((l) => l.id),
      zoom: Math.round(m.getZoom() * 100) / 100,
      center: m
        .getCenter()
        .toArray()
        .map((v) => Math.round(v * 10) / 10),
    };
  });
try {
  // 1. OS light, no parameter (theme=auto)
  if (!process.env.SKIP_SWEEP) {
    const { page, ctx } = await openContext(browser, {
      width: 1280,
      height: 800,
      colorScheme: "light",
    });
    const t = await load(page, "");
    await dismissWelcome(page);
    await settle(page, 25_000);
    await page.waitForTimeout(4000);
    log.note("os-light-auto", {
      ...t,
      dataTheme: await page.evaluate(() => document.documentElement.dataset.theme),
      map: await mapPainted(page),
    });
    await shot(page, "scores-default-1280-light");
    await ctx.close();
  }

  // 2. the sweep
  for (const [w, h] of process.env.SKIP_SWEEP
    ? []
    : [
        [1440, 900],
        [1024, 768],
      ]) {
    for (const theme of ["dark", "light"]) {
      const { page, ctx } = await openContext(browser, { width: w, height: h, colorScheme: theme });
      const t = await load(page, `?theme=${theme}`);
      await dismissWelcome(page);
      await settle(page, 25_000);
      await page.waitForTimeout(4000);
      const layout = await page.evaluate(() => {
        const r = (s) => {
          const e = document.querySelector(s);
          if (!e) return null;
          const b = e.getBoundingClientRect();
          return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
        };
        return {
          panel: r(".panel-surface"),
          rail: r("#rail-region"),
          about: r("#about-region"),
          legend: r(".scores-legend"),
          search: r("[data-control=search]"),
          overflowX: document.documentElement.scrollWidth > innerWidth,
        };
      });
      log.note(`sweep-${w}-${theme}`, { ...t, layout, map: await mapPainted(page) });
      if (!(w === 1024 && theme === "light")) await shot(page, `scores-default-${w}-${theme}`);
      await ctx.close();
    }
  }

  // 4. the restricted release on the public host
  {
    const { page, ctx, failed } = await openContext(browser, { width: 1280, height: 800 });
    await load(page, "?ver=v9");
    await page.waitForTimeout(5000);
    log.note("denied-v9", {
      url: await search(page),
      dialogs: await page.evaluate(() =>
        [...document.querySelectorAll("[role=dialog], dialog[open]")]
          .filter((d) => d.getBoundingClientRect().height > 0)
          .map((d) => d.innerText.slice(0, 900)),
      ),
      chip: await visibleText(page, "[data-control=version-chip]"),
      v9requests: failed.filter((f) => /\/v9\//.test(f)),
    });
    await shot(page, "shell-denied-v9-1280-dark");
    // what happens after closing it
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    log.note("denied-v9-after-esc", {
      dialogs: await page.evaluate(() =>
        [...document.querySelectorAll("[role=dialog], dialog[open]")]
          .filter((d) => d.getBoundingClientRect().height > 0)
          .map((d) => d.innerText.slice(0, 300)),
      ),
      chip: await visibleText(page, "[data-control=version-chip]"),
    });
    await ctx.close();
  }

  // 5. resize across the 900 px breakpoint with a place of state (Table tool open)
  {
    const { page, ctx } = await openContext(browser, { width: 1280, height: 800 });
    await load(page, "?unit=programarea&sel=zone:programarea:GAA");
    await dismissWelcome(page);
    await settle(page);
    await page.getByRole("button", { name: "Table", exact: true }).first().click();
    await page.waitForTimeout(4000);
    const before = await page.evaluate(() => document.querySelector(".panel-title")?.textContent);
    await page.setViewportSize({ width: 860, height: 800 });
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({
      title: document.querySelector(".sheet h2, .panel-title")?.textContent,
      sheet: !!document.querySelector(".sheet"),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    }));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(2500);
    const back = await page.evaluate(() => document.querySelector(".panel-title")?.textContent);
    log.note("resize-breakpoint", { before, after, back, url: await search(page) });
    await ctx.close();
  }
} finally {
  log.save();
  await browser.close();
}
