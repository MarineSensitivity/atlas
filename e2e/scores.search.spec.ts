// Q1 (atlas-8 P-round, owner-reported defect, live 0.10.50, 390px phone/v7): "the top-bar search
// box does nothing in the Scores lens; it only searches species, in the Species lens" (the docs
// chapter's own known-limitation text). `ScoresLens.svelte`'s stub `<input>` is replaced by
// `ScoresSearch.svelte`/`search.ts` -- offline matching against the release's own published zones
// (Program Areas) and typed "lon, lat" coordinates, no third-party geocoder.
//
// RED-FIRST: this spec fails on the pre-fix tree (no `role="combobox"` named "Search Program Areas
// or coordinates" exists in the Scores lens -- the field was a plain unlabeled stub `<input>`).
import { expect, test, type Page } from "@playwright/test";
import { waitForHydration, routeBucket, routeSealFixture, routeSession } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { FLOWER_ZONE_METRICS_GAA, bootFor, routeZones20 } from "./scores-hermetic";

test.describe.configure({ mode: "serial" });

interface BootProgramAreaZone {
  key: string;
  name: string;
  n_taxa: number;
  metrics: Record<string, number>;
}

/** `bootFor("v9")` (scores-hermetic.ts), with ALA given a real display name -- every other key in
 * that fixture keeps `name: key` (its own convention), which is enough to prove KEY matching but
 * not NAME matching -- plus the SAME real 8-component metrics `bootFor("v7")` already gives GAA
 * (`FLOWER_ZONE_METRICS_GAA`), so selecting it actually has a flower to show (a bare composite
 * value alone, this fixture's default for every OTHER zone, draws no petals at all --
 * `flower.ts#fromMetrics` only picks up `*_ecoregion_rescaled` keys). Mutating a fresh `bootFor()`
 * call in place is safe: it builds a brand new object (and a brand new `.map()`'d array) on every
 * call, never a shared literal. */
function bootWithAleutianArc(): object {
  const boot = bootFor("v9") as { zones: { programarea: BootProgramAreaZone[] } };
  boot.zones.programarea = boot.zones.programarea.map((z) =>
    z.key === "ALA"
      ? { ...z, name: "Aleutian Arc", metrics: { ...z.metrics, ...FLOWER_ZONE_METRICS_GAA } }
      : z,
  );
  return boot;
}

async function gotoScoresSearch(page: Page): Promise<void> {
  await blockWasm(page);
  await routeBucket(page, "v9", bootWithAleutianArc());
  // v9 is `restricted` in the versions fixture (matching the live registry) -- a preview session
  // is the honest way to view it, same as `scores-hermetic.ts#gotoScoresMap`'s own reason.
  await routeSession(page, { preview: true, ver: "v9" });
  await routeSealFixture(page);
  await routeZones20(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto("/?proj=mercator");
  await waitForHydration(page);
}

function urlSel(page: Page): string | null {
  return new URL(page.url()).searchParams.get("sel");
}

async function openFlower(page: Page) {
  await page.getByRole("button", { name: "Flower plot" }).click();
  const flower = page.locator(".flower-title");
  await expect(flower).toBeVisible({ timeout: 10_000 });
  return flower;
}

test.describe("Q1: Scores-lens top-bar search (desktop, 1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("typing 'ALA' lists the Aleutian Arc; Enter selects it -- URL carries the zone selection, the Flower tool shows its composite", async ({
    page,
  }) => {
    await gotoScoresSearch(page);

    const input = page.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("ALA");

    const option = page.getByRole("option", { name: "Aleutian Arc (ALA)" });
    await expect(option).toBeVisible();

    await input.press("Enter");

    await expect.poll(() => urlSel(page)).toBe("zone:programarea:ALA");
    expect(new URL(page.url()).searchParams.get("unit")).toBe("programarea");

    // the dropdown closed and the field cleared on selection (SpeciesPicker's own convention).
    await expect(page.getByRole("listbox", { name: "Search results" })).toBeHidden();
    await expect(input).toHaveValue("");

    const title = await openFlower(page);
    // V4 fix (CI run 36049515023, docs fact-check item 3): the flower title now goes through
    // `paLabel()` too (FlowerPanel.svelte's own `zoneName()`) -- "Aleutian Arc (ALA)", the same
    // "Full Name (KEY)" label the search result option above already shows, not the bare name.
    await expect(title).toHaveText("Aleutian Arc (ALA)");
    // "shows its composite": a real flower, not the empty "click a scored cell" state -- ALA's
    // own `zones.programarea` row carries the full 8-component fixture (`FLOWER_ZONE_METRICS_GAA`'s
    // shape is NOT what ALA carries here; this asserts the mechanism -- petals render at all --
    // which is what proves the SELECTION actually reached the flower, not specific numbers).
    await expect(page.locator(".flower-svg .petal").first()).toBeVisible();
  });

  test("typing '-140, 57' selects a cell -- URL carries sel=cell:", async ({ page }) => {
    await gotoScoresSearch(page);

    const input = page.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("-140, 57");

    const option = page.getByRole("option", { name: "Fly to lon -140.00, lat 57.00" });
    await expect(option).toBeVisible();

    await input.press("Enter");

    await expect.poll(() => urlSel(page)).toMatch(/^cell:\d+$/);
  });

  test("Esc closes the results list", async ({ page }) => {
    await gotoScoresSearch(page);

    const input = page.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("ALA");
    await expect(page.getByRole("option", { name: "Aleutian Arc (ALA)" })).toBeVisible();

    await input.press("Escape");
    await expect(page.getByRole("listbox", { name: "Search results" })).toBeHidden();
    // Esc closes the results only -- it never clears what was typed or writes a selection.
    await expect(input).toHaveValue("ALA");
    expect(urlSel(page)).toBeNull();
  });

  test("a query that matches nothing shows 'No matches', and never writes a selection", async ({
    page,
  }) => {
    await gotoScoresSearch(page);

    const input = page.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("zzz-nonexistent-place-zzz");
    await expect(page.getByText("No matches")).toBeVisible();

    await input.press("Enter");
    expect(urlSel(page)).toBeNull();
  });
});

test.describe("Q1: Scores-lens top-bar search (phone, 390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the phone search modal hosts the SAME search, and selecting a Program Area closes it", async ({
    page,
  }) => {
    await gotoScoresSearch(page);

    await page.getByRole("button", { name: "Search species and places" }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();

    const input = dialog.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await expect(input).toBeFocused();
    await input.fill("ALA");

    const option = dialog.getByRole("option", { name: "Aleutian Arc (ALA)" });
    await expect(option).toBeVisible();
    await option.click();

    await expect(dialog).not.toBeVisible();
    await expect.poll(() => urlSel(page)).toBe("zone:programarea:ALA");
  });

  // eyes-on evidence (a real screenshot, not an assumption) caught this: `.scores-search` was
  // `display: flex` with no `flex-direction`, so `.search-field-phone--scores`'s own `position:
  // static` override (shell.css, the SAME fix P1 made for SpeciesPicker's dropdown) turned the
  // results list into a ROW-flex sibling of the input instead of stacking it below -- it rendered
  // as a narrow column to the input's RIGHT, half outside the dialog. RED-FIRST: fails without
  // `flex-direction: column` on `.scores-search`.
  test("the results list renders BELOW the input, inside the dialog -- not beside it", async ({
    page,
  }) => {
    await gotoScoresSearch(page);

    await page.getByRole("button", { name: "Search species and places" }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();

    const input = dialog.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await input.fill("ALA");
    const option = dialog.getByRole("option", { name: "Aleutian Arc (ALA)" });
    await expect(option).toBeVisible();

    const dialogBox = (await dialog.boundingBox())!;
    const inputBox = (await input.boundingBox())!;
    const listBox = (await dialog.getByRole("listbox", { name: "Search results" }).boundingBox())!;

    // below the input, not beside it (the actual defect: the list rendered to the input's right).
    expect(
      listBox.y,
      "results list starts above the input's own bottom edge",
    ).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 0.5);
    // fully inside the dialog on every edge (P5's own species-lens assertion, generalized).
    expect(listBox.x).toBeGreaterThanOrEqual(dialogBox.x - 0.5);
    expect(listBox.y).toBeGreaterThanOrEqual(dialogBox.y - 0.5);
    expect(listBox.x + listBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 0.5);
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 0.5);
  });
});
