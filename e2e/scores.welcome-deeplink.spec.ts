// M5 (docs/usability.md §4/§3.6, modal part only): "?tour=off does not suppress the welcome modal
// as its own code comment claims"; and separately, the modal interrupted every deep link, species
// ones included (`species-deeplink-bogus-sp-1280-dark.jpg`).
//
// Root cause + fix: WelcomeModal.svelte's `onMount` read `tour` ONLY to decide whether the "Take a
// Tour" button rendered, never to decide whether the MODAL opened at all -- and never looked at the
// URL for anything else. It now also checks `tour !== "off"` and `!hasViewState(location)`
// (lib/state/codec.ts) before opening. A NEW file, not e2e/scores.welcome.spec.ts (another round's
// file; that spec's own `?tour=off` case only ever asserted the Take-a-Tour BUTTON, which stays
// green either way -- no dialog at all still means zero Take-a-Tour buttons).
//
// Hermetic, same convention as e2e/scores.welcome.spec.ts: no routeSealFixture() call (that seeds
// the OTHER "don't show again" suppression key), so this exercises the real, unsuppressed-by-
// localStorage first-visit path each time.
import { expect, test } from "@playwright/test";
import { routeBucket, routeSession, waitForHydration } from "./hermetic";

const WELCOME_DIALOG_NAME = "Welcome to the Marine Sensitivity Atlas";

async function gotoUnsuppressed(page: import("@playwright/test").Page, path: string) {
  await routeBucket(page);
  await routeSession(page, null);
  await page.route("**/branding/mma-seal.svg", (route) => route.fulfill({ status: 404 }));
  await page.goto(path);
  await waitForHydration(page);
}

test.describe("M5: welcome modal suppression", () => {
  test("sanity: a bare first visit (no localStorage suppression, no deep link) still shows the modal", async ({
    page,
  }) => {
    // guards against the fix OVER-suppressing -- if this ever goes red, hasViewState() is treating
    // an ordinary fresh "/" load as "a deep link".
    await gotoUnsuppressed(page, "/");
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG_NAME })).toBeVisible();
  });

  test("?tour=off suppresses the modal itself, not just the Take-a-Tour button", async ({
    page,
  }) => {
    await gotoUnsuppressed(page, "/?tour=off");
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG_NAME })).toHaveCount(0);
  });

  test("a species deep link (?sp=…) never shows the welcome modal", async ({ page }) => {
    await gotoUnsuppressed(page, "/?lens=species&sp=54241");
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG_NAME })).toHaveCount(0);
  });

  test("a scores deep link (?sel=cell:123) never shows the welcome modal", async ({ page }) => {
    await gotoUnsuppressed(page, "/?sel=cell:123");
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG_NAME })).toHaveCount(0);
  });

  test("a places deep link (#pl=…) never shows the welcome modal", async ({ page }) => {
    await gotoUnsuppressed(page, "/#pl=z.pa.GAA");
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG_NAME })).toHaveCount(0);
  });
});
