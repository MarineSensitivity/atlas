// 0.10.79 size-budget fix round (regression): `Shell.svelte` and `placesMap.svelte.ts` load
// `places/model` (the g1 codec) through a dynamic `import()` to stay under the static budget, so
// `reportPlaces`/`downloadPlaces` are `[]` until that chunk resolves. A link that arrives WITH
// places in the hash (cold load, nothing clicked) must still end up showing them -- in the Places
// tab list AND in the Report tab's subject sentence (which reads "Reporting on the last clicked
// place" while the list is still empty) -- and nothing may write/clear `sel.pl` in the meantime.
// Hermetic, same fixtures as e2e/report.flow.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs } from "./map-hermetic";
import { hashFromPlaces } from "../src/places/model";
import type { GeomPlace, ZonePlace } from "../src/lib/geo/placeCodec";

test.use({ viewport: { width: 1280, height: 800 } });

const VER = "v7";
const BOOT = {
  ver: VER,
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  grid: { grid_id: "test05r" },
  release: { status: "release", access: "public" },
  units: [],
  zones: { programarea: [{ key: "MDA", name: "Mid Atlantic", metrics: { composite: 12.5 } }] },
  datasets: [],
  layers: [],
};

const SQUARE: GeomPlace["geometry"] = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
};

async function gotoShell(page: Page, path: string): Promise<void> {
  await blockWasm(page);
  await routeBucket(page, VER, BOOT);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.goto(path);
  await waitForHydration(page);
}

test.describe("a places link loaded cold", () => {
  test("shows its places in the Places tab and the Report sentence, and leaves #pl= alone", async ({
    page,
  }) => {
    const pl = hashFromPlaces([
      { kind: "zone", set: "pa", keys: ["MDA"] } satisfies ZonePlace,
      { kind: "geom", name: "Cold link square", geometry: SQUARE } satisfies GeomPlace,
    ]);
    if (!pl) throw new Error("hashFromPlaces() returned no hash");
    await gotoShell(page, `/#pl=${encodeURIComponent(pl)}`);

    await page.locator('#rail-region button[aria-label="Report"]').click();
    const list = page.getByRole("list", { name: "Places" });
    await expect(list.getByRole("listitem")).toHaveCount(2, { timeout: 15_000 });
    await expect(list).toContainText("Cold link square");

    await page
      .getByRole("group", { name: "Report pane section" })
      .getByRole("button", { name: "Report", exact: true })
      .click();
    await expect(page.getByTestId("report-subject-sentence")).toHaveText("Reporting on 2 places.");

    // never cleared/rewritten by the lazy model resolving
    const params = new URLSearchParams((await page.evaluate(() => location.hash)).slice(1));
    expect(params.get("pl")).toBe(pl);
  });
});
