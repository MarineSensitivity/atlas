// R3-W8 item 3 (Ben, 2026-09-25): "when clicking Share, the link should include all the same UI
// elements in their arrangement, eg on Layers pane." End-to-end proof of the `ui=` token's own
// round trip (`src/shell/uiState.ts`, unit-tested in tests/shell/uiState.test.ts's parse/format
// core): arrange the shell (dock bottom, expand the Outlines row, pick a real species input,
// untick "Zoom to layer on change"), click Share, then open the COPIED link in a fresh browser
// context and confirm the same arrangement reappears -- not just that the token round-trips in
// isolation. The species input + representation and the zoom-to-layer preference are already
// ordinary `Sel` query state by the time Share is clicked (`in=`, `zl=`) -- this test also checks
// those survive, matching Shell.svelte's `shareUrl()` header ("everything ELSE Ben's example
// names... is already ordinary Sel query state").
import { expect, test, type Page } from "@playwright/test";
import { routeZonesPmtiles } from "./map-hermetic";
import { LEATHERBACK_SP, gotoSpecies } from "./species-hermetic";

test.use({ viewport: { width: 1280, height: 800 } });

// the v9 leatherback fixture's own "FWS Range" input (`rng_fws`, tests/fixtures/species/v9/taxon/
// f9.json) -- the one non-merged input on this taxon that ships a real asset (a pmtiles range with
// a bbox), so its pill is a real, clickable <button> (`hasSurface`, data/layerBar.ts's own rule),
// not a struck-through <span>. `*` (a Playwright glob wildcard, never matching `/`) absorbs the
// fixture's own cache-busting `?v=...` query string.
const FWS_RANGE_URL = "https://file.marinesensitivity.org/pmtiles/v9/rng_fws/C00F.pmtiles*";

/** overrides `navigator.clipboard.writeText` to CAPTURE what Share copies, rather than depending on
 * a real OS clipboard (unavailable/permission-gated in headless CI -- the same trade-off
 * e2e/shell.toast.spec.ts's own header documents for the SAME `onShare()` call). */
async function armClipboardCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __copied: string | null }).__copied = null;
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(text: string) {
          (window as unknown as { __copied: string | null }).__copied = text;
          return Promise.resolve();
        },
      },
    });
  });
}

async function clickShareAndCapture(page: Page): Promise<string> {
  await page.locator('[data-control="share"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: string | null }).__copied), {
      message: "Share never wrote to the (captured) clipboard",
    })
    .not.toBeNull();
  return page.evaluate(() => (window as unknown as { __copied: string }).__copied);
}

test.describe("R3-W8 item 3: Share reproduces the UI arrangement", () => {
  test("dock bottom + Outlines expanded + FWS Range + zoom-to-layer off round-trip through a shared link", async ({
    page,
    context,
  }) => {
    await armClipboardCapture(page);
    await routeZonesPmtiles(page, FWS_RANGE_URL);
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);

    // arrange 1: dock bottom (Panel.svelte's own dock control -- chrome, never the URL, per U1).
    const panelSurface = page.locator("#panel-region .panel-surface");
    await panelSurface.getByRole("button", { name: "Dock bottom" }).click();
    await expect(page.locator("#panel-region")).toHaveAttribute("data-dock", "bottom");

    // arrange 2: expand the "Outlines" row (LayersPanel.svelte's second expandable row).
    const outlinesRow = page.getByRole("button", { name: "Outlines", exact: true });
    await outlinesRow.click();
    await expect(outlinesRow).toHaveAttribute("aria-expanded", "true");

    // arrange 3: pick "FWS Range" -- promoted to the top of the pane by item 1 -- reflected in the
    // ordinary `in=` URL state (not the `ui=` token).
    await page.locator('[data-testid="layer-pill"][data-key="rng_fws"]').click();
    await expect(page).toHaveURL(/[?&]in=rng_fws(&|$)/);

    // arrange 4: untick "Zoom to layer on change" (item 2) -- reflected in `zl=0`.
    await page.locator('[data-testid="zoom-to-layer-toggle"]').uncheck();
    await expect(page).toHaveURL(/[?&]zl=0(&|$)/);

    const shared = await clickShareAndCapture(page);
    expect(shared).toMatch(/[?&]ui=1\./);
    expect(shared).toMatch(/[?&]in=rng_fws(&|$)/);
    expect(shared).toMatch(/[?&]zl=0(&|$)/);

    // open the copied link in a FRESH context -- a different reader, no shared localStorage/panel
    // state to leak the arrangement through any channel besides the link itself.
    const freshContext = await context.browser()!.newContext();
    const page2 = await freshContext.newPage();
    try {
      await routeZonesPmtiles(page2, FWS_RANGE_URL);
      const url = new URL(shared);
      await gotoSpecies(page2, `${url.pathname}${url.search}${url.hash}`);

      await expect(page2.locator("#panel-region")).toHaveAttribute("data-dock", "bottom");
      await expect(
        page2.getByRole("button", { name: "Outlines", exact: true }),
      ).toHaveAttribute("aria-expanded", "true");
      await expect(page2.locator('[data-testid="zoom-to-layer-toggle"]')).not.toBeChecked();
      await expect(page2.locator('[data-testid="layer-pill"][data-key="rng_fws"]')).toHaveClass(
        /active/,
      );
    } finally {
      await freshContext.close();
    }
  });
});
