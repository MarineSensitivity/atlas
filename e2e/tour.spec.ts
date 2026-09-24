// U6 (round 2): the guided tour (driver.js, src/shell/tour*.ts) — end to end. HERMETIC, the same
// convention as e2e/keyboard-walk.spec.ts (whose minimal BOOT this file's scores fixture mirrors —
// none of SCORES_TOUR_STEPS' anchors depend on zone/PMTiles data, only on the rail/topbar/map
// regions that always render) and e2e/species-hermetic.ts (whose real taxa/legend fixtures the
// species walk needs — SPECIES_TOUR_STEPS' "legend" step anchors on the REAL published legend).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs } from "./map-hermetic";
import { gotoSpecies, LEATHERBACK_SP } from "./species-hermetic";
import { SCORES_TOUR_STEPS, SPECIES_TOUR_STEPS, type TourStep } from "../src/shell/tour";

const VER = "v7";

const BOOT = {
  ver: VER,
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  grid: { grid_id: "test05r" },
  release: { status: "release", access: "public" },
  units: [],
  zones: { programarea: [{ key: "GAA", name: "Gulf of America", metrics: { composite: 73.4 } }] },
  datasets: [],
  layers: [],
};

/** the same tags e2e/matrix.a11y.spec.ts's own helper uses. */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function seriousOrCritical(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

async function gotoScores(page: Page, path: string): Promise<void> {
  const ctx = page.context() as unknown as Page;
  await blockWasm(ctx);
  await routeBucket(ctx, VER, BOOT);
  await routeSession(ctx, null);
  await routeSealFixture(ctx);
  await routeBasemapStyle(ctx);
  await routeGlyphs(ctx);
  await page.goto(path);
  await waitForHydration(page);
}

const popover = (page: Page) => page.locator(".driver-popover");

test.describe("?tour=on starts the tour on load", () => {
  test("shows the first step's popover, its title matching the FIRST scores step", async ({
    page,
  }) => {
    await gotoScores(page, "/?tour=on");
    await expect(popover(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".driver-popover-title")).toHaveText(SCORES_TOUR_STEPS[0].title);
  });
});

test.describe("Esc ends the tour and restores the URL", () => {
  test("Help menu -> Take a tour -> Esc leaves the address bar exactly as it was", async ({
    page,
  }) => {
    await gotoScores(page, "/?proj=mercator");
    const before = page.url();

    await page.locator('[data-control="help"]').click();
    await page.getByRole("button", { name: "Take a tour" }).click();
    await expect(popover(page)).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("Escape");
    await expect(popover(page)).toHaveCount(0);
    expect(page.url()).toBe(before);
  });
});

test.describe("every step's anchor actually exists on the lens it belongs to", () => {
  /** drives Next through every step of `steps`, in order, asserting the CURRENT step's anchor
   * resolves in the real DOM before moving on — never conditionally skipped: a step whose element
   * is missing fails this test outright (`expect(...).toBe(true)`), it does not fall through to
   * driver.js's own `skipMissingElement` behaviour. */
  async function walkAndAssertAnchors(page: Page, steps: readonly TourStep[]): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await expect(popover(page), `step ${i} ("${step.id}")`).toBeVisible({ timeout: 10_000 });
      await expect(page.locator(".driver-popover-title"), `step ${i} ("${step.id}")`).toHaveText(
        step.title,
        { timeout: 10_000 },
      );
      // `waitForSelector` (not an instantaneous `querySelector`): the species lens' legend, in
      // particular, resolves asynchronously (a real species query) -- this tolerates that without
      // weakening the assertion itself: a truly absent anchor still fails hard after the timeout,
      // never silently skipped. 20s (not 8s): measured flaky under shared-machine load -- a real
      // species query occasionally took longer than 8s to resolve, which is a false red on this
      // gate, not a true one (docs/usability.md's own species-lens timing note: "about 5.8s" even
      // uncontended).
      const exists = await page
        .waitForSelector(step.element, { timeout: 20_000, state: "attached" })
        .then(() => true)
        .catch(() => false);
      expect(exists, `step "${step.id}"'s anchor (${step.element}) must exist in the DOM`).toBe(
        true,
      );
      if (i < steps.length - 1) {
        await page.locator(".driver-popover-next-btn").click();
      }
    }
    // the last step's "Next" button is a Done button (driver.js's own `doneBtnText`) — finish the
    // tour cleanly rather than leaving the popover open into the next test.
    await page.locator(".driver-popover-next-btn").click();
    await expect(popover(page)).toHaveCount(0);
  }

  test("scores: all 8 steps", async ({ page }) => {
    await gotoScores(page, "/?tour=on");
    await walkAndAssertAnchors(page, SCORES_TOUR_STEPS);
  });

  test("species: all 5 steps (the legend step needs a REAL resolved species)", async ({ page }) => {
    // a real species resolution (search -> card -> map, each its own 10 s popover wait) can run
    // past the default 30 s test timeout before ever reaching "legend"'s own 8 s element wait --
    // species.smoke.spec.ts's own leatherback poll already budgets 10 s just for the title.
    test.setTimeout(60_000);
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9&tour=on`, "v9");
    await walkAndAssertAnchors(page, SPECIES_TOUR_STEPS);
  });
});

test.describe("keyboard: the popover is focusable and Tab stays inside it", () => {
  test("Tab/Shift+Tab cycle within the popover (+ its highlighted anchor), never escaping to the page", async ({
    page,
  }) => {
    await gotoScores(page, "/?tour=on");
    await expect(popover(page)).toBeVisible({ timeout: 10_000 });

    const insideTrap = () =>
      page.evaluate(() => {
        const wrapper = document.querySelector(".driver-popover");
        const active = document.activeElement;
        return !!wrapper && !!active && (wrapper.contains(active) || active === wrapper);
      });

    // driver.js focuses the first focusable element in [popover, highlighted target] on render.
    expect(await insideTrap()).toBe(true);

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await insideTrap(), `after Tab #${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await insideTrap(), `after Shift+Tab #${i + 1}`).toBe(true);
    }
  });
});

test.describe("axe on the popover", () => {
  test("zero serious/critical violations while the tour's first step is open", async ({ page }) => {
    await gotoScores(page, "/?tour=on");
    await expect(popover(page)).toBeVisible({ timeout: 10_000 });
    const bad = await seriousOrCritical(page);
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
  });
});
