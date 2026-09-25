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
import { gotoScoresMap, bootFor, routeZones20 } from "./scores-hermetic";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";

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
 * panel this file actually asserts against.
 *
 * V4 fix (CI run 36049515023, "V1's names table"): the row's own accessible name is now
 * "Full Name (KEY)" (`paLabel()`, `zonesTable.ts`), not the bare key -- matches by KEY (the
 * "(KEY)" suffix, anchored to the end) so this keeps working regardless of whether/what full name
 * is attached to it. */
async function selectZoneViaTable(page: Page, zoneKey: string) {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Zones", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`\\(${zoneKey}\\)$`) }).click();
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
    // V4 fix (CI run 36049515023): the flower title now goes through `paLabel()` too (docs
    // fact-check item 3, FlowerPanel.svelte's own `zoneName()`) -- "GOA Program Area A (GAA)", not
    // the bare key. Matches by the "(KEY)" suffix, same reasoning as `selectZoneViaTable` above.
    await expect(page.locator(".flower-title")).toContainText("(GAA)", { timeout: 10_000 });

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

// atlas-4 fix round 3 (owner, phone/dark theme/Scores lens/Flower plot tool, cell 3092526,
// 2026-09-24): "The flower plot should be centered", a stray focus rectangle around the last-
// tapped petal, no petal values on tap/hover, and the values under the plot in a prose paragraph
// instead of a list/table.
test.describe("fix round 3: the flower is centred in its panel (phone, 390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test("the flower SVG's bounding-box centre is within 2px of its panel's centre, at half and full sheet detent", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await openFlower(page);

    for (const detentLabel of ["Half height", "Full height"]) {
      await page.getByRole("button", { name: detentLabel }).click();
      const svgBox = await page.locator(".flower-svg").boundingBox();
      const panelBox = await page.locator(".flower-panel").boundingBox();
      expect(svgBox, `detent "${detentLabel}": .flower-svg has no bounding box`).not.toBeNull();
      expect(panelBox, `detent "${detentLabel}": .flower-panel has no bounding box`).not.toBeNull();
      const svgCentre = svgBox!.x + svgBox!.width / 2;
      const panelCentre = panelBox!.x + panelBox!.width / 2;
      expect(
        Math.abs(svgCentre - panelCentre),
        `detent "${detentLabel}": svg centre ${svgCentre.toFixed(1)}px vs panel centre ` +
          `${panelCentre.toFixed(1)}px (svg box ${JSON.stringify(svgBox)}, panel box ${JSON.stringify(panelBox)})`,
      ).toBeLessThanOrEqual(2);
    }
  });
});

test.describe("fix round 3: no stray UA outline rectangle -- a purpose-drawn indicator follows the petal's own shape", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("after clicking a petal: every element in the flower computes outline-style 'none', and the .active indicator is present", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await openFlower(page);

    const petal = page.locator(".flower-svg .petal").first();
    await petal.click();
    await expect(petal).toBeFocused();
    await expect(
      petal,
      "the custom selection indicator (a purpose-drawn class) is missing",
    ).toHaveClass(/\bactive\b/);

    // the seeded-fault case this closes: `outline` on an SVG <path> always paints the element's
    // BOUNDING BOX, not its actual annular-sector shape -- "a solid blue rectangle" around the
    // last-tapped petal. Checked across every element in the figure, not just the focused one, so
    // a stray outline on an ancestor/sibling cannot hide behind a narrower assertion.
    const outlineStyles = await page
      .locator(".flower, .flower *")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).outlineStyle));
    expect(
      outlineStyles.every((s) => s === "none"),
      `outline-styles seen in the flower: ${JSON.stringify(outlineStyles)}`,
    ).toBe(true);

    // the REPLACEMENT indicator: a thicker stroke, which (unlike `outline`) follows the path's own
    // geometry rather than its bounding box.
    const strokeWidth = await petal.evaluate((el) => getComputedStyle(el).strokeWidth);
    expect(strokeWidth, "the active petal's stroke must visibly thicken").toBe("3px");
  });
});

test.describe("fix round 3: tapping a petal shows its name and score (phone, 390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test("tap shows a label with the SAME text as the petal's accessible name, one decimal only; tapping elsewhere dismisses it", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await openFlower(page);

    const petal = page.locator(".flower-svg .petal").first();
    const expectedLabel = await petal.getAttribute("aria-label");
    expect(expectedLabel).toMatch(/^.+: \d+\.\d$/); // "Bird: 56.8" -- one decimal, never a raw double

    const label = page.locator(".petal-label");
    await expect(label).toHaveCount(0);
    await petal.click();
    await expect(label).toBeVisible();
    await expect(label).toHaveText(expectedLabel!);

    // "tapping elsewhere ... dismisses" -- a tap on a non-petal part of the figure.
    await page.locator(".flower-title").click();
    await expect(label).toHaveCount(0);

    // "tapping ... again dismisses" -- the persistent (pinned) selection itself is cleared, i.e.
    // the purpose-drawn .active indicator comes off; asserted on the indicator rather than the
    // label's visibility, which (correctly) can also keep showing via hover on a real mouse still
    // resting over the shape -- fix round 3's own header note on desktop hover being a separate,
    // transient signal from a tap/click selection.
    await petal.click();
    await expect(petal).toHaveClass(/\bactive\b/);
    await petal.click();
    await expect(petal).not.toHaveClass(/\bactive\b/);
  });
});

test.describe("fix round 3: hovering a petal shows its name and score (desktop, 1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("hover reveals the same label a tap would, with no click, and clears when the pointer leaves", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await openFlower(page);

    const petal = page.locator(".flower-svg .petal").nth(1);
    const expectedLabel = await petal.getAttribute("aria-label");
    const label = page.locator(".petal-label");

    await expect(label).toHaveCount(0);
    await petal.hover();
    await expect(label).toBeVisible();
    await expect(label).toHaveText(expectedLabel!);

    await page.locator(".flower-title").hover();
    await expect(label).toHaveCount(0);
  });
});

test.describe("fix round 3: the values under the plot are a table, not a prose paragraph", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("one visible table row per component (plus the composite), and the duplicate prose header is screen-reader only", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await openFlower(page);

    const table = page.locator(".flower-table");
    await expect(table).toBeVisible();
    const petalCount = await page.locator(".flower-svg .petal").count();
    await expect(table.locator("tbody tr:not(.mean-row)")).toHaveCount(petalCount);
    await expect(table.locator("tbody tr.mean-row")).toHaveCount(1);
    // every data row carries a colour swatch alongside the component name and score.
    await expect(table.locator("tbody tr:not(.mean-row) .swatch")).toHaveCount(petalCount);

    // the owner's "x/y header duplicates the line already shown above 'Show table'": the
    // figcaption states the cell/zone/study-area title once, visibly; the prose sentence that used
    // to repeat it (and the table's own caption, which repeats it again) are screen-reader only,
    // never a second on-screen copy of the same line.
    await expect(page.locator(".flower-title")).toBeVisible();
    await expect(page.locator(".summary")).toHaveClass(/\bsr-only\b/);
    await expect(table.locator("caption")).toHaveClass(/\bsr-only\b/);
  });
});

// P round deliverable 2 (Ben, live-review of 0.10.62, 2026-09-24): "Flower plot should be bigger
// and needs a reference outer circle ... based on the maximum component score for given version
// ... stated with a small label", plus "use the panel's free area". The pure geometry (ring
// radius/value/label) is unit-tested in tests/ui/flowerGeometry.test.ts and
// tests/lens/scores/boot.test.ts; this proves the REAL rendered SVG/DOM.
test.describe("P round deliverable 2: the flower's reference ring", () => {
  test("v7's real fixture publishes no component rescale today: the ring falls back to 100 and says so", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await openFlower(page);

    const ring = page.locator("[data-testid='flower-reference-ring']");
    await expect(ring).toBeAttached();
    await expect(ring).toHaveAttribute("data-ring-value", "100");
    await expect(page.locator(".ring-label")).toHaveText(
      "max 100 (no published maximum for this release)",
    );
  });

  /** `bootFor('v7')` (scores-hermetic.ts) publishes only the COMPOSITE layer's `by_subregion` --
   * adds one `category: "component"` row with a real rescale, the same "extend with one more
   * layer" pattern `e2e/layers.spec.ts`'s own `bootWithPrimprod` uses, so v7's shared fixture
   * itself never changes for every OTHER spec in this file. */
  function bootWithComponentMax(maxScore: number) {
    const boot = bootFor("v7") as { layers: unknown[] };
    return {
      ...boot,
      layers: [
        ...boot.layers,
        {
          metric_key: "extrisk_bird_ecoregion_rescaled",
          category: "component",
          order: 2,
          by_subregion: { FULL: { rescale: [0, maxScore] } },
        },
      ],
    };
  }

  async function gotoScoresFlowerWithMax(page: Page, maxScore: number) {
    await blockWasm(page);
    await routeBucket(page, "v7", bootWithComponentMax(maxScore));
    await routeSession(page, { preview: true, ver: "v7" });
    await routeSealFixture(page);
    await routeZones20(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    await page.goto("/?proj=mercator");
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  }

  test("a release that DOES publish a component rescale (93): the ring moves off the fallback, no petal draws past it -- the seeded fault: pinned at 100 regardless", async ({
    page,
  }) => {
    await gotoScoresFlowerWithMax(page, 93);
    await openFlower(page);

    const ring = page.locator("[data-testid='flower-reference-ring']");
    await expect(ring).toHaveAttribute("data-ring-value", "93");
    await expect(page.locator(".ring-label")).toHaveText("max 93");

    const ringRadius = await ring.evaluate((el) => Number(el.getAttribute("r")));
    expect(
      ringRadius,
      "a real 93 max must draw the ring strictly inside the 100-unit outer edge",
    ).toBeLessThan(100);

    // "petals must not exceed the ring": v7's real flower_default.FULL (FLOWER_DEFAULT_V7_FULL,
    // this file's own header) tops out at Bird 45.67 -- every petal's own outer radius must sit at
    // or inside the ring's.
    const petalRadii = await page.locator(".flower-svg .petal").evaluateAll((els) =>
      els.map((el) => {
        const d = el.getAttribute("d") ?? "";
        // the annular sector's OUTER arc radius is sectorPath's own `radius` argument, encoded as
        // the "A rx ry ..." command's rx -- parsed here rather than re-deriving it from the
        // component score, so this is a proof against the real rendered path, not a second copy
        // of the same math the fault would ALSO get wrong.
        const m = /A\s*([\d.]+)/.exec(d);
        return m ? Number(m[1]) : NaN;
      }),
    );
    for (const r of petalRadii) expect(r).toBeLessThanOrEqual(ringRadius + 0.01); // float tolerance
  });
});

// P round deliverable 2: "Flower plot should be bigger... use the panel's free area" -- was stuck
// at ~105-130px on a 1280px stage regardless of how much panel room existed (a `width`/`height`
// HTML attribute pinning the rendered size to a literal px value); now grows with its container.
test.describe("P round deliverable 2: the flower grows to fill its panel (desktop, 1280x800)", () => {
  test("renders well past the OLD fixed 220px default", async ({ page }) => {
    await gotoScoresMap(page, "v7");
    await openFlower(page);
    const svgBox = await page.locator(".flower-svg").boundingBox();
    expect(svgBox, ".flower-svg has no bounding box").not.toBeNull();
    expect(
      svgBox!.width,
      `flower rendered at ${svgBox!.width}px -- expected it to grow well past the reported ` +
        `"~105-130px on a 1280px stage"`,
    ).toBeGreaterThan(260);
  });
});

test.describe("P round deliverable 2: the flower grows to fill its panel (phone, 390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test("at both Half and Full sheet height, the flower is well past the reported ~105-130px", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    await openFlower(page);
    for (const detentLabel of ["Half height", "Full height"]) {
      await page.getByRole("button", { name: detentLabel }).click();
      const svgBox = await page.locator(".flower-svg").boundingBox();
      expect(svgBox, `detent "${detentLabel}": .flower-svg has no bounding box`).not.toBeNull();
      expect(
        svgBox!.width,
        `detent "${detentLabel}": flower rendered at ${svgBox!.width}px`,
      ).toBeGreaterThan(200);
    }
  });
});
