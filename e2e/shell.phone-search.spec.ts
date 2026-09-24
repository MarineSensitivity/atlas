// P1 (Opus 5.5 eyes-on assessment, 2026-09-24, plans_todo/atlas-refs/): the topbar
// `.search-field` -- which also hosts the species picker while the species lens is active -- is
// `topbar-desktop-only`, and the phone ⋯ menu had no Search item at all: a phone visitor could not
// search a place in the scores lens, and could not change species in the species lens either.
// Fix: a phone-only search button (beside ⋯) opens the SAME search content as a focused,
// near-full-width modal.
//
// RED-FIRST: fails on the pre-fix tree -- no `[data-control="search-phone"]` button exists at
// 390x844.
//
// Q1 (atlas-8 P-round, 2026-09-24) update: the SCORES lens' topbar search field used to be a
// plain, unwired `<input>` on both desktop and phone (ScoresLens.svelte's own former header
// comment: "the Nominatim geocoder was never attempted... out of scope this phase"). It is now
// wired (`ScoresSearch.svelte`/`search.ts`, offline: Program Areas by key/name + "lon, lat"
// coordinates, no geocoder) -- this spec's own "scores lens" test below now proves the phone
// button reaches that SAME real, wired search (parity with the desktop field), not a stub; the
// full red-first "does it actually select something" coverage lives in
// `e2e/scores.search.spec.ts`. The species-lens tests below are unchanged.
import { expect, test } from "@playwright/test";
import { LEATHERBACK_SP, gotoSpecies } from "./species-hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { bootFor as bootForScores, routeZones20 } from "./scores-hermetic";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 } });

test.describe("P1: phone search button", () => {
  test("the button exists in the phone top bar, beside ⋯", async ({ page }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await expect(page.locator('[data-control="search-phone"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Search species and places" })).toBeVisible();
  });

  test("species lens: tapping it opens a focused input; typing a known name lists results; choosing one changes the species model", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");

    await page.getByRole("button", { name: "Search species and places" }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("combobox", { name: "Search species" });
    await expect(input).toBeFocused();

    await input.fill("Walrus");
    const result = dialog.getByRole("option", { name: /Walrus/i });
    await expect(result).toBeVisible();
    await result.click();

    // the dialog closes on selection, and the species model actually changed.
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");
    await expect.poll(() => page.url()).toContain("sp=ms_merge");
  });

  test("scores lens: tapping it opens the focused Program Area / coordinate search (parity with the desktop field)", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page, "v7", bootForScores("v7"));
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeZones20(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    await page.goto("/?proj=mercator");
    await waitForHydration(page);

    await page.getByRole("button", { name: "Search species and places" }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await expect(input).toBeVisible({ timeout: 10_000 });
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("placeholder", "Program Areas or lon, lat");
  });

  test("desktop (1280x800): the phone search button is not rendered", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await expect(page.locator('[data-control="search-phone"]')).toBeHidden();
  });

  // P5 fix round 2 (coordinator finding, 390px eyes-on evidence on
  // p5-phone-search-sheet-species-results.png): the results list rendered PAST the dialog's own
  // bottom edge, over the page behind it -- `.picker-dropdown` is `position: absolute` (by design
  // on the desktop field, where it must float over the map), so it contributed nothing to the
  // modal's own content height. RED-FIRST: fails on the pre-fix tree (the dropdown's boundingBox
  // extends below the dialog's).
  test("species lens: the results list renders INSIDE the dialog, not past its bottom edge", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await page.getByRole("button", { name: "Search species and places" }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await dialog.getByRole("combobox", { name: "Search species" }).fill("Walrus");
    const result = dialog.getByRole("option", { name: /Walrus/i });
    await expect(result).toBeVisible();

    const dialogBox = (await dialog.boundingBox())!;
    const dropdownBox = (await dialog.locator(".picker-dropdown").boundingBox())!;
    const resultBox = (await result.boundingBox())!;
    for (const [name, box] of [
      ["dropdown", dropdownBox],
      ["result row", resultBox],
    ] as const) {
      expect(box.x, `${name}'s left edge is left of the dialog's`).toBeGreaterThanOrEqual(
        dialogBox.x - 0.5,
      );
      expect(box.y, `${name}'s top edge is above the dialog's`).toBeGreaterThanOrEqual(
        dialogBox.y - 0.5,
      );
      expect(
        box.x + box.width,
        `${name}'s right edge extends past the dialog's`,
      ).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 0.5);
      expect(
        box.y + box.height,
        `${name}'s bottom edge extends past the dialog's -- it is rendering OVER the page behind it`,
      ).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 0.5);
    }
  });
});
