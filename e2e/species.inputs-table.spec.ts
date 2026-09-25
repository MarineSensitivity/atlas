// owner review item 7 (Ben, live 0.10.62): "the Table tool in the SPECIES lens shows the
// placeholder 'The species and zone tables arrive in a later phase.'" -- replaced with the
// selected model's own inputs (SpeciesInputsTable.svelte, reshaping the SAME `LayerBar` the layer
// bar already computes; tests/lens/species/inputsTable.test.ts covers the pure reshape). RED-FIRST:
// fails on the pre-fix tree (the placeholder text, never a table).
import { expect, test } from "@playwright/test";
import { LEATHERBACK_SP, gotoSpecies } from "./species-hermetic";

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("owner review item 7: the species lens' Table tool shows the selected model's real inputs", () => {
  test("a real table replaces the placeholder, with Input/Dataset/Representation/Availability columns", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);

    await page.locator("#rail-region button[aria-label='Table']").click();

    const table = page.locator('[data-testid="species-inputs-table"] table');
    await expect(table).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("arrive in a later phase")).toHaveCount(0);

    const headers = table.locator("thead th");
    await expect(headers).toHaveCount(4);
    await expect(headers).toHaveText(["Input", "Dataset", "Representation", "Availability"]);

    // the merged model is always the first row (layerBar.ts's own pill order) and always has a
    // published surface for a real taxon card.
    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow).toContainText("Available");
    await expect(table.locator("tbody tr")).not.toHaveCount(0);
  });

  test("a species with an unpublished input shows it struck through, with its own reason", async ({
    page,
  }) => {
    // the walrus v7 fixture (tests/lens/species/fixtures.ts's own CARDS.walrusV7, mirrored in the
    // v7 shard fixture routed by species-hermetic.ts) has an am_0.05 input with no registered
    // raster -- the SAME struck-through state the layer bar's own pill shows.
    await gotoSpecies(page, "/?mdl_seq=54383&ver=v7", "v7");

    await page.locator("#rail-region button[aria-label='Table']").click();
    const table = page.locator('[data-testid="species-inputs-table"] table');
    await expect(table).toBeVisible({ timeout: 10_000 });

    const unavailable = table.locator("tbody .unavailable");
    await expect(unavailable.first()).toBeVisible();
    await expect(unavailable.first()).toHaveText("Not available");
    await expect(unavailable.first()).toHaveAttribute("title", /no raster registered/);
  });
});

// the "no bar at all" empty-state branch (brief's own rule: "if a model has no inputs, say so
// plainly") is real component logic (SpeciesInputsTable.svelte's `{:else if !bar || rows.length
// === 0}`), but the LIVE species lens always resolves a default species once mounted -- there is
// no real navigation that leaves it permanently unselected for this e2e layer to drive at. The
// pure reshape it depends on is proven directly instead:
// tests/lens/species/inputsTable.test.ts's "is [] for no bar at all".
