// U0: perceived first paint on the live app, cold, three runs -- NOT a performance investigation
// (the 0.10.20+ laptop regression is root-caused elsewhere), just what a first-time visitor waits
// through: DOMContentLoaded, the welcome modal, the basemap's first painted pixels, the score
// raster's first saturated pixels. Pixel checks read the MapLibre canvas (preserveDrawingBuffer is
// on) scaled to 96x60.
import { ENGINES, createLog, openContext } from "./lib.mjs";

const log = createLog("timing");
const RUNS = +(process.env.RUNS ?? 3);
const browser = await ENGINES.chromium.launch();
try {
  for (let run = 1; run <= RUNS; run++) {
    const { page, ctx } = await openContext(browser, { width: 1280, height: 800 });
    const t0 = Date.now();
    await page.goto("https://marinesensitivity.org/atlas/", { waitUntil: "domcontentloaded" });
    const marks = { dom: Date.now() - t0, welcome: null, basemap: null, raster: null };
    while (
      Date.now() - t0 < 30_000 &&
      (marks.basemap === null || marks.raster === null || marks.welcome === null)
    ) {
      const s = await page.evaluate(() => {
        const welcome = [...document.querySelectorAll("dialog[open]")].some((d) =>
          /Welcome/.test(d.textContent),
        );
        const c = document.querySelector(".maplibregl-canvas");
        if (!c || !c.width) return { welcome, colors: 0, saturated: 0 };
        const k = document.createElement("canvas");
        k.width = 96;
        k.height = 60;
        const g = k.getContext("2d");
        g.drawImage(c, 0, 0, 96, 60);
        const d = g.getImageData(0, 0, 96, 60).data;
        const set = new Set();
        let saturated = 0;
        for (let i = 0; i < d.length; i += 4) {
          set.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
          const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
          if (Math.max(r, gg, b) - Math.min(r, gg, b) > 70) saturated++;
        }
        return { welcome, colors: set.size, saturated };
      });
      const t = Date.now() - t0;
      if (marks.welcome === null && s.welcome) marks.welcome = t;
      if (marks.basemap === null && s.colors > 6) marks.basemap = t;
      if (marks.raster === null && s.saturated > 3) marks.raster = t;
      await page.waitForTimeout(150);
    }
    log.note(`run-${run}`, marks);
    await ctx.close();
  }
} finally {
  log.save();
  await browser.close();
}
