// atlas-8 phase review (M7/G-24, docs/parity.html): the zones table's score column used to be
// headed by the metric's whole published `label` -- on a real release that is a sentence
// ("Combined score of extinction risk per species category and primary productivity, equally
// weighted (and each previously rescaled [0,100] based on Ecoregional min/max values)"), which
// wrapped to one word per line and pushed every data row out of view
// (`src/lens/scores/ZonesTable.svelte`). Fix: a short, fixed header text ("Score") with the full
// label available as a hover `title` and to assistive tech via visually-hidden text, so the
// accessible name still disambiguates which metric is ranked.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import {
  BOOT_FIXTURE,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
  routeZonesPmtiles,
} from "./map-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

// the exact shape of a real published label (parity page G-24's own quote) -- long enough that the
// OLD behaviour (the full label as the header's only text) visibly breaks the layout.
const LONG_LABEL =
  "Combined score of extinction risk per species category and primary productivity, equally weighted (and each previously rescaled [0,100] based on Ecoregional min/max values)";

function bootFixture() {
  return {
    ...BOOT_FIXTURE,
    layers: [{ metric_key: "score", label: LONG_LABEL, category: "composite", order: 1 }],
    zones: {
      ...BOOT_FIXTURE.zones,
      programarea: BOOT_FIXTURE.zones.programarea.map((z, i) => ({
        ...z,
        metrics: { score: 10 + i },
      })),
    },
  };
}

async function gotoZonesTable(page: Page) {
  await blockWasm(page);
  await routeBucket(page, "v7", bootFixture());
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZonesPmtiles(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto("/?unit=programarea&proj=mercator&lyr=score");
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Zones", exact: true }).click();
}

test.describe("scores lens — zones table score column header (G-24)", () => {
  // no collectConsoleErrors()/zero-console-errors assertion here (unlike scores.outlines.spec.ts,
  // which this file otherwise mirrors): opening the Table tool also mounts TablePanel's OWN
  // species/composition loader (`reload()`'s `$effect`, unconditional on which sub-tab is
  // showing), which tries to boot the real engine this fixture deliberately blocks
  // (`blockWasm()`) -- caught by TablePanel's own try/catch (species/compositionRows -> null on
  // every engine), but on firefox specifically the underlying blocked fetch ALSO reaches the
  // page's console as "NetworkError when attempting to fetch resource", independent of the
  // caught rejection. That noise is a property of the Table tool's species tab, not of the
  // header fix this test asserts -- nothing here is about G-24.
  test("shows a short header, not the whole published label", async ({ page }) => {
    await gotoZonesTable(page);

    const table = page.getByRole("table", { name: `Zones ranked by ${LONG_LABEL}` });
    await expect(table).toBeVisible();

    // the score column is the 4th header cell: Select | Rank | Zone | <score>
    // (ZonesTable.svelte; matches e2e/keyboard-walk.spec.ts's own column-order comment).
    const scoreHeader = table.locator("thead th").nth(3);
    const headerText = (await scoreHeader.innerText()).trim();
    expect(headerText, "the visible header text must be short, never the whole label").toBe(
      "Score",
    );
    expect(headerText.length, "regression guard: the old bug printed the full sentence here").toBe(
      "Score".length,
    );

    // the full label is still reachable: a hover title...
    await expect(scoreHeader).toHaveAttribute("title", LONG_LABEL);
    // ...and to assistive tech via the accessible name (aria-label), so "Score" alone is never the
    // only cue to which metric this is.
    await expect(scoreHeader).toHaveAttribute("aria-label", `Score (${LONG_LABEL})`);
  });
});
