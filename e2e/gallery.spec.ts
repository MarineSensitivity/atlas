import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// atlas-3 step 2, Deliverable 3/4: the gallery is the review surface and the Playwright screenshot
// baseline for every src/lib/ui component. This spec covers what tests/**/*.test.ts (vitest,
// pure logic, no DOM) cannot: real rendering, real focus, real keyboard behavior, and axe over the
// actual DOM in both themes at both widths.
//
// HERMETIC: the one external resource the gallery ever requests (the seal image, About.svelte's
// default VITE_SEAL_URL) is routed to a fixture -- this spec never touches the live network,
// matching e2e/shell.smoke.spec.ts's convention.

const THEMES = ["navy", "paper"] as const;
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

const SEAL_FIXTURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">' +
  '<circle cx="100" cy="100" r="90" fill="#123456"/></svg>';

async function routeSealFixture(page: Page) {
  await page.route("**/branding/mma-seal.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: SEAL_FIXTURE_SVG }),
  );
}

async function gotoGallery(page: Page, theme: (typeof THEMES)[number]) {
  await routeSealFixture(page);
  await page.goto(`/gallery.html?theme=${theme}`, { waitUntil: "networkidle" });
}

test.describe("screenshots: every section, both themes, phone and desktop widths", () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${theme} @ ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoGallery(page, theme);
        await expect(page).toHaveScreenshot(`gallery-${theme}-${viewport.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.02,
        });
      });
    }
  }
});

// atlas-3 step 4 fix round 1: the gate itself had a hole -- it filtered on serious/critical and
// silently ignored `incomplete` entirely, where aria-prohibited-attr (28 nodes), duplicate-id-aria
// (6 nodes) and color-contrast (16 nodes) all sat unexamined. `incomplete` must now be EMPTY, or
// every entry still present must be explicitly triaged here with a reason -- a new incomplete id
// showing up untriaged fails the gate, the same as a real violation would. Fixing items 1
// (per-instance ids) and 4 (role="img" instead of role-less aria-label) makes
// aria-prohibited-attr and duplicate-id-aria disappear outright.
const INCOMPLETE_ALLOWLIST: Record<string, string> = {
  "color-contrast":
    "axe cannot statically resolve two kinds of composited color here: (1) color-mix()/" +
    "backdrop-filter glass surfaces (every panel/rail's translucent background), and (2) the " +
    'Treemap cell labels, plain SVG <text> painted over a <rect> it reports as "overlapped" ' +
    "even though the label and its background share one element and one fixed contrast (label " +
    "color: --text-on-accent; fill: a --cat-* token -- both already gated). " +
    "scripts/contrast.mjs verifies every brand-chrome token pair against --surface-panel-basis " +
    "(the measured worst-case OPAQUE composite of that glass over the map); the eight --cat-*" +
    " tokens are measured against that same surface too (see tokens.css's @contrast block) -- " +
    "this IS the real gate for both cases axe cannot resolve on its own.",
};

test.describe("axe: zero serious/critical findings, and every `incomplete` finding triaged, both themes, both widths", () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${theme} @ ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoGallery(page, theme);
        const { violations, incomplete } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);

        const untriaged = incomplete.filter((v) => !(v.id in INCOMPLETE_ALLOWLIST));
        expect(untriaged, JSON.stringify(untriaged, null, 2)).toEqual([]);
      });
    }
  }
});

test.describe("keyboard", () => {
  test("Tab reaches every CURRENT tab stop on the page (roving-tabindex groups excluded from the count on purpose)", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    await page.evaluate(() => {
      let i = 0;
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        if (el.tabIndex >= 0 && el.offsetParent !== null) {
          el.setAttribute("data-tabstop", String(i++));
        }
      }
    });
    const total = await page.evaluate(() => document.querySelectorAll("[data-tabstop]").length);
    expect(total).toBeGreaterThan(20); // sanity: the gallery really has many controls

    const visited = new Set<string>();
    for (let i = 0; i < total + 10; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => document.activeElement?.getAttribute("data-tabstop"));
      if (stop !== null && stop !== undefined) visited.add(stop);
    }
    expect(visited.size).toBe(total);
  });

  test("the rail's roving tabindex moves focus with arrow keys, wrapping at both ends", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const toolbar = page.locator("#rail [role='toolbar']").first();
    await toolbar.locator("button[aria-label='Layers']").focus();

    await page.keyboard.press("ArrowDown");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Places");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Flower plot");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Places");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Layers");
    // wrap backward past the first item to the last ("Report")
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Report");
  });

  test("the inactive Flower tool (Species lens) is aria-disabled but stays reachable via roving tabindex", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const speciesToolbar = page.locator("#rail [role='toolbar']").nth(1);
    const layers = speciesToolbar.locator("button[aria-label='Layers']");
    const flower = speciesToolbar.locator("button[aria-label='Flower plot']");
    await expect(flower).toHaveAttribute("aria-disabled", "true");
    await expect(flower).not.toHaveAttribute("disabled", "");
    // it is not a static tabindex="-1" (that would be using tabindex as the disabling mechanism,
    // which spec.md §5.2 explicitly rules out) -- roving tabindex must be able to reach it, the
    // same as any enabled control in the group
    await layers.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(flower).toBeFocused();
    await expect(flower).toHaveAttribute("tabindex", "0");
  });

  test("Esc collapses a panel and moves focus to its pill; expanding returns focus to control 1", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const panelSection = page.locator("#panel");
    const collapseBtn = panelSection.locator('[data-panel-control="collapse"]');
    await collapseBtn.focus();
    await page.keyboard.press("Escape");
    const pill = panelSection.locator("button.panel-pill");
    await expect(pill).toBeFocused();
    await pill.press("Enter");
    await expect(panelSection.locator('[data-panel-control="collapse"]')).toBeFocused();
  });

  test("a modal traps focus and returns it to the opener on close (Esc = the top layer)", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const modalSection = page.locator("#modal");
    const openBtn = modalSection.getByRole("button", { name: "Open a modal" });
    await openBtn.focus();
    await page.keyboard.press("Enter");

    const dialog = modalSection.locator("dialog");
    await expect(dialog).toBeVisible();
    const focusInsideDialog = () =>
      page.evaluate(() => document.activeElement?.closest("dialog") !== null);
    expect(await focusInsideDialog()).toBe(true);

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInsideDialog()).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(openBtn).toBeFocused();
  });

  test("every panel-size control group has an accessible name on each of its three buttons", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const group = page.locator("#panel [role='group'][aria-label='Panel size']");
    const names = await group
      .locator("button")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(names).toEqual(["Collapse to a pill", "Half height", "Full height"]);
    for (const name of names) expect(name).toBeTruthy();
  });
});

test.describe("the seal (spec.md §9 / D10)", () => {
  test("renders at >= 72 CSS px only when VITE_SEAL is '1'; never when unset", async ({ page }) => {
    await gotoGallery(page, "navy");
    const on = page.locator("#about figure").nth(0);
    const off = page.locator("#about figure").nth(1);

    const seal = on.locator("img.seal");
    await expect(seal).toBeVisible();
    // the seal's own content box, NOT its boundingBox() -- the guide's required clear space is
    // padding on this same element (box-sizing: content-box), so boundingBox() (which measures
    // the padded border-box) stays >= 72 even if the image content itself were shrunk. The content
    // size is what spec.md's ">= 72 CSS px" rule is actually about.
    const contentSize = await seal.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { width: parseFloat(cs.width), height: parseFloat(cs.height) };
    });
    expect(contentSize.width).toBeGreaterThanOrEqual(72);
    expect(contentSize.height).toBeGreaterThanOrEqual(72);

    await expect(off.locator("img.seal")).toHaveCount(0);
  });
});

test.describe("atlas-3 step 2b: the data components (Flower, DataTable, Treemap)", () => {
  test("DataTable: a header click sets aria-sort, and it toggles asc -> desc -> none", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    // the FIRST <tr> in <thead> is the sortable header row; the second carries the per-column
    // filter inputs (whose accessible names also mention the column label, so a plain
    // hasText-on-any-th locator would ambiguously match both).
    const header = page
      .locator("#dt-small thead tr")
      .first()
      .locator("th", { hasText: "Scientific name" });
    const sortBtn = header.getByRole("button", { name: "Scientific name" });

    await expect(header).toHaveAttribute("aria-sort", "none");
    await sortBtn.click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await sortBtn.click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await sortBtn.click();
    await expect(header).toHaveAttribute("aria-sort", "none");
  });

  test("DataTable: arrow keys move the roving-tabindex active cell", async ({ page }) => {
    await gotoGallery(page, "navy");
    const table = page.locator("#dt-small table");
    const cell00 = table.locator('td[data-row="0"][data-col="0"]');
    const cell01 = table.locator('td[data-row="0"][data-col="1"]');
    const cell10 = table.locator('td[data-row="1"][data-col="0"]');

    await cell00.click();
    await expect(cell00).toBeFocused();
    await expect(cell00).toHaveAttribute("tabindex", "0");
    await expect(cell01).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("ArrowRight");
    await expect(cell01).toBeFocused();
    await expect(cell01).toHaveAttribute("tabindex", "0");
    await expect(cell00).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowDown");
    await expect(cell10).toBeFocused();
  });

  test("DataTable: a numeric column sorts numerically, not as strings ('9%' before '10%')", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const table = page.locator("#dt-big table");
    const header = page.locator("#dt-big thead tr").first().locator("th", { hasText: "ER score" });
    await header.getByRole("button", { name: "ER score" }).click(); // ascending

    // 10,000 rows cycling 0-99% gives both single- and double-digit percentages; a lexicographic
    // ("string") sort would put "10%" before "9%" and break strict non-decreasing order somewhere
    // in the first dozen rows -- a numeric sort never does.
    const cells = table.locator('td[data-col="3"]');
    const texts = await cells.evaluateAll((els) => els.slice(0, 12).map((el) => el.textContent));
    const values = texts.map((t) => Number((t ?? "").replace("%", "")));
    expect(values.length).toBeGreaterThan(5);
    for (let i = 1; i < values.length; i++) {
      expect(
        values[i],
        `row ${i} (${values[i]}%) is less than row ${i - 1} (${values[i - 1]}%)`,
      ).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  test("DataTable: only a bounded window of rows is ever in the DOM, even with 10,000 rows", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const rows = page.locator("#dt-big tbody tr[aria-rowindex]");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(50); // virtualized -- nowhere near the full 10,000
  });

  test("Flower: every drawn petal is keyboard-reachable and individually named", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const petals = page.locator("#flower-eight .petal");
    const n = await petals.count();
    expect(n).toBe(8); // this fixture has no null components
    for (let i = 0; i < n; i++) {
      const petal = petals.nth(i);
      await expect(petal).toHaveAttribute("tabindex", "0");
      const label = await petal.getAttribute("aria-label");
      expect(label, `petal ${i} has no accessible name`).toBeTruthy();
    }
    await petals.first().focus();
    await expect(petals.first()).toBeFocused();
  });

  test("Treemap: every cell is keyboard-reachable and individually named", async ({ page }) => {
    await gotoGallery(page, "navy");
    const cells = page.locator("#treemap-populated .cell");
    const n = await cells.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const cell = cells.nth(i);
      await expect(cell).toHaveAttribute("tabindex", "0");
      const label = await cell.getAttribute("aria-label");
      expect(label, `treemap cell ${i} has no accessible name`).toBeTruthy();
    }
    await cells.first().focus();
    await expect(cells.first()).toBeFocused();
  });

  test("Treemap: an empty dataset shows the empty state, not a blank chart", async ({ page }) => {
    await gotoGallery(page, "navy");
    await expect(page.locator("#treemap-empty .empty")).toContainText("No species data");
    await expect(page.locator("#treemap-empty .cell")).toHaveCount(0);
  });

  test("Flower: the data-table toggle shows the SAME numbers as the petals' tooltips", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const flower = page.locator("#flower-eight");
    const petalLabels = await flower
      .locator(".petal")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    await flower.getByRole("button", { name: "Show table" }).click();
    const rows = await flower.locator(".flower-table tbody tr:not(.mean-row)").evaluateAll((trs) =>
      trs.map((tr) => {
        const cells = tr.querySelectorAll("td");
        return `${cells[0]?.textContent}: ${cells[1]?.textContent}`;
      }),
    );
    expect(rows).toEqual(petalLabels);
  });
});

// atlas-3 step 4 fix round 1: 13 defects an Opus manual accessibility walk found that axe's
// serious/critical filter missed. Each block below is one item; the seeded fault for each is
// documented in this step's report (a manual revert-run-revert pass), not re-encoded here as a
// permanent mutation test the way tests/*.test.ts do for pure logic -- these assert real rendered
// behavior a unit test cannot see.
test.describe("fix round 1, item 1 (SC 4.1.2): every id-reference resolves to a UNIQUE node", () => {
  test("no aria-describedby/aria-labelledby/aria-controls target is missing, duplicated, or shared", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const problems = await page.evaluate(() => {
      const found: string[] = [];
      const idCounts = new Map<string, number>();
      for (const el of document.querySelectorAll("[id]")) {
        idCounts.set(el.id, (idCounts.get(el.id) ?? 0) + 1);
      }
      for (const attr of ["aria-describedby", "aria-labelledby", "aria-controls"]) {
        for (const el of document.querySelectorAll(`[${attr}]`)) {
          for (const id of (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean)) {
            const count = idCounts.get(id) ?? 0;
            if (count === 0) found.push(`${attr}="${id}" on <${el.tagName}> has no matching id`);
            else if (count > 1)
              found.push(`id="${id}" (referenced by ${attr}) is shared by ${count} elements`);
          }
        }
      }
      return found;
    });
    expect(problems).toEqual([]);
  });

  test("the enabled Flower rail button's own tooltip describes ITSELF, not the inactive rail's", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    // #rail's first toolbar (Scores lens) has an ENABLED Flower button; its second toolbar
    // (Species lens) has the INACTIVE one with a DIFFERENT tooltip text ("...Scores only"). Both
    // are labelled "Flower plot" -- exactly the label collision the fix closes.
    const enabledFlower = page
      .locator("#rail [role='toolbar']")
      .nth(0)
      .locator("button[aria-label='Flower plot']");
    const describedById = await enabledFlower.getAttribute("aria-describedby");
    const description = await page.locator(`#${describedById}`).textContent();
    expect(description).not.toContain("Scores only");
  });
});

test.describe("fix round 1, item 2 (SC 1.4.13): tooltips are hoverable and Esc-dismissible without moving focus", () => {
  test("HexButton: the pointer can move onto the tooltip itself without it disappearing", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const btn = page.locator("#hex-button button[aria-label='Layers']").first();
    await btn.hover();
    const tooltipId = await btn.getAttribute("aria-describedby");
    const tooltip = page.locator(`#${tooltipId}`);
    await expect(tooltip).toBeVisible();
    await tooltip.hover();
    await page.waitForTimeout(200); // past the close-delay if hoverable failed
    await expect(tooltip).toBeVisible();
  });

  test("HexButton: Esc hides the tooltip without moving focus off the button", async ({ page }) => {
    await gotoGallery(page, "navy");
    const btn = page.locator("#hex-button button[aria-label='Layers']").first();
    await btn.focus();
    const tooltipId = await btn.getAttribute("aria-describedby");
    const tooltip = page.locator(`#${tooltipId}`);
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(btn).toBeFocused();
  });
});

test.describe("fix round 1, item 3 (SC 1.4.1/1.4.11): forced-colors mode does not erase state", () => {
  test.use({ forcedColors: "active" });

  test("HexButton: idle, pressed and inactive faces are visually distinct system colors", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const idle = page.locator("#hex-button button[aria-pressed='false']").first();
    const pressed = page.locator("#hex-button button[aria-pressed='true']").first();
    const inactive = page.locator("#hex-button button[aria-disabled='true']");
    const idleColor = await idle.evaluate((el) => getComputedStyle(el, "::after").backgroundColor);
    const pressedColor = await pressed.evaluate(
      (el) => getComputedStyle(el, "::after").backgroundColor,
    );
    expect(pressedColor).not.toBe(idleColor);

    const idleIconColor = await idle.locator(".icon").evaluate((el) => getComputedStyle(el).color);
    const inactiveIconColor = await inactive
      .locator(".icon")
      .evaluate((el) => getComputedStyle(el).color);
    expect(inactiveIconColor).not.toBe(idleIconColor);
  });

  test("Legend: the ramp is not blank (forced-color-adjust: none keeps the data gradient)", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const backgroundImage = await page
      .locator("#legend .ramp")
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(backgroundImage).not.toBe("none");
  });
});

test.describe("fix round 1, item 4 (SC 1.1.1/4.1.2): Flower petals and Treemap cells keep their own accessible name", () => {
  test("Flower: role=group on the SVG (never role=img), role=img + a computed name on each petal", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const svg = page.locator("#flower-eight svg.flower-svg");
    await expect(svg).toHaveAttribute("role", "group");
    await expect(svg.getByRole("img", { name: "Coral: 18" })).toBeVisible();
  });

  test("Treemap: each cell keeps role=img with its own computed name", async ({ page }) => {
    await gotoGallery(page, "navy");
    const invertebrate = page
      .locator("#treemap-populated")
      .getByRole("img", { name: /^Invertebrate: /, exact: false });
    await expect(invertebrate.first()).toBeVisible();
  });
});

test.describe("fix round 1, item 6 (SC 1.3.1/4.1.2): the grid has a name, and its row count/index include both header rows", () => {
  test("aria-rowcount is data rows PLUS the two header rows; aria-rowindex starts data rows at 3", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const table = page.locator("#dt-small table");
    await expect(table).toHaveAttribute("aria-label", "Species table (small)");
    await expect(table).toHaveAttribute("aria-rowcount", "8"); // 6 data rows + 2 header rows
    await expect(table.locator("thead tr").nth(0)).toHaveAttribute("aria-rowindex", "1");
    await expect(table.locator("thead tr").nth(1)).toHaveAttribute("aria-rowindex", "2");
    await expect(table.locator("tbody tr[aria-rowindex]").first()).toHaveAttribute(
      "aria-rowindex",
      "3",
    );
  });
});

test.describe("fix round 1, item 7 (SC 2.4.3): Sheet's Esc moves focus to its own collapse control, never <body>", () => {
  test("collapsing to peek via Esc leaves focus on the collapse button", async ({ page }) => {
    await gotoGallery(page, "navy");
    const sheetSection = page.locator("#sheet");
    const collapseBtn = sheetSection.locator('[data-sheet-control="collapse"]');
    await collapseBtn.focus();
    await page.keyboard.press("Escape");
    await expect(collapseBtn).toBeFocused();
    const isBody = await page.evaluate(() => document.activeElement === document.body);
    expect(isBody).toBe(false);
  });
});

test.describe("fix round 1, item 8 (SC 1.4.10): no horizontal overflow at 320 CSS px", () => {
  test("the whole gallery page reflows at 320x800 with no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await gotoGallery(page, "navy");
    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(1); // 1px of rounding slack
  });
});

test.describe("fix round 1, item 9 (SC 2.2.1): a Toast's auto-dismiss pauses while focused", () => {
  test("focusing its Dismiss button keeps a toast alive past its 5s timeout", async ({ page }) => {
    await gotoGallery(page, "navy");
    const toastSection = page.locator("#toast");
    await toastSection.getByRole("button", { name: "Announce a result" }).click();
    const toast = toastSection.locator(".toast").first();
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Dismiss" }).focus();
    await page.waitForTimeout(6000);
    await expect(toast).toBeVisible(); // still here -- the timer was paused while focused
  });
});

test.describe("fix round 1, item 10 (SC 4.1.3): exactly ONE live region exists, even after several components announce", () => {
  test("on initial load", async ({ page }) => {
    await gotoGallery(page, "navy");
    expect(await page.locator('[aria-live], [role="status"]').count()).toBe(1);
  });

  test("after several different components each announce something", async ({ page }) => {
    await gotoGallery(page, "navy");
    // both targets below are intentionally aria-disabled (not the disabled attribute -- spec.md
    // §5.2: "stays focusable and explains itself"), so a real pointer user CAN click them; only
    // Playwright's own extra-cautious actionability check treats aria-disabled as unclickable,
    // hence `force: true` on both.
    await page
      .locator("#rail [role='toolbar']")
      .nth(1)
      .locator("button[aria-label='Flower plot']")
      .click({ force: true });
    await page.locator("#hex-button button[aria-disabled='true']").click({ force: true });
    await page.locator("#toast").getByRole("button", { name: "Announce a result" }).click();
    expect(await page.locator('[aria-live], [role="status"]').count()).toBe(1);
  });
});

test.describe("fix round 1, item 11 (SC 1.1.1): the Legend ramp has a text equivalent stating both endpoints with units", () => {
  test("role=img, a name with the quantity and both endpoints with units, and aria-hidden ticks", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const ramp = page.locator("#legend .ramp");
    await expect(ramp).toHaveAttribute("role", "img");
    const name = await ramp.getAttribute("aria-label");
    expect(name).toContain("Composite score");
    expect(name).toMatch(/from .+ to .+ score/);
    await expect(page.locator("#legend .ramp-ticks")).toHaveAttribute("aria-hidden", "true");
  });
});

test.describe("fix round 1, item 12 (SC 1.4.4/1.4.12): no cell content is lost under the WCAG text-spacing stylesheet", () => {
  test("a clipped cell's full value is still reachable via focus/hover", async ({ page }) => {
    await gotoGallery(page, "navy");
    // the standard SC 1.4.12 test stylesheet (W3C's own technique C36/C35 verification method)
    await page.addStyleTag({
      content: `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`,
    });
    const cell = page.locator("#dt-small td[data-row='0'][data-col='1']"); // scientific name
    await cell.click();
    await expect(cell.locator(".cell-expand")).toBeVisible();
    await expect(cell.locator(".cell-expand")).toHaveText("Balaenoptera musculus");
  });
});

test.describe("fix round 1, item 13 (SC 2.5.8): every control reaches 44 CSS px on a coarse (touch) pointer", () => {
  test.use({ hasTouch: true });

  const SELECTORS = [
    "#popover .popover-trigger",
    "#switch .switch",
    "#segmented button",
    "#pill .pill",
    "#data-table .sort-btn",
    "#data-table .filter-field",
    "#chip .chip-dismiss",
  ];

  for (const selector of SELECTORS) {
    test(selector, async ({ page }) => {
      await gotoGallery(page, "navy");
      const el = page.locator(selector).first();
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.width, `${selector} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${selector} height`).toBeGreaterThanOrEqual(44);
    });
  }
});

test.describe("fix round 1, also: Panel/Sheet's collapse control is a pure disclosure (no static aria-pressed)", () => {
  test("Panel's collapse button carries aria-expanded but not aria-pressed", async ({ page }) => {
    await gotoGallery(page, "navy");
    const collapseBtn = page.locator("#panel [data-panel-control='collapse']");
    await expect(collapseBtn).toHaveAttribute("aria-expanded", "true");
    await expect(collapseBtn).not.toHaveAttribute("aria-pressed", /.*/);
  });

  test("Sheet's collapse button carries aria-expanded but not aria-pressed", async ({ page }) => {
    await gotoGallery(page, "navy");
    const collapseBtn = page.locator("#sheet [data-sheet-control='collapse']");
    await expect(collapseBtn).toHaveAttribute("aria-expanded", /true|false/);
    await expect(collapseBtn).not.toHaveAttribute("aria-pressed", /.*/);
  });
});

test.describe("fix round 1, also: the innermost open layer handles Esc first", () => {
  test("Esc inside a Popover NESTED in a Panel closes only the popover, leaving the panel expanded", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const panelSection = page.locator("#panel");
    const nestedTrigger = panelSection.locator(".popover-trigger");
    await nestedTrigger.click();
    await expect(panelSection.locator(".popover")).toBeVisible();
    await page.keyboard.press("Escape");
    // the popover's own local, stopPropagation()-ing handler must run first, during the SAME
    // bubble pass, before the keydown ever reaches Panel's own root-level handler -- if it did
    // not, the panel underneath would ALSO collapse on this same Escape press.
    await expect(panelSection.locator(".popover")).toBeHidden();
    await expect(panelSection.locator(".panel-surface")).toBeVisible();
  });
});

test.describe("fix round 1, also: Panel's body is keyboard-reachable even with no focusable child", () => {
  test("Panel's body region has tabindex=0 and its own accessible name", async ({ page }) => {
    await gotoGallery(page, "navy");
    const body = page.locator("#panel .panel-body");
    await expect(body).toHaveAttribute("tabindex", "0");
    await expect(body).toHaveAttribute("role", "region");
  });
});

test.describe("fix round 1, also: a real focus ring and the roving-tabindex 'active' cell are visually distinct", () => {
  test("DataTable: the active-but-unfocused cell uses a lighter, dashed indicator, not the strong focus ring", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const cell00 = page.locator("#dt-small td[data-row='0'][data-col='0']");
    const cell01 = page.locator("#dt-small td[data-row='0'][data-col='1']");
    // a mouse click focuses the cell but browsers do not treat that as :focus-visible -- move
    // there with a REAL keyboard arrow press (from an adjacent cell) to get the true "just
    // tabbed/arrowed here" focus ring this fix distinguishes from the merely-active one.
    await cell01.click();
    await cell01.press("ArrowLeft");
    await expect(cell00).toBeFocused();
    const focusedOutline = await cell00.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(focusedOutline).toBe("solid");
    await page.keyboard.press("Tab"); // move real focus elsewhere (the export button, say)
    const stillActiveButNotFocused = page.locator("#dt-small td[data-row='0'][data-col='0']");
    await expect(stillActiveButNotFocused).not.toBeFocused();
    const unfocusedOutline = await stillActiveButNotFocused.evaluate(
      (el) => getComputedStyle(el).outlineStyle,
    );
    expect(unfocusedOutline).toBe("dashed");
  });
});

test.describe("fix round 1, also: the Flower petal fixture has no duplicate category, and the fixture never had one", () => {
  test("#flower-eight has exactly 8 distinct petal categories (colors)", async ({ page }) => {
    await gotoGallery(page, "navy");
    const fills = await page
      .locator("#flower-eight .petal")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).fill));
    expect(new Set(fills).size).toBe(fills.length);
    expect(fills).toHaveLength(8);
  });
});
