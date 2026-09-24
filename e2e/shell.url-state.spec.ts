import { expect, test } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession } from "./hermetic";

// atlas-3 step 3 / CLAUDE.md "URL-is-the-view": every write goes through history.replaceState,
// never pushState (a link must reproduce its exact view, not grow a back-button stack of every
// chrome tweak), and a field that equals its OWN default is never written to the URL (a shared
// link for the default view stays "/", not "/?lens=scores&..."). tests/state/invariants.test.ts
// and tests/shell/shell-invariants.test.ts already prove this at the source level; this is the
// real-browser version, walked through the actual controls.

async function recordHistoryCalls(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as { __pushStateCalls: unknown[] }).__pushStateCalls = [];
    const real = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      (window as unknown as { __pushStateCalls: unknown[] }).__pushStateCalls.push(args);
      return real(...args);
    };
  });
}

async function gotoShell(page: import("@playwright/test").Page) {
  await routeBucket(page);
  await routeSession(page, null);
  await routeSealFixture(page);
  await recordHistoryCalls(page);
  await page.goto("/", { waitUntil: "networkidle" });
}

function urlTail(page: import("@playwright/test").Page): string {
  const u = new URL(page.url());
  return u.search + u.hash;
}

test("the default view's URL carries no query or hash", async ({ page }) => {
  await gotoShell(page);
  expect(urlTail(page)).toBe("");
});

test("clicking the ALREADY-active lens does not add a default value to the URL", async ({
  page,
}) => {
  await gotoShell(page);
  await page.locator(".topbar").getByRole("button", { name: "Scores" }).click();
  expect(urlTail(page)).toBe("");
});

test("switching lenses writes a non-default value, and switching back removes it", async ({
  page,
}) => {
  await gotoShell(page);
  await page.locator(".topbar").getByRole("button", { name: "Species" }).click();
  expect(urlTail(page)).toBe("?lens=species");
  await page.locator(".topbar").getByRole("button", { name: "Scores" }).click();
  expect(urlTail(page)).toBe(""); // "scores" is the default when no species is selected
});

test("opening every rail tool and every panel-size control never touches the URL (chrome, not view state)", async ({
  page,
}) => {
  await gotoShell(page);
  const rail = page.locator("#rail-region [role='toolbar']");
  for (const label of ["Layers", "Places", "Table", "Report"]) {
    await rail.locator(`button[aria-label="${label}"]`).click();
    expect(urlTail(page)).toBe("");
  }

  const panel = page.locator("#panel-region");
  await panel.locator('[data-panel-control="collapse"]').click();
  expect(urlTail(page)).toBe("");
  await panel.locator("button.panel-pill").click(); // restore
  expect(urlTail(page)).toBe("");
  // U1 (R1): "Full height"/"Half height" (the old collapse/half/full model) no longer exist --
  // this test predates the dockable panel (docs/usability.md §7). Walk R1's own control set
  // instead: dock left/bottom/right, maximize (Full screen), restore -- CI run 35956406448 caught
  // the stale locators as a `locator.click: Test timeout`, never finding either button.
  await panel.getByRole("button", { name: "Dock left" }).click();
  expect(urlTail(page)).toBe("");
  await panel.getByRole("button", { name: "Dock bottom" }).click();
  expect(urlTail(page)).toBe("");
  await panel.getByRole("button", { name: "Dock right" }).click();
  expect(urlTail(page)).toBe("");
  await panel.getByRole("button", { name: "Full screen" }).click();
  expect(urlTail(page)).toBe("");
  await panel.getByRole("button", { name: "Restore" }).click();
  expect(urlTail(page)).toBe("");
});

test("a full interaction walk never calls history.pushState, and never grows history.length", async ({
  page,
}) => {
  await gotoShell(page);
  const startLength = await page.evaluate(() => history.length);

  await page.locator(".topbar").getByRole("button", { name: "Species" }).click();
  await page.locator(".topbar").getByRole("button", { name: "Scores" }).click();
  await page.locator('[data-control="theme"]').click();
  const rail = page.locator("#rail-region [role='toolbar']");
  for (const label of ["Layers", "Places", "Flower plot", "Table", "Report"]) {
    await rail.locator(`button[aria-label="${label}"]`).click();
  }
  const panel = page.locator("#panel-region");
  await panel.locator('[data-panel-control="collapse"]').click();
  await panel.locator("button.panel-pill").click();
  // U1c fix round (CI run 35956406448/107495562810): `getByLabel` now matches TWO elements
  // sharing this accessible name -- the desktop `<input type="search">` (this test's real
  // target, at this default desktop viewport) and P5's phone-search trigger `<button>`
  // (`topbar-phone-only`, CSS-hidden here but still present in the DOM and still matched by
  // accessible name, same as a real AT would). Disambiguate by role.
  await page.getByRole("searchbox", { name: "Search species and places" }).click();
  await page.keyboard.type("leatherback");

  const pushStateCalls = await page.evaluate(
    () => (window as unknown as { __pushStateCalls: unknown[] }).__pushStateCalls,
  );
  expect(pushStateCalls).toEqual([]);
  expect(await page.evaluate(() => history.length)).toBe(startLength);
});

test("an explicit theme choice writes a real value (not a default-value bug)", async ({ page }) => {
  await gotoShell(page);
  await page.locator('[data-control="theme"]').click();
  expect(urlTail(page)).toMatch(/^\?theme=(light|dark)$/);
});
