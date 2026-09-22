// atlas-6 places: the gates that need a real browser but no live release data (no `app/boot.json`
// fixture is served here on purpose -- routeBucket's own header: "not published until atlas-1").
// HERMETIC, same convention as e2e/shell.*.spec.ts: every bucket/tile origin is routed to a
// fixture, so no spec here ever reaches the live network.
//
// Chromium-only, serial (the map specs' own convention, atlas-6's subplan): a real MapLibre
// instance is expensive to boot repeatedly and this file's assertions do not depend on browser
// engine differences.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectRequests, gotoPublicShell } from "./hermetic";

test.describe.configure({ mode: "serial" });
test.use({ browserName: "chromium" });

async function openPlaces(page: Page) {
  await gotoPublicShell(page);
  await page.waitForSelector("#rail-region .rail", { state: "attached" });
  await page.locator("#rail-region button[aria-label='Places']").click();
}

async function addByCoordinates(page: Page, text = "-124.5, 40.0, -123.0, 41.5") {
  await page.getByRole("button", { name: "Enter coordinates" }).click();
  const textarea = page.getByLabel("Coordinates, bounding box, or WKT/GeoJSON");
  await expect(textarea).toBeVisible();
  await textarea.fill(text);
  await page.getByRole("button", { name: "Add place" }).click();
  await expect(page.locator(".place-row").first()).toBeVisible();
}

test("keyboard-only: Enter coordinates creates a place, rename, then remove -- drawing is never the only way", async ({
  page,
}) => {
  await openPlaces(page);

  // --- create by coordinates, keyboard only ------------------------------------------------------
  const coordButton = page.getByRole("button", { name: "Enter coordinates" });
  await coordButton.focus();
  await expect(coordButton).toBeFocused();
  await page.keyboard.press("Enter");

  const textarea = page.getByLabel("Coordinates, bounding box, or WKT/GeoJSON");
  await expect(textarea).toBeVisible();
  await textarea.focus();
  await page.keyboard.type("-124.5, 40.0, -123.0, 41.5");

  const addButton = page.getByRole("button", { name: "Add place" });
  await addButton.focus();
  await page.keyboard.press("Enter");

  const row = page.locator(".place-row").first();
  await expect(row).toBeVisible();

  // the place round-trips through #pl= -- URL-is-the-view (CLAUDE.md), never a second, local copy.
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#pl=g1\./);

  // --- rename, keyboard only ----------------------------------------------------------------------
  const renameInput = page.getByLabel("Rename place").first();
  await renameInput.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End"); // select the existing text, keyboard-only
  await page.keyboard.type("My Renamed Place");
  await page.keyboard.press("Tab"); // blur -> onchange fires
  await expect(renameInput).toHaveValue("My Renamed Place");

  // --- remove, keyboard only ----------------------------------------------------------------------
  const deleteButton = page.getByRole("button", { name: "Delete place" }).first();
  await deleteButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".place-row")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
});

test("a hostile feature name renders as text -- never fires and never becomes markup", async ({
  page,
}) => {
  await openPlaces(page);
  await addByCoordinates(page);

  const dialogs: string[] = [];
  page.on("dialog", (d) => dialogs.push(d.message()));

  const renameInput = page.getByLabel("Rename place").first();
  await renameInput.fill("<img src=x onerror=alert(1)>");
  await renameInput.blur();

  // rendered as the LITERAL 29 characters in a plain <input> value -- an injected onerror would
  // have to actually be parsed as an <img> element to fire, which a text input value never does.
  await expect(renameInput).toHaveValue("<img src=x onerror=alert(1)>");
  await page.waitForTimeout(50);
  expect(dialogs).toEqual([]);
});

test("axe: zero serious/critical findings with the Places panel AND the coordinate dialog open", async ({
  page,
}) => {
  await openPlaces(page);
  await page.getByRole("button", { name: "Enter coordinates" }).click();
  await expect(page.getByLabel("Coordinates, bounding box, or WKT/GeoJSON")).toBeVisible();

  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
});

test("the hash is absent from every request the browser makes during the whole flow", async ({
  page,
}) => {
  const urls = collectRequests(page);
  await openPlaces(page);
  await addByCoordinates(page);
  await page.locator(".places-footer").getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("heading", { name: "Share" })).toBeVisible();

  // a browser never SENDS the fragment in a request by spec; the second-order check is that no
  // URL this app itself built (a fetch, an analytics payload logged as a request) carries the
  // literal g1-encoded payload either.
  const hash = await page.evaluate(() => location.hash.replace(/^#pl=/, ""));
  expect(hash.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url).not.toContain(hash);
  }
});
