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
import { FIT_GUTTER_PX } from "../src/lib/map/chromePadding";

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

  // owner review item 1 (Ben, live 0.10.62): "Entering Program Area (PA) in search bar at top
  // should zoom to that PA, like it already zooms to lon,lat" -- RED-FIRST, fails on the pre-fix
  // tree because `zoneCenterFromBoot` needs `label_pt`, which no published release carries
  // (docs/parity.html's "known gap G-01"), so `selectZone` fell straight through to the
  // announce-only branch and the camera never moved. `zoneBoundsFromMap` (state.svelte.ts) is the
  // real fix -- ALA's own polygon, queried live off the SAME zones20 PMTiles fixture already
  // routed for this suite (`gotoScoresSearch`'s own `routeZones20`), lon [-170,-168] lat [20,22]
  // (e2e/fixtures/scores/zones20.geojson).
  test("Enter flies the camera into the Aleutian Arc's own polygon bbox", async ({ page }) => {
    await gotoScoresSearch(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });

    const input = page.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("ALA");
    await expect(page.getByRole("option", { name: "Aleutian Arc (ALA)" })).toBeVisible();
    await input.press("Enter");

    await expect.poll(() => urlSel(page)).toBe("zone:programarea:ALA");

    // ALA's fixture polygon spans lon [-170,-168] lat [20,22] -- flyToBounds settles the camera
    // CENTRE somewhere inside that box (the exact acceptance test this fix round names).
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const c = (
              window as unknown as {
                __atlasMap: { handle: { map: { getCenter(): { lng: number; lat: number } } } };
              }
            ).__atlasMap.handle.map.getCenter();
            return c.lng >= -170 && c.lng <= -168 && c.lat >= 20 && c.lat <= 22;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
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

test.describe("V6 fix (owner-reported, 2026-09-24): fallback-name search on the real release shape", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("typing 'Aleutian' finds Aleutian Arc on the real v7 shape (no published zone names) -- Enter flies to it", async ({
    page,
  }) => {
    // `bootFor("v7")`, UNCHANGED -- every zone row publishes `name: key` (equivalent to "no name",
    // paLabel's own rule), the real release shape. No `bootWithAleutianArc()`-style override: this
    // is the exact case that was broken -- the dropdown already showed "Aleutian Arc (ALA)" via the
    // PROGRAM_AREA_NAMES fallback, but typing that same name found nothing.
    await blockWasm(page);
    await routeBucket(page, "v7", bootFor("v7"));
    await routeSession(page, { preview: true, ver: "v7" });
    await routeSealFixture(page);
    await routeZones20(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    await page.goto("/?proj=mercator");
    await waitForHydration(page);

    const input = page.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("Aleutian");

    const option = page.getByRole("option", { name: "Aleutian Arc (ALA)" });
    await expect(option).toBeVisible();

    await input.press("Enter");
    await expect.poll(() => urlSel(page)).toBe("zone:programarea:ALA");
    expect(new URL(page.url()).searchParams.get("unit")).toBe("programarea");
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

// P3 fix (Opus 5.5 eyes-on review, 2026-09-24, phone-19/20/21 + desktop-19): `selectZone`'s bounds
// fit (state.svelte.ts, the SAME "Enter flies the camera" mechanism the W1 tests above cover) used
// a flat 40px `padding` on every edge, blind to the phone sheet or the desktop docked panel actually
// covering the map -- a search pick of GAA landed with the area (and its full-name popup) mostly
// BEHIND that chrome: phone, a sliver at the sheet's edge, the free area itself showing a wrong
// stretch of the country; desktop, roughly a third of the area under the docked panel.
// `deps.chromePadding()` (state.svelte.ts's new `ScoresLensDeps` field, wired in `Shell.svelte`) now
// threads the SAME live `currentChromePadding()` getter the species lens' own bounds fit already
// uses (V1/V4 fixes, `e2e/species.camera.spec.ts`) into `selectZone`'s `flyToBounds`.
//
// GAA (its real name "GOA Program Area A" -- `programAreaNames.ts`'s own table, resolved through
// `paLabel`'s fallback exactly as ALA is above) is the SAME zone Ben's live report named; its
// fixture polygon (e2e/fixtures/scores/zones20.geojson) spans lon [-158,-156] lat [26,28] -- a
// fresh box, distinct from ALA's, so this exercises its own fit rather than reusing one already
// proven to land somewhere reasonable.
test.describe("P3 fix: a search-picked Program Area's bounds fit pads for the shell chrome", () => {
  const GAA_BBOX: [number, number, number, number] = [-158, 26, -156, 28];

  interface FreeAreaSample {
    x: number;
    y: number;
    inside: boolean;
  }
  interface FreeAreaResult {
    insideFraction: number;
    total: number;
    inside: number;
    sample: FreeAreaSample[];
    /** the sample's own min/max projected x -- for an explicit pixel-margin assertion (W5 fix),
     * distinct from `insideFraction` (which already folds the gutter into "inside"). */
    minX: number;
    maxX: number;
    containerWidth: number;
  }

  /** samples a 5x5 grid across `bbox` with the map's OWN `project()` and reports what fraction land
   * inside the FREE area -- container-relative, excluding whichever chrome element is actually on
   * screen right now: the phone sheet (`.sheet`) below, or the desktop docked panel
   * (`#panel-region .panel-surface`) to the side. Mirrors `e2e/species.camera.spec.ts`'s own V4
   * `freeAreaCoverage` helper (the identical class of bug, the species lens' own bounds fit),
   * generalized to whichever chrome the CURRENT viewport actually shows rather than assuming one,
   * so ONE helper covers both the phone and desktop tests below.
   *
   * W5 fix (Opus 5.5 eyes-on review 5, 2026-09-25, desktop-19/phone-19): "inside" now ALSO
   * subtracts `gutterPx` from whichever edge is actually chrome -- the docked panel's edge on
   * desktop (its own outer inset was already the desktop-19 defect; this test used to compare
   * against the panel's bare measured edge, which passed even with the fit landing flush against
   * it) and BOTH side edges of the viewport on phone (phone-19: no side gutter existed at all). */
  async function freeAreaCoverage(
    page: Page,
    bbox: [number, number, number, number],
    gutterPx: number = FIT_GUTTER_PX,
  ): Promise<FreeAreaResult> {
    return page.evaluate(
      ({ bboxArg, gutterArg }) => {
        const [xmin, ymin, xmax, ymax] = bboxArg;
        const w = window as unknown as {
          __atlasMap: {
            handle: {
              map: {
                project(lngLat: [number, number]): { x: number; y: number };
                getContainer(): HTMLElement;
              };
            };
          };
        };
        const map = w.__atlasMap.handle.map;
        const containerRect = map.getContainer().getBoundingClientRect();
        const sheetEl = document.querySelector(".sheet");
        const sheetTop = sheetEl ? sheetEl.getBoundingClientRect().top - containerRect.top : null;
        const panelEl = document.querySelector("#panel-region .panel-surface");
        const panelLeft = panelEl
          ? panelEl.getBoundingClientRect().left - containerRect.left
          : null;

        const fracs = [0, 0.25, 0.5, 0.75, 1];
        const lons = fracs.map((f) => xmin + f * (xmax - xmin));
        const lats = fracs.map((f) => ymin + f * (ymax - ymin));
        const sample: { x: number; y: number; inside: boolean }[] = [];
        for (const lon of lons) {
          for (const lat of lats) {
            const p = map.project([lon, lat]);
            let inside = p.y >= 0 && p.y <= containerRect.height;
            if (sheetTop !== null) {
              // phone: no docked panel exists (`panelLeft` is always null here) -- the chrome is
              // the sheet below (unchanged) plus a side gutter on BOTH viewport edges (W5 fix).
              inside =
                inside &&
                p.x >= gutterArg &&
                p.x <= containerRect.width - gutterArg &&
                p.y < sheetTop;
            } else {
              inside = inside && p.x >= 0 && p.x <= containerRect.width;
              if (panelLeft !== null) inside = inside && p.x < panelLeft - gutterArg;
            }
            sample.push({ x: p.x, y: p.y, inside });
          }
        }
        const inside = sample.filter((s) => s.inside).length;
        const xs = sample.map((s) => s.x);
        return {
          insideFraction: inside / sample.length,
          total: sample.length,
          inside,
          sample,
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          containerWidth: containerRect.width,
        };
      },
      { bboxArg: bbox, gutterArg: gutterPx },
    );
  }

  /** `gotoScoresSearch`'s own routing, PLUS an explicit low-zoom `?map=` starting camera centred
   * on the zones20 fixture's own (geographically arbitrary, Hawaii-area) grid -- MapLibre only
   * loads tiles intersecting the CURRENT viewport at the CURRENT zoom, and `zoneBoundsFromMap`
   * (state.svelte.ts) only ever reads ALREADY-LOADED tiles (never a throw, "the caller degrades ...
   * exactly as before this fix" -- that function's own header). The phone's own default camera
   * (`phoneDefaultCamera`, Shell.svelte) frames a real, narrow Gulf-of-Mexico region nowhere near
   * this fixture's grid, so GAA's tile is never loaded and `bounds` comes back `null` on every
   * phone run -- measured live (DEBUG instrumentation, this fix's own dev log): `hasHandle: true,
   * bounds: null` -- NOT a regression this fix introduced (desktop's own default camera happens to
   * sit at a low enough zoom that the world-covering tile already includes this fixture's grid,
   * which is why the SAME flow passes there). A real user's map is never guaranteed to already be
   * zoomed out this far either, but that is `zoneBoundsFromMap`'s own documented fallback
   * (`zoneCenterFromBoot`, then an announce-only no-op) -- out of THIS fix's scope; seeding a
   * starting camera here is the harness working around the fixture's placement, not the product. */
  async function gotoScoresSearchNearFixture(page: Page): Promise<void> {
    await blockWasm(page);
    await routeBucket(page, "v9", bootWithAleutianArc());
    await routeSession(page, { preview: true, ver: "v9" });
    await routeSealFixture(page);
    await routeZones20(page);
    await routeBasemapStyle(page);
    await routeTitilerTiles(page);
    await routeGlyphs(page);
    await page.goto("/?proj=mercator&map=-157,27,2");
    await waitForHydration(page);
  }

  /** searches "GAA", selects it (Enter on desktop, a result-row click on the phone's search dialog
   * -- the SAME two selection mechanisms the Q1 describes above already exercise) and waits for the
   * URL to carry the selection, so both tests below start from an identical, proven-selected state. */
  async function searchAndSelectGAA(page: Page, phone: boolean): Promise<void> {
    await gotoScoresSearchNearFixture(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    // GAA's own tile must be genuinely queryable BEFORE the search pick runs -- `zoneBoundsFromMap`
    // (state.svelte.ts) reads `querySourceFeatures` synchronously and never retries, so a pick that
    // races a still-loading tile falls straight through to the (fixture-less) label_pt/announce
    // fallback, same as `gotoScoresSearchNearFixture`'s own header explains. A local cast (not the
    // shared ambient `Window.__atlasMap` other e2e files declare) for two methods that ambient
    // shape does not carry, rather than widening it (and every OTHER file's byte-for-byte-matching
    // copy) just for this one query.
    await page.waitForFunction(
      () => {
        const map = (
          window as unknown as {
            __atlasMap?: {
              handle: {
                map: {
                  getSource(id: string): unknown;
                  isSourceLoaded(id: string): boolean;
                  querySourceFeatures(
                    id: string,
                    opts: { sourceLayer: string; filter: unknown },
                  ): unknown[];
                };
              };
            };
          }
        ).__atlasMap?.handle.map;
        if (!map || !map.getSource("programarea_src") || !map.isSourceLoaded("programarea_src")) {
          return false;
        }
        return (
          map.querySourceFeatures("programarea_src", {
            sourceLayer: "programarea",
            filter: ["==", ["get", "programarea_key"], "GAA"],
          }).length > 0
        );
      },
      undefined,
      { timeout: 15_000 },
    );

    let scope = page.locator("body");
    if (phone) {
      await page.getByRole("button", { name: "Search species and places" }).click();
      const dialog = page.getByRole("dialog", { name: "Search" });
      await expect(dialog).toBeVisible();
      scope = dialog;
    }
    const input = scope.getByRole("combobox", { name: "Search Program Areas or coordinates" });
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("GAA");
    const option = scope.getByRole("option", { name: "GOA Program Area A (GAA)" });
    await expect(option).toBeVisible();
    if (phone) {
      await option.click();
    } else {
      await input.press("Enter");
    }
    await expect.poll(() => urlSel(page)).toBe("zone:programarea:GAA");
  }

  test.describe("desktop (1280x800)", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("GAA's fitted area lands mostly left of the docked panel, and its popup is visible there too", async ({
      page,
    }) => {
      await searchAndSelectGAA(page, false);

      // W5 fix (Opus 5.5 eyes-on review 5, 2026-09-25, desktop-19): the review's own acceptance
      // bar is 100%, not the old 80% -- "100% of a 5x5 grid over GAA's bbox projects left of the
      // panel's outer edge minus the gutter". The old 80% bar could pass with the review's own
      // ~12px east-lobe overlap (up to one full grid column landing under the panel edge).
      // Wrapped in `expect.poll` so this also waits out whatever remains of the `flyTo` animation.
      await expect
        .poll(async () => (await freeAreaCoverage(page, GAA_BBOX)).insideFraction, {
          message:
            "GAA's own bbox grid did not settle FULLY into the area left of the docked panel's " +
            "outer edge (minus the gutter)",
          timeout: 15_000,
        })
        .toBe(1);

      const popup = page.locator(".atlas-popup");
      await expect(popup).toBeVisible({ timeout: 10_000 });
      const popupBox = (await popup.boundingBox())!;
      const panelBox = (await page.locator("#panel-region .panel-surface").boundingBox())!;
      expect(
        popupBox.x + popupBox.width,
        `popup right edge x=${popupBox.x + popupBox.width} reaches into the docked panel ` +
          `starting at x=${panelBox.x}`,
      ).toBeLessThanOrEqual(panelBox.x + 0.5);
    });
  });

  test.describe("phone (390x844, half detent)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("GAA's fitted area lands mostly above the sheet, and its popup is visible there too", async ({
      page,
    }) => {
      await searchAndSelectGAA(page, true);

      await expect
        .poll(async () => (await freeAreaCoverage(page, GAA_BBOX)).insideFraction, {
          message: "GAA's own bbox grid did not settle into the area above the sheet",
          timeout: 15_000,
        })
        .toBe(1);

      const popup = page.locator(".atlas-popup");
      await expect(popup).toBeVisible({ timeout: 10_000 });
      const popupBox = (await popup.boundingBox())!;
      const sheetBox = (await page.locator(".sheet").boundingBox())!;
      expect(
        popupBox.y + popupBox.height,
        `popup bottom edge y=${popupBox.y + popupBox.height} reaches into the sheet starting ` +
          `at y=${sheetBox.y}`,
      ).toBeLessThanOrEqual(sheetBox.y + 0.5);
    });

    // W5 fix (Opus 5.5 eyes-on review 5, 2026-09-25, phone-19/20/21): "the phone zone fit has no
    // side gutter... GAA spans x 6-779 of 780, and its east outline touches the right edge." The
    // review's own acceptance bar: the projected bbox stays >= 16px from BOTH side edges -- an
    // explicit pixel-margin check, independent of `freeAreaCoverage`'s own (stricter, 20px)
    // `FIT_GUTTER_PX` "inside" definition above, so this proves the review's literal bar directly.
    test("GAA's fitted area keeps at least a 16px gutter from both side edges of the viewport", async ({
      page,
    }) => {
      await searchAndSelectGAA(page, true);

      const MIN_MARGIN_PX = 16;
      await expect
        .poll(
          async () => {
            const r = await freeAreaCoverage(page, GAA_BBOX, 0); // gutter=0: raw projected extent
            return Math.min(r.minX, r.containerWidth - r.maxX);
          },
          {
            message: "GAA's projected bbox did not settle with >= 16px clear on both side edges",
            timeout: 15_000,
          },
        )
        .toBeGreaterThanOrEqual(MIN_MARGIN_PX);
    });
  });
});
