// S-01, the owner's 2026-09-24 live defect: `https://marinesensitivity.org/atlas/?ver=v7&area=AK`
// rendered the DEFAULT camera (globe over North America), not Alaska. `scripts/parity-page/status.mjs`
// marked S-01 "done" on evidence that could not have caught this — an Opus 5.5 audit found the old
// test spied on `flyTo` directly (never proving anything reaches a real map), and `flyToStudyArea`
// (`src/lib/map/interaction.ts`) has NO caller anywhere in `src/` (only a stale comment in
// `src/places/camera.ts`) — the real fly path is `MapHandle#flyTo` (`src/lib/map/map.ts`), which no
// existing test drove end-to-end. This spec goes through the REAL, BUILT app: `?ver=v7&area=AK` on
// load, a select change FULL -> AK (waiting for the map's own `moveend`, then asserting centre AND
// zoom against the AK preset), `area=FULL` fitting the whole study area again, a user pan afterward
// being kept (not fought), the fix running with the Layers panel COLLAPSED (proving it is wired from
// the shell/lens level, never gated on the panel body being mounted), and — kept alongside as the
// NEGATIVE half `tileUrlLeaksStudyArea` already covered — that no titiler request ever carries a
// study-area key (D7: "the study area is a camera, never a filter").
//
// Root cause (two bugs stacked, both fixed in src/shell/Shell.svelte / src/lib/map/camera.ts /
// src/lens/scores/LayersPanel.svelte): (1) the map's initial camera resolved `sel.area` against a
// literal `null` boot, so it could never see a release's real `study_areas` rows; (2) the ONLY place
// that ever called `handle.flyTo(area)` was the Layers panel's `onchange` handler — the panel BODY,
// which never runs for a `sel.area` arriving from the URL on load. See camera.ts's
// `shouldFlyToArea` for the fix and its precedence rules. The fix now lives in Shell.svelte's own
// `$effect` (a shell/lens-level store, docs/map.md's 0.10.21 rule), never inside the panel.
//
// v7's grid (`usa05`) is a 0-360 longitude frame for CELL math (grid.ts) — but a study area's own
// `lon`/`lat` (this spec's AK/GA/FULL) are plain geographic camera presets, never grid cell
// coordinates, and none of the three sits near a wrap edge (-164.654/-89.089/-101.304, all far from
// +-180) — so a plain signed-degree comparison against `map.getCenter()` is exact here and needs no
// 0-360 normalization. (`camera.ts#boundsToCameraView`'s own unwrapped-frame handling is a DIFFERENT
// concern — the species camera's extent fit — not a study-area preset's centre point.)
import { expect, test, type Page } from "@playwright/test";
import {
  collectConsoleErrors,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { STUDY_AREAS, bootFor, routeZones20 } from "./scores-hermetic";
import { panelStorageKey, type PanelGeometry } from "../src/lib/ui/panelGeometry";
import { tileUrlLeaksStudyArea } from "../src/lib/map/layers/titiler";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

/** the plain shape this spec needs off the shared map handle — a LOCAL cast, not a `declare global`
 * (e2e/species-hermetic.ts's own convention/comment: every `declare global` augmentation of
 * `Window.__atlasMap` across the suite must be byte-for-byte identical, so a spec that needs a
 * DIFFERENT slice of the map — here, `getBounds`/`getCenter`/`getZoom`/`on`, nothing any existing
 * ambient shape carries — casts locally instead of adding a conflicting global declaration). */
interface AtlasMapForStudyArea {
  handle: {
    map: {
      getBounds(): { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number };
      getCenter(): { lng: number; lat: number };
      getZoom(): number;
      on(event: string, cb: () => void): void;
    };
  };
}

/** every published study area, from the SAME real fixture (`tests/fixtures/species/v7/study-areas
 * .json`) `bootFor("v7")` publishes — never hardcoded here (read the release's own `study_areas`,
 * whatever keys/values it carries). */
const AK = STUDY_AREAS.find((a) => a.key === "AK")!;
const GA = STUDY_AREAS.find((a) => a.key === "GA")!;
const FULL = STUDY_AREAS.find((a) => a.key === "FULL")!;

async function gotoScoresArea(page: Page, search: string) {
  await blockWasm(page);
  await routeBucket(page, "v7", bootFor("v7"));
  await routeSession(page, null); // v7 is public
  await routeSealFixture(page);
  await routeZones20(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  // mercator, not the shipped globe default (same reason e2e/map.spec.ts's own probes give): a
  // camera assertion should not also have to account for globe's curvature at low zoom.
  await page.goto(`/?proj=mercator${search}`);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
  // arm a plain moveend COUNTER once, right after the map exists — every later `waitForMoveEnd`
  // just waits for this to advance past its own "before" snapshot, so arming once up front can
  // never race a `flyTo` that starts before a per-call listener would have been attached.
  await page.evaluate(() => {
    const w = window as unknown as {
      __atlasMap?: AtlasMapForStudyArea;
      __moveEndCount?: number;
    };
    w.__moveEndCount = 0;
    w.__atlasMap?.handle.map.on("moveend", () => {
      w.__moveEndCount = (w.__moveEndCount ?? 0) + 1;
    });
  });
}

function getMoveEndCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __moveEndCount?: number }).__moveEndCount ?? 0,
  );
}

function getBounds(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __atlasMap: AtlasMapForStudyArea }).__atlasMap.handle.map;
    const b = map.getBounds();
    return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
  });
}

function getCamera(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __atlasMap: AtlasMapForStudyArea }).__atlasMap.handle.map;
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
  });
}

function contains(
  bounds: { west: number; east: number; south: number; north: number },
  point: { lon: number; lat: number },
): boolean {
  return (
    point.lon >= bounds.west &&
    point.lon <= bounds.east &&
    point.lat >= bounds.south &&
    point.lat <= bounds.north
  );
}

/** poll until the camera settles on `point` (a real `flyTo` animates) — same "poll, don't read
 * once" convention scripts/verify.mjs's own probes use for anything that paints/moves async. Used
 * for the ON-LOAD cases, where a one-shot `moveend` listener would race the effect that may already
 * have fired before this spec gets a chance to arm one. */
async function waitForCameraNear(page: Page, point: { lon: number; lat: number }, tolDeg = 1) {
  await expect
    .poll(
      async () => {
        const c = await getCamera(page);
        return Math.hypot(c.lng - point.lon, c.lat - point.lat);
      },
      { timeout: 10_000 },
    )
    .toBeLessThan(tolDeg);
}

/** for a USER-triggered change (this spec controls exactly when the action fires): snapshot the
 * moveend counter, run `action`, then wait for a REAL `moveend` to fire before reading the camera —
 * literally "wait for the map's moveend", not just "poll until close enough". */
async function flyAndWaitForMoveEnd(page: Page, action: () => Promise<unknown>) {
  const before = await getMoveEndCount(page);
  await action();
  await expect.poll(() => getMoveEndCount(page), { timeout: 10_000 }).toBeGreaterThan(before);
}

const COLLAPSED_GEOMETRY: PanelGeometry = { collapsed: true, detent: "half" };

/** seeds the "shell" panel's desktop geometry as collapsed, BEFORE any app script runs — same
 * technique e2e/scores.collapsed-panel.spec.ts's own `seedCollapsedShellPanel` uses, reproduced
 * here (not imported: that helper is scoped to its own spec file) so THIS spec can prove the fix
 * is lens/shell-level, not panel-body-gated, without depending on another spec file's internals. */
async function seedCollapsedShellPanel(page: Page): Promise<void> {
  const key = panelStorageKey("shell", "desktop");
  const value = JSON.stringify(COLLAPSED_GEOMETRY);
  await page.addInitScript(
    ([k, v]) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        // private mode / storage disabled — same "chrome, not correctness" guard panelGeometry.ts
        // itself applies; the spec just exercises the (never-collapsed) default instead.
      }
    },
    [key, value] as const,
  );
}

test.describe("S-01: the study area is a CAMERA — sel.area drives it on load and on change", () => {
  test("?area=AK flies to Alaska on LOAD, not the default camera", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const titilerRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("titiler-v8.marinesensitivity.org")) titilerRequests.push(req.url());
    });

    await gotoScoresArea(page, "&area=AK");
    await waitForCameraNear(page, { lon: AK.lon, lat: AK.lat });

    const bounds = await getBounds(page);
    expect(
      contains(bounds, { lon: AK.lon, lat: AK.lat }),
      `bounds ${JSON.stringify(bounds)} do not contain Alaska's own study-area point (${AK.lon},${AK.lat})`,
    ).toBe(true);
    expect(
      contains(bounds, { lon: GA.lon, lat: GA.lat }),
      `bounds ${JSON.stringify(bounds)} unexpectedly contain the Gulf of America's point too — the camera never left the default FULL view`,
    ).toBe(false);

    // the negative half, kept ALONGSIDE this positive one (never a replacement for it): the study
    // area moved the CAMERA only — not one titiler request carries a study-area key.
    expect(titilerRequests.length).toBeGreaterThan(0); // otherwise the check below is vacuous
    for (const url of titilerRequests) expect(tileUrlLeaksStudyArea(url)).toBeNull();

    expect(errors).toEqual([]);
  });

  test("changing the Study area select FULL -> AK flies there (real moveend) and writes area=AK to the URL", async ({
    page,
  }) => {
    await gotoScoresArea(page, "");
    await waitForCameraNear(page, { lon: FULL.lon, lat: FULL.lat });

    await flyAndWaitForMoveEnd(page, () => page.getByLabel("Study area").selectOption(AK.key));

    const camera = await getCamera(page);
    expect(camera.lng).toBeCloseTo(AK.lon, 0);
    expect(camera.lat).toBeCloseTo(AK.lat, 0);
    expect(camera.zoom).toBeCloseTo(AK.zoom, 0);
    expect(new URL(page.url()).searchParams.get("area")).toBe(AK.key);
  });

  test("area=FULL (selected after another area) fits the whole study area again", async ({
    page,
  }) => {
    await gotoScoresArea(page, `&area=${AK.key}`);
    await waitForCameraNear(page, { lon: AK.lon, lat: AK.lat });

    await flyAndWaitForMoveEnd(page, () => page.getByLabel("Study area").selectOption(FULL.key));

    const camera = await getCamera(page);
    expect(camera.lng).toBeCloseTo(FULL.lon, 0);
    expect(camera.lat).toBeCloseTo(FULL.lat, 0);
    expect(camera.zoom).toBeCloseTo(FULL.zoom, 0);

    // FULL's own zoom (2.16, the whole US) is wide enough to contain BOTH Alaska's and the Gulf's
    // own points -- the "whole study area" this state's name promises, not just "somewhere else".
    const bounds = await getBounds(page);
    expect(contains(bounds, { lon: AK.lon, lat: AK.lat })).toBe(true);
    expect(contains(bounds, { lon: GA.lon, lat: GA.lat })).toBe(true);
  });

  test("a user pan after the fly is kept — not fought back to the study area", async ({ page }) => {
    await gotoScoresArea(page, "&area=AK");
    await waitForCameraNear(page, { lon: AK.lon, lat: AK.lat });

    const before = await getCamera(page);
    const box = (await page.locator("#map").boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 220, cy + 120, { steps: 10 });
    await page.mouse.up();

    // the pan itself must have moved the camera (otherwise the assertion below is vacuous)...
    await expect
      .poll(async () => {
        const c = await getCamera(page);
        return Math.hypot(c.lng - before.lng, c.lat - before.lat);
      })
      .toBeGreaterThan(0.5);

    // ...and it must STAY moved: nothing re-flies the camera back to AK afterward (`sel.area` is
    // unchanged, so `shouldFlyToArea` never fires again for the SAME key — camera.ts's own "no-fight"
    // rule). Give any wrongful re-fly a real window to happen in before asserting it did not.
    await page.waitForTimeout(1500);
    const after = await getCamera(page);
    expect(Math.hypot(after.lng - AK.lon, after.lat - AK.lat)).toBeGreaterThan(0.5);
  });

  test("?area=AK still flies to Alaska with the Layers panel COLLAPSED at load", async ({
    page,
  }) => {
    // proves the fix is wired from the shell/lens level, never the panel body: were the camera
    // effect still living inside LayersPanel.svelte (or triggered only by its onchange), a
    // collapsed-at-load desktop panel — which never mounts that component at all — would leave the
    // map on the default camera exactly like the original defect.
    await seedCollapsedShellPanel(page);
    await gotoScoresArea(page, "&area=AK");
    await waitForCameraNear(page, { lon: AK.lon, lat: AK.lat });

    // the panel body really is absent — the Study area <select> is not in the DOM at all — so this
    // also proves the assertion above did not accidentally exercise the panel's own onchange path.
    await expect(page.getByLabel("Study area")).toHaveCount(0);
  });
});
