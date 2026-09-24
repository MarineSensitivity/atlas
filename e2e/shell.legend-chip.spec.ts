// P1 fix (Ben's phone report on the LIVE app, 390x844, dark, v7, Scores lens, 2026-09-24): the
// legend chip must never overlap the sheet's own header controls or its scrollable content, at
// any detent -- and tapping it must open a REAL legend, not a blank dialog. Two independent bugs:
//   1. `.legend-chip-region` (shell.css) sat at a FIXED offset from the bottom regardless of the
//      sheet's detent, so "above the tab bar" was only ever true by coincidence -- at "peek" it
//      landed squarely on the sheet's own collapse/half/full buttons ("The 'Combined score...'
//      obscures the buttons"), at "half"/"full" it covered the last row of whatever the sheet was
//      scrolled to ("still obscured by 'Combined...'").
//   2. ScoresLegend.svelte/SpeciesLegend.svelte both `display:none`d their OWN root below 900px
//      ("no room beside the sheet" on desktop) -- but LegendChip.svelte reuses the SAME component
//      verbatim inside its phone modal, so that rule also blanked the modal's body on the very
//      viewport it was built to serve.
//
// Both assertions are GEOMETRY (`boundingBox()`), never `toBeVisible` -- the chip and the sheet
// controls ARE both visible; the bug is that one draws on top of the other, which `toBeVisible`
// cannot see.
import { expect, test, type Page } from "@playwright/test";
import { gotoScoresMap } from "./scores-hermetic";
import { gotoSpecies, LEATHERBACK_SP } from "./species-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 } });

const DETENTS = [
  { name: "collapsed", buttonLabel: "Collapse to a peek" },
  { name: "half", buttonLabel: "Half height" },
  { name: "full", buttonLabel: "Full height" },
] as const;

async function setDetent(page: Page, buttonLabel: string) {
  await page.getByRole("button", { name: buttonLabel }).click();
}

async function openTableTool(page: Page) {
  await page.locator("#rail-region button[aria-label='Table']").click({ timeout: 5_000 });
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Box, b: Box): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/** the chip's own box must clear BOTH the sheet's header controls (collapse/half/full buttons)
 * and its scrollable body -- checked independently so a failure names which one it hit. */
async function assertChipDoesNotOverlapSheet(page: Page, label: string) {
  const chip = page.locator(".legend-chip");
  await expect(chip, `${label}: legend chip not present`).toBeVisible();
  const chipBox = await chip.boundingBox();
  expect(chipBox, `${label}: legend chip has no box`).not.toBeNull();

  const controlsBox = await page.locator(".panel-controls").boundingBox();
  expect(controlsBox, `${label}: sheet header controls have no box`).not.toBeNull();
  expect(
    intersects(chipBox!, controlsBox!),
    `${label}: chip ${JSON.stringify(chipBox)} overlaps the sheet's header controls ${JSON.stringify(controlsBox)}`,
  ).toBe(false);

  // null at "collapsed"/peek (`.detent-peek .sheet-body{display:none}`) -- nothing to overlap then.
  const bodyBox = await page.locator(".sheet-body").boundingBox();
  if (bodyBox) {
    expect(
      intersects(chipBox!, bodyBox),
      `${label}: chip ${JSON.stringify(chipBox)} overlaps the sheet's scrollable content ${JSON.stringify(bodyBox)}`,
    ).toBe(false);
  }
}

/** tapping the chip must open a dialog whose legend content actually has size -- the modal-reuse
 * bug (#2 above) left `[data-testid]` present in the DOM but `display:none` and 0x0. */
async function assertChipOpensRealLegend(page: Page, testId: string) {
  await page.locator(".legend-chip").click();
  const dialog = page.getByRole("dialog", { name: "Legend" });
  await expect(dialog).toBeVisible();
  const legend = dialog.locator(`[data-testid="${testId}"]`);
  await expect(legend).toBeVisible();
  await expect(legend).not.toHaveCSS("display", "none");
  const box = await legend.boundingBox();
  expect(box, `${testId} has no box inside the modal`).not.toBeNull();
  expect(box!.width, `${testId} has zero width inside the modal`).toBeGreaterThan(0);
  expect(box!.height, `${testId} has zero height inside the modal`).toBeGreaterThan(0);
}

test.describe("P1: the phone legend chip never overlaps the sheet, and its modal is never blank", () => {
  test.describe("scores lens", () => {
    for (const { name, buttonLabel } of DETENTS) {
      test(`detent "${name}", Table tool open: chip clears the sheet`, async ({ page }) => {
        await gotoScoresMap(page, "v7");
        await openTableTool(page);
        await setDetent(page, buttonLabel);
        await assertChipDoesNotOverlapSheet(page, `scores/${name}`);
      });
    }

    test("no tool switch (default Layers tool): chip clears the sheet", async ({ page }) => {
      await gotoScoresMap(page, "v7");
      await assertChipDoesNotOverlapSheet(page, "scores/default-layers");
    });

    test("tapping the chip opens a dialog with a real, non-blank legend", async ({ page }) => {
      await gotoScoresMap(page, "v7");
      await assertChipOpensRealLegend(page, "scores-legend");
    });
  });

  test.describe("species lens", () => {
    for (const { name, buttonLabel } of DETENTS) {
      test(`detent "${name}", Table tool open: chip clears the sheet`, async ({ page }) => {
        await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
        await openTableTool(page);
        await setDetent(page, buttonLabel);
        await assertChipDoesNotOverlapSheet(page, `species/${name}`);
      });
    }

    test("tapping the chip opens a dialog with a real, non-blank legend", async ({ page }) => {
      await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
      await assertChipOpensRealLegend(page, "species-legend");
    });
  });
});
