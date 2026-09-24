// usability M4 (docs/usability.md §7): "Default camera frames Canada; panel/sheet cover the study
// area; basemap 8.6-14s, raster 10-21s after load, no loader." Two independent fixes, proven here:
// (1) the FIRST view (no explicit `?map=`) is shifted so the study area's own reference point
// lands inside the VISIBLE (non-panel) part of the map, never partly behind the docked panel --
// `src/lib/map/camera.ts#paddedStudyAreaCenter` + `src/lib/map/chromePadding.ts`, wired once at map
// construction in Shell.svelte. (2) a honeycomb loader covers the map until the first tile settles
// ("idle"), announced politely, then replaced by "Map ready" -- never blocking a click (`pointer-
// events: none`, shell.css).
//
// An explicit `?map=` is a real, user-chosen camera and is NEVER second-guessed (`initialStudyArea`
// in Shell.svelte checks `sel.map` first) -- proven by the SAME reference point landing at the
// UNPADDED canvas center when the URL supplies that exact camera. HERMETIC, same convention as
// e2e/keyboard-walk.spec.ts (whose minimal `units: []` boot this file borrows, so no PMTiles/
// titiler route is needed).
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { routeBasemapStyle, routeGlyphs } from "./map-hermetic";

const BOOT = {
  ver: "v7",
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  grid: { grid_id: "test05r" },
  release: { status: "release", access: "public" },
  units: [],
  zones: { programarea: [] },
  datasets: [],
  layers: [],
};

// the FALLBACK study area (src/lib/map/interaction.ts#FALLBACK_FULL_STUDY_AREA) -- what this
// fixture's boot (no `study_areas`) resolves to either way.
const FALLBACK = { lon: -101.304, lat: 46.9, zoom: 2.16 };

async function gotoMap(page: Page, path: string) {
  await routeBucket(page, "v7", BOOT);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(path);
  await waitForHydration(page);
  await page.waitForFunction(() => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap, {
    timeout: 15_000,
  });
}

async function projectFallback(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate((fb) => {
    const w = window as unknown as {
      __atlasMap: { handle: { map: { project(ll: [number, number]): { x: number; y: number } } } };
    };
    const p = w.__atlasMap.handle.map.project([fb.lon, fb.lat]);
    return { x: p.x, y: p.y };
  }, FALLBACK);
}

test.describe("usability M4: default camera padded for the docked panel", () => {
  test("no explicit ?map=: the fallback study area's point renders LEFT of canvas center (the docked panel reserves the right edge)", async ({
    page,
  }) => {
    await gotoMap(page, "/");
    const pt = await projectFallback(page);
    const viewportWidth = 1280;
    expect(pt.x, "still on screen").toBeGreaterThan(0);
    expect(pt.x, "shifted meaningfully left of canvas center").toBeLessThan(viewportWidth / 2 - 50);
  });

  test("an explicit ?map= matching the SAME point is never padded (a real camera is not second-guessed)", async ({
    page,
  }) => {
    await gotoMap(page, `/?map=${FALLBACK.lon},${FALLBACK.lat},${FALLBACK.zoom}`);
    const pt = await projectFallback(page);
    const viewportWidth = 1280;
    // unpadded: the point lands at (approximately) the canvas's own center.
    expect(Math.abs(pt.x - viewportWidth / 2)).toBeLessThan(20);
  });

  test("collapsing the panel (no reserved space) renders the point close to canvas center", async ({
    page,
  }) => {
    // seed the "shell" panel collapsed BEFORE the app's own script runs, the same technique
    // e2e/scores.collapsed-panel.spec.ts uses -- Panel.svelte only reads this once, in onMount.
    await page.addInitScript(
      ([k, v]) => {
        try {
          window.localStorage.setItem(k, v);
        } catch {
          /* private mode -- the default (uncollapsed, padded) case just applies instead */
        }
      },
      [
        "atlas.panel.shell.desktop",
        JSON.stringify({ collapsed: true, maximized: false, dock: "right", size: 380 }),
      ] as const,
    );
    await gotoMap(page, "/");
    const pt = await projectFallback(page);
    expect(Math.abs(pt.x - 1280 / 2)).toBeLessThan(20);
  });
});

/** identical to `gotoMap`, except the basemap style.json is DELAYED -- so the loader is still up
 * right after hydration, deterministically, rather than racing a near-instant hermetic fixture.
 * NOT `gotoMap` + a second `routeBasemapStyle()` call before it: `gotoMap` registers its OWN
 * (undelayed) basemap route internally, and Playwright matches routes in REVERSE registration
 * order (this file's other helpers' own convention) -- a route registered before `gotoMap` runs
 * would be shadowed by `gotoMap`'s, not the other way round. */
async function gotoMapSlowBasemap(page: Page, styleJsonDelayMs: number) {
  await routeBucket(page, "v7", BOOT);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeBasemapStyle(page, { styleJsonDelayMs });
  await routeGlyphs(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await waitForHydration(page);
}

test.describe("usability M4: the loading honeycomb", () => {
  test("visible at first paint, announced, then replaced by 'Map ready' once the map settles", async ({
    page,
  }) => {
    await gotoMapSlowBasemap(page, 2000);
    const loader = page.locator('[data-testid="map-loading"]');

    await expect(loader).toBeVisible();
    await expect(loader).toContainText("Map loading");
    // `pointer-events: none` -- it must never intercept a click meant for the map/topbar beneath.
    await expect(loader).toHaveCSS("pointer-events", "none");
    // this loader's OWN dedicated region, not the shared Announcer's -- see Shell.svelte's
    // `hideMapLoader` for why (CI run 35956406448: the shared one raced three unrelated specs'
    // own announcements). Both carry `role="status"`, so a bare `[role="status"]` locator here
    // would match two elements.
    const liveRegion = page.locator('[data-testid="map-loading-status"]');
    await expect(liveRegion).toContainText("Map loading");

    await expect(loader).toBeHidden({ timeout: 15_000 });
    await expect(liveRegion).toContainText("Map ready");
  });

  test("the loader never obstructs a click meant for the topbar or the map (pointer-events: none, and confined to .stage)", async ({
    page,
  }) => {
    await gotoMapSlowBasemap(page, 2000);
    const loader = page.locator('[data-testid="map-loading"]');
    await expect(loader).toBeVisible();

    // the deterministic proof: at the theme button's own center, the topmost element under the
    // pointer is the button (or one of its own descendants), never the loader -- true regardless
    // of the app's own click-handling reactivity, which is what makes this immune to unrelated
    // timing flakiness in a full end-to-end click assertion.
    const themeBox = await page.locator('[data-control="theme"]').boundingBox();
    expect(themeBox, "theme button has no box").not.toBeNull();
    const underPointer = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("[data-control='theme']") !== null,
      [themeBox!.x + themeBox!.width / 2, themeBox!.y + themeBox!.height / 2] as const,
    );
    expect(underPointer, "the loader (or anything else) sits on top of the theme button").toBe(
      true,
    );

    // and the loader is confined to `.stage` -- it never reaches OVER the topbar row at all (a
    // second, structural reason a topbar click is always safe, independent of pointer-events).
    const loaderBox = await loader.boundingBox();
    const topbarBox = await page.locator(".topbar").boundingBox();
    expect(loaderBox!.y).toBeGreaterThanOrEqual(topbarBox!.y + topbarBox!.height - 1);

    // and a real click still gets through end to end.
    const before = await page.locator("html").getAttribute("data-theme");
    await page.locator('[data-control="theme"]').click();
    await expect
      .poll(() => page.locator("html").getAttribute("data-theme"), {
        message: "the theme click had no effect while the loader was up",
      })
      .not.toBe(before);
  });
});
