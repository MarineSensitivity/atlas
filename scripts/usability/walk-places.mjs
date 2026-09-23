// U0 walk 3: places (pick, draw, coordinates, upload, share, analysis cells, list) and the
// top-bar Report check. The Report flow itself is walk-report.mjs.
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

const log = createLog("places");
const live = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[aria-live]")].map((n) => n.textContent.trim()).join(" | "),
  );
const browser = await ENGINES.chromium.launch();
try {
  const { page, ctx, consoleErrors } = await openContext(browser, { width: 1280, height: 800 });
  await load(page, "?map=-92,27.5,4.6&proj=mercator");
  // "Don't show this again", then Explore
  await page
    .getByLabel(/don't show this again/i)
    .check()
    .catch(() => {});
  await dismissWelcome(page);
  await settle(page);

  // 1. Places, empty
  await page.getByRole("button", { name: "Places", exact: true }).first().click();
  await page.waitForTimeout(2500);
  log.note("places-empty", { panel: (await visibleText(page, "#panel-region"))?.slice(0, 800) });
  await shot(page, "places-empty-1280-dark");

  // 2. top-bar Report with NO place
  await page.locator("[data-control=report-top]").click();
  await page.waitForTimeout(800);
  log.note("report-top-no-place", {
    panel: await visibleText(page, "#panel-region"),
    pages: ctx.pages().length,
  });
  await page.getByRole("button", { name: "Places", exact: true }).first().click();
  await page.waitForTimeout(1500);

  // 3. pick mode: a Program Area
  await page.getByRole("button", { name: "Pick mode" }).click();
  await page.waitForTimeout(800);
  log.note("pick-on", { live: await live(page) });
  const gaa = await project(page, -91.5, 27.6);
  await page.mouse.click(gaa.x, gaa.y);
  await page.waitForTimeout(1500);
  const addBtn = page.getByRole("button", { name: /add to places/i });
  log.note("pick-click", { addLabel: await addBtn.textContent(), url: await search(page) });
  if (await addBtn.isDisabled()) {
    // clicking INSIDE a Program Area did not pick it (unit=cell draws outlines only). A user has
    // to find "Spatial units -> Program areas" first -- do that and try again.
    await page.getByRole("button", { name: "Layers", exact: true }).first().click();
    await page.waitForTimeout(1500);
    await page.locator("select[aria-label='Spatial units']").selectOption({ index: 1 });
    await settle(page);
    await page.getByRole("button", { name: "Places", exact: true }).first().click();
    await page.waitForTimeout(2000);
    const pickPressed = await page
      .getByRole("button", { name: "Pick mode" })
      .getAttribute("aria-pressed");
    if (pickPressed !== "true") await page.getByRole("button", { name: "Pick mode" }).click();
    await page.waitForTimeout(800);
    await page.mouse.click(gaa.x, gaa.y);
    await page.waitForTimeout(1500);
    log.note("pick-click-programarea", {
      pickPressedAfterToolSwitch: pickPressed,
      addLabel: await addBtn.textContent(),
      disabled: await addBtn.isDisabled(),
      url: await search(page),
    });
    await shot(page, "places-pick-programarea-1280-dark");
  }
  if (!(await addBtn.isDisabled())) await addBtn.click();
  await page.waitForTimeout(3000);
  log.note("pick-added", {
    live: await live(page),
    list: (await visibleText(page, ".place-list"))?.slice(0, 400),
    url: (await search(page)).slice(0, 200),
  });
  if (
    (await page.getByRole("button", { name: "Pick mode" }).getAttribute("aria-pressed")) === "true"
  )
    await page.getByRole("button", { name: "Pick mode" }).click();

  // 4. draw a polygon in the eastern Gulf (four clicks, then close on the first point)
  await page.getByRole("button", { name: "Polygon" }).click();
  await page.waitForTimeout(2500);
  const pts = [
    [-86.6, 28.4],
    [-85.2, 28.4],
    [-85.2, 27.2],
    [-86.6, 27.2],
  ];
  const screen = [];
  for (const [x, y] of pts) screen.push(await project(page, x, y));
  for (const p of screen) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(350);
  }
  await page.mouse.click(screen[0].x, screen[0].y);
  await page.waitForTimeout(6000);
  log.note("draw-polygon", {
    live: await live(page),
    list: (await visibleText(page, ".place-list"))?.slice(0, 500),
    url: (await search(page)).slice(0, 300),
  });
  await shot(page, "places-draw-1280-dark");

  // 5. show analysis cells for the drawn place
  const cellsPill = page.getByRole("button", { name: /show analysis cells/i });
  const cellsDisabled = await cellsPill.getAttribute("aria-disabled");
  await cellsPill.click({ force: true });
  await page.waitForTimeout(6000);
  log.note("analysis-cells", {
    cellsDisabled,
    live: await live(page),
    pressed: await cellsPill.getAttribute("aria-pressed"),
  });
  await shot(page, "places-cells-1280-dark");
  await cellsPill.click({ force: true });

  // 6. enter coordinates
  await page.getByRole("button", { name: "Enter coordinates" }).click();
  await page.waitForTimeout(1000);
  await shot(page, "places-coords-1280-dark");
  await page.locator("textarea").fill("-80.2, 30.0, -79.4, 30.8");
  await page
    .getByRole("dialog")
    .getByRole("button")
    .filter({ hasText: /add|ok|accept|use/i })
    .first()
    .click();
  await page.waitForTimeout(4000);
  log.note("coords-added", {
    live: await live(page),
    list: (await visibleText(page, ".place-list"))?.slice(0, 700),
  });

  // 7. upload a small GeoJSON
  await page
    .locator(".upload input[type=file]")
    .setInputFiles(".tmp/usability/upload-test.geojson");
  await page.waitForTimeout(6000);
  log.note("upload", {
    live: await live(page),
    list: (await visibleText(page, ".place-list"))?.slice(0, 900),
    url: (await search(page)).slice(0, 400),
  });
  await shot(page, "places-upload-1280-dark");

  // 8. the full Places panel as text (list + results)
  log.note("places-panel", { panel: (await visibleText(page, "#panel-region"))?.slice(0, 2500) });

  // 9. share dialog
  await page.locator(".places-footer").getByRole("button", { name: /share/i }).click();
  await page.waitForTimeout(1500);
  log.note("share-dialog", {
    text: (await visibleText(page, "[role=dialog]:visible, dialog[open]"))?.slice(0, 700),
  });
  await shot(page, "places-share-1280-dark");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // 10. top-bar Report WITH places
  await page.locator("[data-control=report-top]").click();
  await page.waitForTimeout(800);
  log.note("report-top-with-places", {
    panel: await visibleText(page, "#panel-region"),
    pages: ctx.pages().length,
  });
  await page.getByRole("button", { name: "Places", exact: true }).first().click();
  await page.waitForTimeout(2000);

  log.note("errors", { consoleErrors: consoleErrors.slice(0, 20), focus: await focused(page) });
} finally {
  log.save();
  await browser.close();
}
