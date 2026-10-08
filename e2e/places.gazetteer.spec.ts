// gazetteer-places: a `p.` place_id token in a deep link is fetched from the gazetteer, drawn, and
// credited -- with the Places tool never opened (the resolution lives in the placesMap store) -- and
// an unreachable gazetteer degrades to a notice with the token kept in the link.
//
// Hermetic: the gazetteer bucket (layers.json, the collection parquet, the places index) is routed to
// the committed parquet fixtures in tests/fixtures/gazetteer, with the Range support hyparquet needs.
// The id is `FX:A-1` (authority FX, so it is found through layers.json -- the non-`places` path).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  collectConsoleErrors,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";
import { blockWasm } from "./map-hermetic";
import { hashFromPlaces } from "../src/places/model";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

const FIX = fileURLToPath(new URL("../tests/fixtures/gazetteer/", import.meta.url));
const GAZ = "**/oceanmetrics.io-public/gazetteer/**";

function fulfillWithRange(route: Route, file: string, type: string) {
  const buf = readFileSync(FIX + file);
  const range = route.request().headers()["range"];
  const base = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "range",
    "access-control-expose-headers": "Content-Range, Content-Length, Accept-Ranges",
    "accept-ranges": "bytes",
    "content-type": type,
  };
  const m = /bytes=(\d*)-(\d*)/.exec(range ?? "");
  if (!m) return route.fulfill({ status: 200, headers: base, body: buf });
  let start: number;
  let end = buf.length - 1;
  if (m[1] === "") start = buf.length - Number(m[2]);
  else {
    start = Number(m[1]);
    if (m[2]) end = Math.min(Number(m[2]), buf.length - 1);
  }
  return route.fulfill({
    status: 206,
    headers: { ...base, "content-range": `bytes ${start}-${end}/${buf.length}` },
    body: buf.subarray(start, end + 1),
  });
}

async function routeGazetteer(page: Page): Promise<void> {
  await page.route(GAZ, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/gazetteer\//, "");
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "range",
          "access-control-allow-methods": "GET, HEAD",
        },
      });
    if (path === "index/layers.json") return fulfillWithRange(route, path, "application/json");
    if (/\.parquet$/.test(path)) return fulfillWithRange(route, path, "application/octet-stream");
    return route.fulfill({ status: 404 }); // the PMTiles archives are not needed by a deep link
  });
}

function deepLink(): string {
  const pl = hashFromPlaces([{ kind: "gaz", id: "FX:A-1", name: "Alpha lease" }])!;
  const params = new URLSearchParams();
  params.set("pl", pl);
  return `/?sel=place:0&map=-123.5,33.5,7#${params.toString()}`;
}

async function open(page: Page): Promise<void> {
  await blockWasm(page);
  await routeBucket(page);
  await routeSession(page, null);
  await routeSealFixture(page);
  await page.goto(deepLink());
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

test.describe("p. place_id tokens", () => {
  test("a deep-linked gazetteer place is fetched, drawn, and credited", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectConsoleErrors(page);
    await routeGazetteer(page);
    await open(page);

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = window.__atlasMap!.handle.map;
            if (!map.getLayer("selection-line") || !map.isSourceLoaded("selection")) return -1;
            return map.queryRenderedFeatures({ layers: ["selection-line"] }).length;
          }),
        { message: "the fetched gazetteer place never drew its outline", timeout: 25_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // per-source credits: the place's own attribution (from the index) is in the map credit line
    await expect(page.getByTestId("map-attribution-gazetteer")).toContainText("Fixture Agency", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("map-attribution-gazetteer")).toContainText(
      "Processed by Ocean Metrics.",
    );
    expect(errors).toEqual([]);
  });

  test("an unreachable gazetteer keeps the token in the link and says so", async ({ page }) => {
    test.setTimeout(60_000);
    await page.route(GAZ, (route) => route.abort("failed"));
    await open(page);

    await expect(page.getByText(/Couldn't reach the places gazetteer/).first()).toBeVisible({
      timeout: 20_000,
    });
    // the link still carries the reference (URL-is-the-view): nothing was dropped
    expect(await page.evaluate(() => decodeURIComponent(location.hash))).toContain(
      "p.FX%3AA-1.Alpha%20lease",
    );
    // and no credit is claimed for data that is not on the map
    await expect(page.getByTestId("map-attribution-gazetteer")).toHaveCount(0);
  });

  test("Pick from gazetteer shows the layer, credits it, and a click adds the place_id token", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await routeGazetteer(page);
    await blockWasm(page);
    await routeBucket(page);
    await routeSession(page, null);
    await routeSealFixture(page);
    await page.goto("/?map=-123.5,33.5,7");
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    await page.locator("#rail-region button[aria-label='Report']").click();

    await page.getByRole("button", { name: "Pick from gazetteer" }).click();
    // the composed style now carries the gazetteer source + fill/line, and the credit line says whose
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = window.__atlasMap!.handle.map;
            return !!map.getLayer("gazetteer-fill") && !!map.getLayer("gazetteer-line");
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(page.getByTestId("map-attribution-gazetteer")).toContainText("Marine Regions");

    // a click on a gazetteer polygon: the PMTiles archive is not served hermetically, so the
    // hit-test answer is stubbed at the one MapLibre call pickInstall makes; everything after it
    // (the token, the hash, the list row, the fetch) is the real app
    await page.evaluate(() => {
      const map = window.__atlasMap!.handle.map as unknown as {
        queryRenderedFeatures: (...a: unknown[]) => unknown[];
        fire: (t: string, e: unknown) => void;
      };
      map.queryRenderedFeatures = () => [
        { properties: { place_id: "FX:A-1", name: "Alpha lease" } },
      ];
      map.fire("click", { point: { x: 10, y: 10 }, lngLat: { lng: -123.5, lat: 33.5 } });
    });
    await expect(page.locator(".place-row").first()).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => decodeURIComponent(location.hash))).toContain(
      "p.FX%3AA-1.Alpha%20lease",
    );
    // its geometry arrives from the (fixture) gazetteer and the row gets an area
    await expect(page.locator(".place-row .row-stat").first()).not.toHaveText("— km²", {
      timeout: 20_000,
    });

    // switching the picker off removes the layer and its credit
    await page.getByRole("button", { name: "Pick from gazetteer" }).click();
    await expect
      .poll(() => page.evaluate(() => !!window.__atlasMap!.handle.map.getLayer("gazetteer-fill")), {
        timeout: 15_000,
      })
      .toBe(false);
  });
});
