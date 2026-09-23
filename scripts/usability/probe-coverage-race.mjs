// U0 probe: the "N % of this place is inside the US study area (a of b cells)" line for ONE shape,
// drawn two ways (Rectangle; Polygon closed on its first vertex), read at intervals and around the
// "Show analysis cells" toggle. On 0.10.21 the same 18,354 km² box read 100.0 %, 0.0 % and 200.0 %
// ("1,344 of 672 cells") across runs -- see docs/usability.md, finding B3.
import {
  ENGINES,
  createLog,
  dismissWelcome,
  load,
  openContext,
  project,
  settle,
  visibleText,
} from "./lib.mjs";

const log = createLog("coverage-race");
const BOX = [
  [-86.6, 28.4],
  [-85.2, 28.4],
  [-85.2, 27.2],
  [-86.6, 27.2],
];
const browser = await ENGINES.chromium.launch();
try {
  for (const mode of ["Rectangle", "Polygon"]) {
    const { page, ctx } = await openContext(browser, { width: 1280, height: 800 });
    await load(page, "?map=-92,27.5,4.6&proj=mercator");
    await dismissWelcome(page);
    await settle(page);
    await page.getByRole("button", { name: "Places", exact: true }).first().click();
    await page.waitForTimeout(2500);
    const read = async (tag) => {
      const t = await visibleText(page, "#panel-region");
      log.note(`${mode}-${tag}`, {
        share: t?.match(/[0-9.,]+% of this place[^\n]*/g) ?? null,
        chips: t?.match(/not analysed yet|[0-9.]+ composite/g) ?? null,
      });
    };
    await page.getByRole("button", { name: mode }).click();
    await page.waitForTimeout(2500);
    const pts = [];
    for (const [x, y] of BOX) pts.push(await project(page, x, y));
    if (mode === "Rectangle") {
      await page.mouse.click(pts[0].x, pts[0].y);
      await page.waitForTimeout(400);
      await page.mouse.click(pts[2].x, pts[2].y);
    } else {
      for (const p of pts) {
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(350);
      }
      await page.mouse.click(pts[0].x, pts[0].y);
    }
    for (const ms of [1500, 3000, 6000]) {
      await page.waitForTimeout(ms);
      await read(`t+${ms}`);
    }
    const cells = page.getByRole("button", { name: /show analysis cells/i });
    await cells.click({ force: true });
    await page.waitForTimeout(6000);
    await read("cells-on");
    await cells.click({ force: true });
    await page.waitForTimeout(3000);
    await read("cells-off");
    await ctx.close();
  }
} finally {
  log.save();
  await browser.close();
}
