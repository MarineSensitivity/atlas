// P3 fix (owner finding, live 0.10.37, 390x844: "Scores -> Table -> Species for cell 3092526" --
// "Table is an absurdity of unintelligible ellipses", 12 columns squeezed to ~2 characters each).
// The FIX (SpeciesTable.svelte, ZonesTable.svelte, DataTable.svelte, dataTableCore.ts) gives every
// column a readable minimum width and scrolls the TABLE horizontally instead of squeezing every
// column evenly, with a sticky identifying column + header.
//
// This spec proves that shared mechanism on the ZONES tab -- boot-data only, no DuckDB-WASM engine
// (the SAME reason e2e/shell.panel.spec.ts's own header gives for testing Zones, not Species,
// end-to-end: "proving [the identical fix] on SpeciesTable.svelte needs a real DuckDB-WASM +
// Parquet fixture ... a known gap"). SpeciesTable.svelte's own phone-default-six-columns and
// "Columns" control are covered by vitest (tests/lens/scores/speciesTableColumns.test.ts, pure
// logic) -- the DOM-level proof of THOSE two rules is the same known gap, not silently skipped.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs } from "./map-hermetic";

test.describe.configure({ mode: "serial" });

const VER = "v7";
const COMPOSITE_KEY = "score_overall";
// six REALISTIC component keys (`zonesTable.ts#zonesTableRows` derives each header's text from
// the KEY itself, via `flower.ts#componentLabel` -- stripping `extrisk_`/`_ecoregion_rescaled` and
// turning underscores to spaces -- never from `boot.layers[].label`). Several resolve to a
// multi-word label long enough that the OLD "divide every column evenly" rule would have
// ellipsized it to a couple of characters; this also makes the six columns, at their own minimum
// width, comfortably wider than a 390px phone panel, so the table MUST scroll horizontally.
const COMPONENT_KEYS = [
  "extrisk_bird_ecoregion_rescaled",
  "extrisk_marine_mammal_ecoregion_rescaled",
  "extrisk_sea_turtle_ecoregion_rescaled",
  "extrisk_primary_producer_ecoregion_rescaled",
  "extrisk_invertebrate_and_coral_ecoregion_rescaled",
  "extrisk_diving_seabird_ecoregion_rescaled",
];
const COMPONENT_LABELS = COMPONENT_KEYS.map((k) =>
  k
    .replace(/^extrisk_/, "")
    .replace(/_ecoregion_rescaled$/, "")
    .replace(/_/g, " "),
);
const N_ZONES = 12;

function zoneMetrics(i: number): Record<string, number> {
  const metrics: Record<string, number> = { [COMPOSITE_KEY]: 100 - i };
  for (const k of COMPONENT_KEYS) metrics[k] = (i * 7) % 100;
  return metrics;
}

const BOOT = {
  ver: VER,
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  grid: { grid_id: "test05r" },
  release: { status: "release", access: "public" },
  units: [], // no drawable unit published -- the zones table ranks boot.zones verbatim, no engine
  zones: {
    programarea: Array.from({ length: N_ZONES }, (_, i) => ({
      key: `Z${i}`,
      // long enough to prove a header/cell NEVER truncates to "Z…" the way the owner's screenshot
      // showed -- "Zone Number NN (a long descriptive name)".
      name: `Zone Number ${i} (a long descriptive name)`,
      metrics: zoneMetrics(i),
    })),
  },
  datasets: [],
  layers: [
    { metric_key: COMPOSITE_KEY, label: "Overall score", category: "composite", order: 1 },
    ...COMPONENT_KEYS.map((k, i) => ({
      metric_key: k,
      label: `Component number ${i + 1} (a long descriptive label)`,
      category: "component",
      order: i + 2,
    })),
  ],
};

async function gotoZonesTable(page: Page) {
  await blockWasm(page);
  await routeBucket(page, VER, BOOT);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "Zones", exact: true }).click();
  await expect(page.getByRole("table", { name: /^Zones ranked by/ })).toBeVisible();
}

/** the table's own horizontally-scrolling wrapper (ZonesTable.svelte's `.zones-table`) -- distinct
 * from the PANEL/SHEET around it, which must never need to scroll horizontally itself. */
function tableScrollRegion(page: Page) {
  return page.locator(".zones-table");
}

async function scrollMetrics(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
}

test.describe("P3 phone (390x844): the table scrolls, the panel does not; nothing truncates", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the table region has horizontal overflow; the sheet body around it does not", async ({
    page,
  }) => {
    await gotoZonesTable(page);

    const table = tableScrollRegion(page);
    const tableMetrics = await scrollMetrics(table);
    expect(
      tableMetrics.scrollWidth,
      "the table's own scroll wrapper must be WIDER than its viewport -- that's what makes it scroll",
    ).toBeGreaterThan(tableMetrics.clientWidth);

    // the sheet body wrapping the whole Table tool (phone chrome, Sheet.svelte) -- the OWNER's
    // bug was the PANEL being squeezed; the panel/sheet region itself must never need its own
    // horizontal scrollbar (only the table inside it does).
    const sheetBody = page.locator(".sheet-body");
    await expect(sheetBody).toBeVisible();
    const sheetMetrics = await scrollMetrics(sheetBody);
    expect(
      sheetMetrics.scrollWidth,
      "the sheet body must not itself overflow horizontally -- only .zones-table should",
    ).toBeLessThanOrEqual(sheetMetrics.clientWidth + 1);
  });

  test("no header cell's text is truncated -- it wraps instead of ellipsizing", async ({
    page,
  }) => {
    await gotoZonesTable(page);
    const headers = page.locator(".zones-table thead th");
    const count = await headers.count();
    expect(count).toBeGreaterThan(3); // Select + Rank + Zone + Score + >= 1 component
    for (let i = 0; i < count; i++) {
      const cell = headers.nth(i);
      const metrics = await scrollMetrics(cell);
      const text = (await cell.innerText()).trim();
      expect(
        metrics.scrollWidth,
        `header cell ${i} ("${text}") must not overflow its own box -- text wraps, never truncates`,
      ).toBeLessThanOrEqual(metrics.clientWidth + 1);
    }
    // the regression this guards: the OLD rule divided every column evenly, which for a label this
    // long ("invertebrate and coral") always ellipsized it down to a couple of characters -- the
    // FULL text must still be findable somewhere in the header, not just "not overflowing an
    // invisible box" (a truncated "in…" would also pass the scrollWidth check above).
    await expect(page.locator(".zones-table thead")).toContainText("invertebrate and coral");
  });

  // fault-registry entry (tests/faults/datatable-min-width-drop.patch, PW_PORT 4375): this is the
  // ONE assertion the previous two tests do NOT make -- `overflow-wrap: break-word` means even an
  // absurdly narrow column never literally overflows or drops text (a single word just wraps onto
  // more lines), so neither "no overflow" nor "the full text is present" actually detects the OLD
  // "divide every column evenly" rule coming back. This reads each column's real rendered width
  // and asserts it against dataTableCore.ts's own minimums -- the one property a min-width
  // regression cannot pass.
  test("every column's rendered width honours dataTableCore.ts's own minimum -- table-layout: fixed is really being applied, not ignored", async ({
    page,
  }) => {
    await gotoZonesTable(page);
    const headers = page.locator(".zones-table thead th");
    const widths = await headers.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    // Select | Rank | Zone | Score | 6 components -- Select is a fixed 40px checkbox column, not
    // governed by dataTableCore.ts's text/narrow rule.
    const [, rank, zone, score, ...components] = widths;
    // NARROW_COLUMN_WIDTH_PX = 60 (dataTableCore.ts): Rank/Score/each component.
    for (const [label, w] of [
      ["Rank", rank],
      ["Score", score],
      ...components.map((w, i) => [`component ${i}`, w] as const),
    ] as const) {
      expect(
        w,
        `${label} column (narrow) must be at least the 60px floor, not squeezed`,
      ).toBeGreaterThanOrEqual(58);
    }
    // TEXT_COLUMN_WIDTH_PX = 88: Zone (the identifying column) gets the wider, readable minimum.
    expect(
      zone,
      "the Zone column (text) must be at least the 88px floor, not squeezed",
    ).toBeGreaterThanOrEqual(86);
  });

  test("the Zone column (the identifying column) stays put -- sticky -- once the table scrolls right", async ({
    page,
  }) => {
    await gotoZonesTable(page);
    const table = tableScrollRegion(page);
    // the first data row's Zone cell (ZonesTable.svelte: Select | Rank | Zone | Score | ...).
    const zoneCell = table.locator("tbody tr").first().locator("td.sticky-col");
    await expect(zoneCell).toBeVisible();

    // `position: sticky` only PINS a cell once scrolling would otherwise carry it past its `left:
    // 0` boundary -- at scrollLeft=0 the cell sits in its ordinary, un-stuck flow position (after
    // the Select/Rank columns), which is NOT the assertion here. The rule under test is that once
    // it HAS caught up to the left edge, scrolling further does not move it again -- so this reads
    // its x at two DIFFERENT (both already-scrolled) offsets and compares those to each other.
    async function scrollToAndGetX(scrollLeft: number): Promise<number> {
      await table.evaluate((el, left) => {
        el.scrollLeft = left;
      }, scrollLeft);
      await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThanOrEqual(1);
      return zoneCell.evaluate((el) => el.getBoundingClientRect().x);
    }

    const maxScroll = await table.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(
      maxScroll,
      "the fixture must actually need to scroll for this test to mean anything",
    ).toBeGreaterThan(40);
    const atHalf = await scrollToAndGetX(Math.round(maxScroll / 2));
    const atMax = await scrollToAndGetX(maxScroll);
    expect(
      atMax,
      "a stuck position:sticky left:0 cell's viewport x must not move as scrolling continues",
    ).toBeCloseTo(atHalf, 0);
  });
});

test.describe("P3 desktop (1280x800): every column exists, still with the min-width/scroll rule", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Select + Rank + Zone + Score + every published component column is present", async ({
    page,
  }) => {
    await gotoZonesTable(page);
    const headers = page.locator(".zones-table thead th");
    // Select, Rank, Zone, Score, + one per COMPONENT_KEYS.
    await expect(headers).toHaveCount(4 + COMPONENT_KEYS.length);
    const texts = (await headers.allInnerTexts()).map((t) => t.trim());
    expect(texts).toContain("Zone");
    expect(texts).toContain("Score");
    for (const label of COMPONENT_LABELS) {
      expect(texts, `expected a "${label}" header among: ${texts.join(" | ")}`).toContain(label);
    }
  });
});
