// U0 walk 6: the two references side by side -- CalCOFI explore (the panel/layers/feedback/tour
// model Ben wants to borrow from) and the two Shiny apps the atlas replaces (what a returning user
// expects). Screenshots only, plus the controls each exposes.
import { ENGINES, createLog, openContext, shot } from "./lib.mjs";

const log = createLog("compare");
const browser = await ENGINES.chromium.launch();
const controls = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button, [role=tab], a.nav-link, summary")]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) =>
        (b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 40),
      )
      .filter(Boolean)
      .slice(0, 60),
  );
try {
  // CalCOFI explore
  {
    const { page } = await openContext(browser, { width: 1280, height: 800 });
    const t0 = Date.now();
    await page.goto("https://calcofi.io/explore/?tour=off", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(15_000);
    log.note("calcofi-default", { ms: Date.now() - t0, controls: await controls(page) });
    // the Layers card, if there is a button for it
    const layers = page.getByRole("button", { name: /layers/i }).first();
    if (await layers.count()) {
      await layers.click().catch(() => {});
      await page.waitForTimeout(3000);
      log.note("calcofi-layers", { text: (await page.locator("body").innerText()).slice(0, 1500) });
      await shot(page, "compare-calcofi-layers-1280-light");
    }
    const fb = page.getByRole("button", { name: /feedback/i }).first();
    if (await fb.count()) {
      await fb.click().catch(() => {});
      await page.waitForTimeout(6000);
      log.note("calcofi-feedback", {
        dialog: (
          await page
            .locator("[role=dialog], dialog[open]")
            .first()
            .innerText()
            .catch(() => "")
        ).slice(0, 800),
      });
      await shot(page, "compare-calcofi-feedback-1280-light");
    }
  }
  // the Shiny apps
  for (const [name, url] of [
    ["shiny-scores", "https://app.marinesensitivity.org/v7/scores/"],
    ["shiny-species", "https://app.marinesensitivity.org/v7/species/"],
  ]) {
    const { page } = await openContext(browser, { width: 1280, height: 800 });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll(".recalculating").length === 0 &&
          document.body.innerText.length > 200,
        null,
        { timeout: 90_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(15_000);
    const splash = await page.locator(".modal:visible").count();
    log.note(name, {
      ms: Date.now() - t0,
      splash,
      controls: await controls(page),
      text: (await page.locator("body").innerText()).slice(0, 1200),
    });
    // dismiss a splash the way a user would
    const close = page
      .locator(".modal:visible button")
      .filter({ hasText: /close|explore|ok|dismiss|got it/i })
      .first();
    if (await close.count()) {
      await close.click().catch(() => {});
      await page.waitForTimeout(4000);
    }
    await shot(page, `compare-${name}-1280-dark`);
  }
} finally {
  log.save();
  await browser.close();
}
