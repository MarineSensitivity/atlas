import { expect, test } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession } from "./hermetic";

// atlas-3 step 3: the static skeleton (index.html's inlined critical CSS + plain markup) must be
// geometrically IDENTICAL to the hydrated first frame -- the CLS gate. Measured with the real
// Layout Instability API (`PerformanceObserver({type: "layout-shift"})`), the same signal Chrome's
// own Web Vitals reporting uses, installed via `addInitScript` so it is recording before the
// page's own first script even runs.
//
// The Layout Instability API is Chromium-only (WebKit/Firefox implement neither the entry type nor
// `layoutShift.value`) -- this spec is skipped outside chromium, exactly as the score itself would
// be `0` (unmeasurable, not "passing") on the other two engines. e2e/shell.smoke.spec.ts already
// covers this shell painting with zero console errors on all three.
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Layout Instability API is Chromium-only",
);

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};
const THEMES = ["navy", "paper"] as const;

async function installClsObserver(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    });
    po.observe({ type: "layout-shift", buffered: true });
  });
}

for (const theme of THEMES) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`CLS = 0: ${theme} @ ${name}`, async ({ page }) => {
      await routeBucket(page);
      await routeSession(page, null);
      await routeSealFixture(page);
      await installClsObserver(page);
      await page.setViewportSize(viewport);

      await page.goto(`/?theme=${theme}`, { waitUntil: "networkidle" });
      // settle any late-resolving async effect (the version chip's text, the About release note)
      // that could -- if it were sized wrong -- still shift something after networkidle.
      await page.waitForTimeout(300);

      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, `measured CLS at ${theme}/${name}`).toBe(0);
    });
  }
}
