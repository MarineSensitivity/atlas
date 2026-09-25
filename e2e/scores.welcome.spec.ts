// atlas-4 step 3 — the welcome modal (parity doc §5.5 modal 2): shown on first paint unless
// suppressed. This spec deliberately does NOT call `routeSealFixture()` (which seeds the
// suppression key for every OTHER shell spec — see its own header) so it can exercise the real,
// unsuppressed first-visit behaviour.
import { expect, test } from "@playwright/test";
import { routeBucket, routeSession, waitForHydration } from "./hermetic";

test.describe("welcome modal (first visit, not suppressed)", () => {
  test("shows on first paint; 'don't show again' persists across a reload", async ({ page }) => {
    await routeBucket(page);
    await routeSession(page, null);
    await page.route("**/branding/mma-seal.svg", (route) => route.fulfill({ status: 404 }));
    await page.goto("/");
    await waitForHydration(page);

    const dialog = page.getByRole("dialog", { name: "Welcome to the Marine Sensitivity Atlas" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Don't show this again").check();
    await dialog.getByRole("button", { name: "Explore" }).click();
    await expect(dialog).not.toBeVisible();

    await page.reload();
    await waitForHydration(page);
    await expect(dialog).not.toBeVisible();
  });

  test("Take a tour announces (no real tour this phase); hidden when ?tour=off", async ({
    page,
  }) => {
    await routeBucket(page);
    await routeSession(page, null);
    await page.route("**/branding/mma-seal.svg", (route) => route.fulfill({ status: 404 }));
    await page.goto("/?tour=off");
    await waitForHydration(page);
    await expect(page.getByRole("button", { name: "Take a tour" })).toHaveCount(0);
  });
});
