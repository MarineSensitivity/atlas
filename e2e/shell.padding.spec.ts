// WP13 (ported from oceanmetrics/atlas): the map's centre -- and the globe, when the sphere
// projection is on -- sits in the part of the stage the docked panel leaves open, whether the panel
// is expanded, collapsed to the rail, or maximized. `src/lib/map/livePadding.ts` turns the shell's
// chrome reserve into MapLibre padding; `Shell.svelte` applies it once the chrome settles. The pure
// rules are unit-tested (tests/map/livePadding.test.ts); this spec proves the shell wires them.
// HERMETIC: same fixtures as shell.firstview.spec.ts.
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

const VIEWPORT = { width: 1280, height: 800 };
// rail (80) + the panel's outer inset (12) + the panel's own width (380) -- the 20 px fit gutter is
// not part of the live padding (it is a fit concept)
const PANEL_OPEN = 80 + 12 + 380;
// the collapsed panel leaves only the rail: 80 - 8 (rail gap) + 12 inset
const RAIL_ONLY = 80 - 8 + 12;

type Pad = { top: number; right: number; bottom: number; left: number };

async function seedPanel(page: Page, geom: object) {
  await page.addInitScript(
    ([k, v]) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* private mode -- the default geometry just applies instead */
      }
    },
    ["atlas.panel.shell.desktop", JSON.stringify(geom)] as const,
  );
}

async function gotoMap(page: Page, path: string) {
  await routeBucket(page, "v7", BOOT);
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(path);
  await waitForHydration(page);
  await page.waitForFunction(() => !!(window as unknown as { __atlasMap?: unknown }).__atlasMap, {
    timeout: 15_000,
  });
}

const padding = (page: Page): Promise<Pad> =>
  page.evaluate(
    () =>
      (
        window as unknown as { __atlasMap: { handle: { map: { getPadding(): Pad } } } }
      ).__atlasMap.handle.map.getPadding() as Pad,
  );

/** poll until the map has stopped moving and the padding satisfies `ok` (the settle eases 250 ms) */
async function settledPadding(page: Page, ok: (p: Pad) => boolean): Promise<Pad> {
  await expect
    .poll(async () => ok(await padding(page)), { message: "padding never settled" })
    .toBe(true);
  return padding(page);
}

/** where the map's own centre is drawn, in canvas px */
const centrePx = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const map = (
      window as unknown as {
        __atlasMap: {
          handle: {
            map: {
              getCenter(): { lng: number; lat: number };
              project(ll: [number, number]): { x: number; y: number };
            };
          };
        };
      }
    ).__atlasMap.handle.map;
    const c = map.getCenter();
    const p = map.project([c.lng, c.lat]);
    return { x: p.x, y: p.y };
  });

test.describe("WP13: the map's centre follows the open area of the stage", () => {
  test("panel expanded on the left: padding reserves rail + panel, and the centre is drawn mid-open-area", async ({
    page,
  }) => {
    await seedPanel(page, { collapsed: false, maximized: false, dock: "left", size: 380 });
    await gotoMap(page, "/");
    const pad = await settledPadding(page, (p) => p.left === PANEL_OPEN);
    expect(pad.right).toBe(0);
    const c = await centrePx(page);
    expect(Math.abs(c.x - (PANEL_OPEN + VIEWPORT.width) / 2)).toBeLessThan(2);
  });

  test("the padding at first paint is the padding after the map settles (no estimate-vs-measured drift)", async ({
    page,
  }) => {
    await seedPanel(page, { collapsed: false, maximized: false, dock: "left", size: 380 });
    // sample the padding the moment the map exists, before `load` re-measures the stage: a fit made
    // in that window (species / zone / a deep link) is solved against THIS padding, so it must
    // already be the settled one or the same fit lands somewhere else a moment later
    await page.addInitScript(() => {
      const w = window as unknown as {
        __firstPad?: unknown;
        __atlasMap?: { handle: { map: { getPadding(): unknown } } };
      };
      let v: unknown;
      Object.defineProperty(w, "__atlasMap", {
        configurable: true,
        get: () => v,
        set: (x) => {
          v = x;
          w.__firstPad = {
            ...((x as NonNullable<typeof w.__atlasMap>).handle.map.getPadding() as object),
          };
        },
      });
    });
    await gotoMap(page, "/");
    const settled = await settledPadding(page, (p) => p.left === PANEL_OPEN);
    const first = await page.evaluate(() => (window as unknown as { __firstPad?: Pad }).__firstPad);
    expect(first, "padding at first paint").toEqual(settled);
  });

  test("panel collapsed: only the rail is reserved, so the centre moves back toward the stage middle", async ({
    page,
  }) => {
    await seedPanel(page, { collapsed: true, maximized: false, dock: "left", size: 380 });
    await gotoMap(page, "/");
    const pad = await settledPadding(page, (p) => p.left === RAIL_ONLY);
    expect(pad.right).toBe(0);
    const c = await centrePx(page);
    expect(Math.abs(c.x - (RAIL_ONLY + VIEWPORT.width) / 2)).toBeLessThan(2);
  });

  test("panel docked on the right mirrors it", async ({ page }) => {
    await seedPanel(page, { collapsed: false, maximized: false, dock: "right", size: 380 });
    await gotoMap(page, "/");
    const pad = await settledPadding(page, (p) => p.right === PANEL_OPEN);
    expect(pad.left).toBe(0);
    const c = await centrePx(page);
    expect(Math.abs(c.x - (VIEWPORT.width - PANEL_OPEN) / 2)).toBeLessThan(2);
  });

  test("Table takes the full stage: nothing of the map is open, so no side padding (the view stays centred on the stage)", async ({
    page,
  }) => {
    await seedPanel(page, { collapsed: false, maximized: false, dock: "left", size: 380 });
    await gotoMap(page, "/");
    await settledPadding(page, (p) => p.left === PANEL_OPEN);
    // `maximized` is derived from the tool now (panelGeometry.ts), never a stored preference
    await page
      .locator('#rail-region [role="toolbar"]')
      .getByRole("button", { name: "Table", exact: true })
      .click();
    const pad = await settledPadding(page, (p) => p.left === 0 && p.right === 0);
    expect(pad.bottom).toBe(0);
    const c = await centrePx(page);
    expect(Math.abs(c.x - VIEWPORT.width / 2)).toBeLessThan(2);
  });

  test("collapsing the panel at runtime eases the padding to the rail-only reserve", async ({
    page,
  }) => {
    await seedPanel(page, { collapsed: false, maximized: false, dock: "left", size: 380 });
    await gotoMap(page, "/");
    await settledPadding(page, (p) => p.left === PANEL_OPEN);
    // the active spine entry toggles: clicking it collapses the panel (CLAUDE.md, round-4 lessons)
    await page.locator('[aria-current="true"]').first().click();
    await settledPadding(page, (p) => p.left === RAIL_ONLY);
  });
});
