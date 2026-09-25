import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { assertColorContrastIncompletePinned } from "./hermetic";

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
  // atlas-3 closing review, item 4a: the narrowest viewport the shell itself is gated at
  // (scripts/verify.mjs's VIEWPORTS, e2e/shell.a11y.spec.ts's layout suite) -- the gallery had no
  // equivalent, so a defect only visible/overlapping this narrow was never screenshotted or
  // axe-scanned here.
  { name: "phoneNarrow", width: 320, height: 800 },
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

// atlas-8 phase review M8 (SC 2.4.2 Page Titled): gallery.html is one of the three entry points
// docs/accessibility.md claims a title for; nothing asserted the real, rendered `document.title`.
test("gallery.html has its own descriptive title", async ({ page }) => {
  await gotoGallery(page, "navy");
  await expect(page).toHaveTitle("Atlas component gallery");
});

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
//
// atlas-3 closing review, item 4b: the ORIGINAL fix above allowlisted `color-contrast` by rule id
// alone, which would just as silently swallow a brand-new, unrelated color-contrast defect. Pinned
// instead (see e2e/hermetic.ts's assertColorContrastIncompletePinned doc comment for the full
// rationale and how to re-triage): a node-count ceiling per viewport, and a closed set of the axe
// "cannot determine" reasons.
//
// gallery axe ceilings at phone widths (r2-gax): the gallery grew through U4 + P1-P5, and the
// phone/phoneNarrow counts rose from the baseline 16/20 to 40/68. Investigated per node (selector,
// axe's messageKey, and whether the content is actually reachable) before touching the ceiling:
//   - #data-table (P3's DataTable, +24 at phone / +48 at phoneNarrow): each `td .cell-text` is a
//     column scrolled past `.scroll-region`'s own right edge at rest (scrollLeft 0) -- confirmed
//     reachable (`.scroll-region` itself scrolls, `scrollWidth > clientWidth`; a keyboard move to
//     that cell's `focus()` brings it into view via the browser's default scrollIntoView). This is
//     the SAME deliberate "the table scrolls horizontally, not the page" pattern
//     dataTableCore.ts's own header documents (SC 1.4.10 exempts data tables) -- TRIAGED, not
//     fixed: nothing here is actually invisible or below 4.5:1, axe just cannot sample a
//     partially-scrolled-out node's background.
//   - #categories (+6 at phoneNarrow only): a REAL bug, FIXED (Categories.svelte's `.col` --
//     `min-width: 0` added, see its own comment). `.col` is a flex ITEM of `.gallery-stage`;
//     without an explicit `min-width`, its default `auto` floored its shrink at the unbreakable
//     `<code>` tokens' min-content width, pushing `.col` (and the sibling paragraph sharing its
//     width) past the section's right edge. `.cat-table-scroll`'s own `max-width:100%` could not
//     stop this (percentages are indeterminate during intrinsic-size computation). Worse,
//     `#gallery-main`'s `overflow-y: auto` computes `overflow-x: auto` too (CSS Overflow's
//     either-axis-non-visible rule), so the overflow was silently absorbed by making the WHOLE
//     gallery body sideways-scrollable instead of triggering the section's own intended
//     `.cat-table-scroll` containment -- the paragraph text was genuinely clipped with no
//     per-section way to reach it. After the fix, `.cat-table-scroll` is the thing that scrolls
//     (matching #data-table's pattern); the paragraph is now fully on-screen, and only 5 of the
//     original 6 nodes remain (the "Color token" column's `<code>` cells past the fold) --
//     verified reachable the same way as #data-table's, so TRIAGED.
// measured today (both themes report the SAME numbers/reasons):
//   phone (390x844):       40 nodes, {bgOverlap, pseudoContent, elmPartiallyObscured}
//   desktop (1280x900):    16 nodes, {bgOverlap, pseudoContent} -- unaffected, unchanged
//   phoneNarrow (320x800): 67 nodes, {bgOverlap, pseudoContent, elmPartiallyObscured}
const COLOR_CONTRAST_INCOMPLETE_CEILING: Record<string, number> = {
  phone: 40,
  desktop: 16,
  phoneNarrow: 67,
};
const COLOR_CONTRAST_INCOMPLETE_REASONS = ["bgOverlap", "pseudoContent", "elmPartiallyObscured"];

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

        assertColorContrastIncompletePinned(
          incomplete,
          COLOR_CONTRAST_INCOMPLETE_CEILING[viewport.name],
          COLOR_CONTRAST_INCOMPLETE_REASONS,
        );
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

  // R1: "Panel size" -> "Panel position and size"; three buttons -> five (dock left/bottom/right,
  // maximize, collapse) -- see e2e/shell.a11y.spec.ts's identical fix for the real shell.
  test("every panel-size control group has an accessible name on each of its five buttons", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const group = page.locator("#panel [role='group'][aria-label='Panel position and size']");
    const names = await group
      .locator("button")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(names).toEqual([
      "Dock left",
      "Dock bottom",
      "Dock right",
      "Full screen",
      "Collapse to a pill",
    ]);
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

  test("Flower: the always-visible values table shows the SAME numbers as the petals' tooltips", async ({
    page,
  }) => {
    // atlas-4 fix round 3: the "Show table" toggle is gone -- the table is now always rendered
    // alongside the chart (owner: values "lined up in a table or bulleted list", not hidden behind
    // a click), so this no longer needs to open anything first.
    await gotoGallery(page, "navy");
    const flower = page.locator("#flower-eight");
    const petalLabels = await flower
      .locator(".petal")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    const rows = await flower.locator(".flower-table tbody tr:not(.mean-row)").evaluateAll((trs) =>
      trs.map((tr) => {
        // the swatch cell (first <td>) carries no text -- component name/score are cells 2 and 3.
        const cells = tr.querySelectorAll("td");
        return `${cells[1]?.textContent}: ${cells[2]?.textContent}`;
      }),
    );
    expect(rows).toEqual(petalLabels);
  });

  // W5 fix (Opus 5.5 eyes-on review 5, 2026-09-25, phone-06/07): "the capped phone flower narrows
  // its header column... 'Cell ID: ... (x: ..., y: ...)' wraps onto two lines and starts at x 220
  // instead of the sheet's gutter." Root cause: `.flower`'s own `max-width: var(--flower-size)`
  // used to cap the WHOLE figure (title + chart + table) at the flower's small compact size (170,
  // `FlowerPanel.svelte`'s `FLOWER_SIZE_HALF_DETENT`) -- the fix moves that cap to `.flower-body`
  // alone, so `.flower-title` spans the figure's own full, uncapped width. RED-FIRST: on the
  // pre-fix tree, `#flower-compact-cell-title .flower-title`'s own bounding box is <= 170px wide
  // (bytes wrapped inside the SAME narrow column the chart/table are capped at) -- this asserts it
  // is instead comfortably wider than that cap, proving the header is no longer sharing the
  // flower's own compact column.
  test("Flower: a compact (170px) flower's title spans the figure's full width, not the chart's own capped column", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const flower = page.locator("#flower-compact-cell-title");
    await expect(flower.locator(".flower-title")).toBeVisible();
    const titleBox = (await flower.locator(".flower-title").boundingBox())!;
    const svgBox = (await flower.locator(".flower-svg").boundingBox())!;
    // the compact flower's own chart is capped at 170px (`size={170}` on this fixture) -- the
    // title, once fixed, is the figure's own (much wider, unconstrained) box, not that cap.
    expect(
      titleBox.width,
      `title box only ${titleBox.width}px wide -- still capped to (or near) the flower's own ` +
        `170px compact size instead of the figure's full width`,
    ).toBeGreaterThan(svgBox.width + 40);
    // and it starts flush at the figure's own left edge (the row's gutter), not indented to sit
    // over a horizontally-centred narrow column the way a still-capped figure would be.
    const figureBox = (await flower.boundingBox())!;
    expect(
      Math.abs(titleBox.x - figureBox.x),
      `title left edge x=${titleBox.x} is not flush with the figure's own left edge x=${figureBox.x}`,
    ).toBeLessThanOrEqual(2);
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

  test("the enabled Flower rail button has no tooltip; the inactive one describes ITSELF, not another instance's", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    // R4 (docs/usability.md §7): RailButton.svelte only wires a tooltip for an INACTIVE control
    // (an active/enabled one shows its label as visible text instead -- no more hover-to-learn,
    // so there is nothing left for a tooltip to say). #rail's first toolbar (Scores lens) has the
    // ENABLED Flower button; its second toolbar (Species lens) has the INACTIVE one, with its own
    // per-instance tooltip id (`uid()`, same fix this test originally proved for the old
    // icon-only HexButton) -- so it must describe ITSELF ("...Scores only"), not collide with any
    // other instance's tooltip on the page.
    const enabledFlower = page
      .locator("#rail [role='toolbar']")
      .nth(0)
      .locator("button[aria-label='Flower plot']");
    await expect(enabledFlower).not.toHaveAttribute("aria-describedby", /.*/);

    const inactiveFlower = page
      .locator("#rail [role='toolbar']")
      .nth(1)
      .locator("button[aria-label='Flower plot']");
    const describedById = await inactiveFlower.getAttribute("aria-describedby");
    expect(describedById, "the inactive Flower button has no aria-describedby at all").toBeTruthy();
    const description = await page.locator(`#${describedById}`).textContent();
    expect(description).toContain("Scores only");
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
    // the real regression: focus starts on something INSIDE the body (the scrollable region
    // itself, tabindex=0) -- collapsing to peek hides that body via display:none, which is the
    // element that would strand focus if it were never moved. Focusing the collapse control
    // itself first would trivially "pass" without exercising the bug at all.
    await sheetSection.locator(".sheet-body").focus();
    await page.keyboard.press("Escape");
    await expect(collapseBtn).toBeFocused();
    const isBody = await page.evaluate(() => document.activeElement === document.body);
    expect(isBody).toBe(false);
  });
});

test.describe("fix round 1, item 8 (SC 1.4.10): no horizontal overflow at 320 CSS px", () => {
  // Targeted at the two components the manual review actually flagged (About.svelte's fixed
  // 372px, Panel.svelte's fixed --size-panel/380px -- "measured scrollWidth 430 > 320"), rather
  // than a page-wide sweep: a page-wide zero-tolerance check also catches OTHER, pre-existing,
  // unrelated reflow gaps this fix round never touched (e.g. a data table's own unbreakable-token
  // cells, which SC 1.4.10 explicitly exempts from 2D-scroll-free reflow in the first place) --
  // those are real findings for a future pass, not something to half-fix under this one's scope.
  test("About and Panel each fit within a 320px viewport instead of forcing it wider", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await gotoGallery(page, "navy");
    // the INNER component's own box, not the outer gallery-section: a plain block ancestor with
    // `width: auto` sizes itself to the containing block regardless of its content, so a fixed-
    // width child overflowing it (ordinary `overflow: visible`) would never show up on the
    // section's own boundingBox -- only on the fixed-width element itself.
    for (const [sectionId, innerSelector] of [
      ["#about", ".about"],
      ["#panel", ".panel"],
    ] as const) {
      const box = await page.locator(sectionId).locator(innerSelector).first().boundingBox();
      expect(box, innerSelector).not.toBeNull();
      expect(box!.width, `${innerSelector} width`).toBeLessThanOrEqual(320);
    }
  });
});

test.describe("atlas-8 fix: the Categories demo table no longer overflows the PAGE at 320 CSS px", () => {
  // the deferred case item 8's own comment named: a data table's unbreakable-token cells are
  // exempt from SC 1.4.10's no-2D-scroll rule (the table itself may scroll), but the table must
  // not force the PAGE to scroll horizontally -- that check (unlike item 8's, which measures a
  // fixed-width inner element) is the whole-document one.
  test("#categories .cat-table-scroll contains the overflow; <html> does not scroll horizontally", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await gotoGallery(page, "navy");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, "the whole page must not overflow horizontally at 320 CSS px").toBe(false);
    await expect(page.locator("#categories .cat-table-scroll")).toBeVisible();
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

// atlas-8 fix: item 13 above only measured the WRAPPING `.filter-field` label -- the raw <input>
// inside it (the actual visible, tappable text field) stayed ~27x28px, its own intrinsic size.
// spec.md §11 (distinct from SC 2.5.8, which is satisfied by the label's hit area alone) asks for
// the input itself to read as 44 CSS px tall on a coarse pointer.
test.describe("atlas-8 fix: DataTable's filter INPUT itself reaches 44 CSS px tall on a coarse pointer", () => {
  test.use({ hasTouch: true });

  test("#data-table .filter-field input", async ({ page }) => {
    await gotoGallery(page, "navy");
    const input = page.locator("#data-table .filter-field input").first();
    await expect(input).toBeVisible();
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height, "filter input height").toBeGreaterThanOrEqual(44);
  });
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
  test("Panel's body has tabindex=0, and is NOT a second nested landmark (atlas-8 fix)", async ({
    page,
  }) => {
    await gotoGallery(page, "navy");
    const body = page.locator("#panel .panel-body");
    await expect(body).toHaveAttribute("tabindex", "0");
    // atlas-8 fix: this used to ALSO carry role="region" -- a second landmark nested directly
    // inside the panel's own <section aria-labelledby>, which is already ONE region (named by its
    // <h2>). tests/ui/panelLandmarks.test.ts is the source-level twin of this assertion.
    await expect(body).not.toHaveAttribute("role", "region");
    await expect(page.locator("#panel .panel-surface")).toHaveAttribute("aria-labelledby", /.+/);
    // fix list #7 (SC 4.1.2): that atlas-8 fix dropped the NAME along with the landmark --
    // `tabindex="0"` with no role and no accessible name, a stop a screen reader announced as
    // nothing (e2e/keyboard-walk.spec.ts's finding A11Y-7). `role="group"` (never a landmark)
    // restores the name without reintroducing the region. REVERTED (this fix alone) -> RED: no
    // role, no aria-label, no computed accessible name.
    await expect(body).toHaveAttribute("role", "group");
    expect(await body.getAttribute("aria-label")).toBe("Layers details");
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
