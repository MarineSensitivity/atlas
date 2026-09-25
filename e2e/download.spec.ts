// R3-W2: the Download menu, on the REAL shell (scores lens), hermetic.
//
// `e2e/map-hermetic.ts`'s own `BOOT_FIXTURE` carries no `layers`/`palettes` (it exists for
// atlas-map's vector/raster paint proof, which injects a raster directly via `composeStyle()` --
// see map.spec.ts's own header). This file builds a LOCAL fixture that adds a real `layers` row
// (one composite metric, `by_subregion.FULL.cog` = `SCORE_COG_URL`) so the Download menu's
// "Data layer · GeoTIFF" item resolves off the SAME `layerByKey`/`fullSubregion` readers the real
// app uses (Shell.svelte's own `downloadCogUrl`), never a test-only shortcut.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import {
  BOOT_FIXTURE,
  SCORE_COG_URL,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
  routeZonesPmtiles,
} from "./map-hermetic";
import { safeRoute } from "./routeSafety";

const SCORES_BOOT = {
  ...BOOT_FIXTURE,
  layers: [
    {
      metric_key: "sensitivity_ecoregion_rescaled",
      label: "Sensitivity",
      category: "composite",
      order: 1,
      colormap: "spectral_r",
      by_subregion: { FULL: { cog: SCORE_COG_URL, rescale: [1, 100] } },
    },
  ],
  // the same 11 stops species-hermetic.ts's BOOT fixture uses for spectral_r -- one committed
  // ramp table, never retyped per fixture (tests/raster/ramps.wiring.test.ts's own rule, applied
  // here to fixture data rather than source).
  palettes: {
    spectral_r: [
      "#9E0142",
      "#D53E4F",
      "#F46D43",
      "#FDAE61",
      "#FEE08B",
      "#FFFFBF",
      "#E6F598",
      "#ABDDA4",
      "#66C2A5",
      "#3288BD",
      "#5E4FA2",
    ],
  },
};

test.use({ viewport: { width: 1280, height: 800 } });

async function gotoScores(page: Page) {
  await blockWasm(page);
  await routeBucket(page, "v7", SCORES_BOOT);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto("/");
  await waitForHydration(page);
  // the version chip is present at every viewport (unlike the Download trigger, which is
  // `topbar-desktop-only` -- the phone test below runs this same helper at 390px) -- proves the
  // shell settled without assuming a desktop layout.
  await expect(page.locator('[data-control="version-chip"]')).toBeVisible();
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.describe("R3-W2: Download menu", () => {
  test("opens by click, closes by Escape, and returns focus to the trigger", async ({ page }) => {
    await gotoScores(page);
    const trigger = page.locator('[data-control="download"]');
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu", { name: "Download" });
    await expect(menu).toBeVisible();
    // opening the menu moves focus to its first item (Menu.svelte's own `openMenu()`).
    await expect(menu.getByRole("menuitem").first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });

  test("ArrowDown/ArrowUp move focus within the menu, wrapping at both ends", async ({ page }) => {
    await gotoScores(page);
    await page.locator('[data-control="download"]').click();
    const items = page.getByRole("menu", { name: "Download" }).getByRole("menuitem");
    // the menu's own chunk loads asynchronously (lazy) -- wait for the first item to actually be
    // focused (Menu.svelte's own `openMenu()` behaviour) before counting, rather than a synchronous
    // `.count()` right after the click, which can race the import.
    await expect(items.first()).toBeFocused();
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(3); // PNG, SVG, GeoTIFF at minimum

    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.first()).toBeFocused();
    // wrap backward past the first item to the last.
    await page.keyboard.press("ArrowUp");
    await expect(items.last()).toBeFocused();
  });

  test("outside click closes the menu", async ({ page }) => {
    await gotoScores(page);
    await page.locator('[data-control="download"]').click();
    const menu = page.getByRole("menu", { name: "Download" });
    await expect(menu).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(menu).toBeHidden();
  });

  test("'Map view · PNG' downloads a real, non-trivial PNG", async ({ page }) => {
    await gotoScores(page);
    await page.locator('[data-control="download"]').click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "Map view · PNG" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^marine-atlas_scores_.*_v7_\d{8}\.png$/);
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = readFileSync(path!);
    // a real PNG signature and a non-trivial size (a 1x1 placeholder would be under 100 bytes;
    // the composited map+footer+legend is comfortably larger).
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(bytes.length).toBeGreaterThan(2000);
  });

  test("'Map view · SVG' downloads a well-formed SVG with the footer and legend", async ({
    page,
  }) => {
    await gotoScores(page);
    await page.locator('[data-control="download"]').click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "Map view · SVG" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^marine-atlas_scores_.*_v7_\d{8}\.svg$/);
    const path = await download.path();
    const svg = readFileSync(path!, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<image");
    expect(svg).toContain("MarineSensitivity Atlas · v7");
    expect(svg).toContain("linearGradient"); // the legend gradient — this fixture publishes stops
  });

  test("'Data layer · GeoTIFF' fetches the routed COG fixture and saves it", async ({ page }) => {
    await gotoScores(page);
    let cogRequested = false;
    await page.route(
      SCORE_COG_URL,
      safeRoute((route) => {
        cogRequested = true;
        return route.fulfill({
          status: 200,
          contentType: "image/tiff",
          body: Buffer.from("FAKE-GEOTIFF-BYTES"),
        });
      }),
    );

    await page.locator('[data-control="download"]').click();
    const item = page.getByRole("menuitem", { name: "Data layer · GeoTIFF" });
    await expect(item).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent("download"), item.click()]);
    expect(cogRequested).toBe(true);
    expect(download.suggestedFilename()).toBe(
      "marine-atlas_scores_sensitivity_ecoregion_rescaled.tif",
    );
    const path = await download.path();
    const bytes = readFileSync(path!, "utf8");
    expect(bytes).toBe("FAKE-GEOTIFF-BYTES");
  });

  test("phone: the ⋯ menu's 'Download…' item opens the same item list in a Modal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoScores(page);
    await page.locator('[data-control="more-menu"]').click();
    await page.getByRole("menuitem", { name: "Download…" }).click();
    const dialog = page.getByRole("dialog", { name: "Download" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Map view · PNG/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Map view · SVG/ })).toBeVisible();
  });
});
