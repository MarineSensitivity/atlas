// atlas-4 fix round 2 -- the dedicated e2e gate for the owner-reported live defect (2026-09-24,
// "Flower plot, nothing selected"): v7's default flower listed EIGHT components under a centre of
// 24 but drew only ~3-4 visible petals. Root cause (see `src/lib/ui/flowerGeometry.ts`'s header):
// every petal was a full pie slice from the true centre, and the hub disc (radius 24 of the
// default 100-unit outerRadius) was drawn ON TOP of it -- any component scoring <= 24 (Coral
// 10.45, Fish 15.96, Invertebrate 14.73, Other 15.18, Primary producer 10.38 in the reported case)
// produced a slice that fit entirely inside the hub and was completely covered by it. This was
// never a missing color: every one of the eight real categories already had a defined, distinct
// `--cat-*` token (tokens.css) -- the OLD gate for this
// (`e2e/gallery.spec.ts`, "#flower-eight has exactly 8 distinct petal categories (colors)") read
// `getComputedStyle(el).fill` on each `<path>` DIRECTLY, which is true and defined for a COVERED
// petal exactly as it is for a visible one -- "a check that cannot fail is not a check" (CLAUDE.md).
// It stays in the suite (still a true assertion), but this file is the evidence `status.mjs`'s
// S-13/S-14 now cite: it additionally proves each petal is the TOPMOST, VISIBLE thing at its own
// on-screen centroid, via `document.elementFromPoint()` -- real browser hit-testing that accounts
// for z-order/occlusion the way a computed-style read never can.
//
// RED-FIRST (recorded before the fix landed, `flowerGeometry.ts`'s pre-fix pie-slice-under-a-hub
// geometry): of v7's 8 real components, only Bird (45.67), Mammal (41.67) and Turtle (38.82) --
// the three scoring ABOVE the hub's radius 24 -- passed the centroid hit-test; Coral, Fish,
// Invertebrate, Other and Primary producer (all <= 24) failed it, `document.elementFromPoint` at
// their own centroid returning the hub `<circle class="hub">`, not their own `<path>`.
import { expect, test, type Page } from "@playwright/test";
import { gotoScoresMap } from "./scores-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

async function openFlower(page: Page) {
  await page.getByRole("button", { name: "Flower plot" }).click();
  const flower = page.locator(".flower-title");
  await expect(flower).toBeVisible({ timeout: 10_000 });
  return flower;
}

/** Table tool -> Zones sub-tab -> click the named zone's row link -- exactly what clicking that
 * zone's polygon on the map would do (`ZonesTable.svelte`'s own header comment): sets the shared
 * `sel` state to `zone:<unit>:<key>`, which `FlowerPanel.svelte` reads the same way regardless of
 * which rail tool is open. Switches back to the Flower tool afterwards so the caller lands on the
 * panel this file actually asserts against. */
async function selectZoneViaTable(page: Page, zoneName: string) {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Zones", exact: true }).click();
  await page.getByRole("button", { name: zoneName, exact: true }).click();
  await openFlower(page);
}

interface PetalProbe {
  label: string | null;
  /** true when `document.elementFromPoint` at this petal's own geometric centroid returns THIS
   * petal (or a descendant of it) -- i.e. the petal is the topmost, visibly-painted thing at a
   * pixel that is genuinely inside its own colored band, not merely "present in the DOM with a
   * fill declared". */
  isTopmostAtOwnCentroid: boolean;
  /** what WAS topmost there, when it was not the petal itself (e.g. "circle.hub") -- surfaced so a
   * failure names exactly which petal was covered and by what, mirroring the RED-FIRST run this
   * file's header records. */
  coveredBy: string | null;
  fill: string;
}

/** every `.petal` in the currently-shown flower SVG, probed via the SAME geometry it was drawn
 * from (`data-cx`/`data-cy`, Flower.svelte's own `petalCentroid()` output) converted to a real
 * screen point with the browser's own `getScreenCTM()` -- correct regardless of the SVG's
 * viewBox-to-CSS-pixel scale, unlike a hand-computed offset would be. */
async function probePetals(page: Page): Promise<PetalProbe[]> {
  return page.locator(".flower-svg .petal").evaluateAll((els) =>
    els.map((raw) => {
      const el = raw as SVGPathElement;
      const svg = el.ownerSVGElement!;
      const pt = svg.createSVGPoint();
      pt.x = Number(el.dataset.cx);
      pt.y = Number(el.dataset.cy);
      const ctm = el.getScreenCTM();
      const screenPt = ctm ? pt.matrixTransform(ctm) : pt;
      const top = document.elementFromPoint(screenPt.x, screenPt.y);
      const isTopmostAtOwnCentroid = top === el || (!!top && el.contains(top));
      const describeTop = (node: Element | null): string | null => {
        if (!node) return null;
        const cls = node.classList.length ? `.${Array.from(node.classList).join(".")}` : "";
        return `${node.tagName.toLowerCase()}${cls}`;
      };
      return {
        label: el.getAttribute("aria-label"),
        isTopmostAtOwnCentroid,
        coveredBy: isTopmostAtOwnCentroid ? null : describeTop(top),
        fill: getComputedStyle(el).fill,
      };
    }),
  );
}

/** every panel-background / hub color this theme ships, resolved once per page so the "not the
 * panel background colour" assertion is a real comparison, not a guess at a literal hex. */
async function backgroundish(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    document.body.appendChild(probe);
    const resolve = (varName: string) => {
      probe.style.color = `var(${varName})`;
      return getComputedStyle(probe).color;
    };
    const out = [resolve("--surface-panel"), resolve("--surface-raised"), resolve("--cat-nodata")];
    probe.remove();
    return out;
  });
}

function assertEveryPetalVisible(petals: PetalProbe[], expectedCount: number, bg: string[]) {
  expect(petals, "petal count must equal the number of real components").toHaveLength(
    expectedCount,
  );
  const covered = petals.filter((p) => !p.isTopmostAtOwnCentroid);
  expect(
    covered,
    `${covered.length}/${petals.length} petal(s) covered at their own centroid: ` +
      covered.map((p) => `${p.label} by ${p.coveredBy}`).join("; "),
  ).toEqual([]);
  for (const p of petals) {
    expect(p.fill, `${p.label}'s fill must be a real color, not "none"/transparent`).not.toBe(
      "none",
    );
    expect(bg, `${p.label}'s fill (${p.fill}) must not be a panel-background colour`).not.toContain(
      p.fill,
    );
  }
}

/** no number anywhere in the panel's text carries more than one decimal place -- the OTHER half of
 * the reported defect ("the values text under the flower prints full double precision"). Matches
 * `45.6671707107685` but not `45.7` or a bare `24`. */
function assertOneDecimalOnly(text: string) {
  const tooPrecise = text.match(/\d+\.\d{2,}/g);
  expect(tooPrecise, `panel text has a number with more than 1 decimal: ${text}`).toBeNull();
}

for (const ver of ["v7", "v9"] as const) {
  test.describe(`scores lens flower plot — every real component draws a visible petal (${ver})`, () => {
    test("nothing selected: the default flower", async ({ page }) => {
      await gotoScoresMap(page, ver);
      await openFlower(page);

      const bg = await backgroundish(page);
      const petals = await probePetals(page);
      // v7's real flower_default.FULL has all 8 real categories, no collision; v9's real
      // flower_default.AK de-duplicates 8 raw rows (both "primprod" spellings) down to 7 drawn
      // petals -- both numbers asserted end-to-end here, not just at the unit level.
      assertEveryPetalVisible(petals, ver === "v7" ? 8 : 7, bg);

      const panelText = await page.locator(".flower-panel").innerText();
      assertOneDecimalOnly(panelText);
    });
  });
}

test.describe("scores lens flower plot — a SELECTED zone's own flower (v7, GAA)", () => {
  test("every one of GAA's real 8 components draws a visible petal", async ({ page }) => {
    await gotoScoresMap(page, "v7");
    await selectZoneViaTable(page, "GAA");
    await expect(page.locator(".flower-title")).toHaveText("GAA", { timeout: 10_000 });

    const bg = await backgroundish(page);
    const petals = await probePetals(page);
    assertEveryPetalVisible(petals, 8, bg);

    const panelText = await page.locator(".flower-panel").innerText();
    assertOneDecimalOnly(panelText);
  });
});

// the seeded-fault gate this spec IS (`scripts/test-faults.mjs`'s `flower-petal-colour-dropped`,
// PW_PORT 4393): `tests/faults/flower-petal-colour-dropped.patch` drops categories.ts's
// `other: "other"` SYNONYMS row, which makes `categoryFor("other")` fall back to
// `NO_DATA_CATEGORY` (the grey "not reportable" token, label "No data") -- this test names that
// failure mode directly rather than relying on the geometry probe above to catch it incidentally.
test.describe("scores lens flower plot — every real category label, never a silent 'No data' fallback", () => {
  test("v7's default flower: no petal's accessible name reads 'No data' for a real component", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await openFlower(page);
    const labels = await page
      .locator(".flower-svg .petal")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(labels).toHaveLength(8);
    for (const label of labels) {
      expect(label, `a real component's category fell back to "No data": ${label}`).not.toMatch(
        /^No data:/,
      );
    }
  });
});
