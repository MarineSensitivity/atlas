// 0.10.21 fix 1's own regression gate (the owner's live 0.10.17 report): `Panel.svelte` renders its
// children only while `!geometry.collapsed` (desktop; the geometry is remembered PER VIEWPORT SIZE
// in localStorage, `src/lib/ui/panelGeometry.ts` — `Sheet.svelte`'s phone body always renders, just
// CSS-hidden at "peek", which is why the phone was never affected). Before the fix, the scores
// lens' `composeStyle` contribution (`mapExtra`) was computed ONLY inside an `$effect` in
// `ScoresLens.svelte`, the panel body itself, written back to Shell.svelte through a
// `bind:mapExtra` prop. Collapse the desktop panel and that component never mounts at all, so
// `mapExtra` stayed `{}` forever — the score raster (and its floating legend) never painted, even
// though the map itself was fully visible.
//
// The fix moved that computation into a lens-level store (`src/lens/scores/state.svelte.ts`'s
// `createScoresLens()`) Shell.svelte instantiates whenever `sel.lens === "scores"`, independent of
// the panel/sheet ever mounting a single DOM node (docs/map.md's "map inputs belong to a lens-level
// store the shell instantiates whenever the lens is selected; the panel renders UI only" rule).
//
// This spec seeds the SAME localStorage key `Panel.svelte` itself reads/writes
// (`panelStorageKey("shell", "desktop")`, confirmed against `src/lib/ui/panelGeometry.ts` rather
// than hand-typed) via `page.addInitScript` — BEFORE the app's own script ever runs — so the panel
// is collapsed from the very first paint. That reproduces the owner's report exactly, not a
// synthetic "click collapse after load" sequence that would leave a window where the panel (and
// therefore the old bug's `ScoresLens.svelte` mount) was briefly open.
//
// Reuses `e2e/scores-hermetic.ts`'s `gotoScoresMap`/`readPixel`/`OCEAN_PROBES`/`BLENDED_RASTER_RGB`
// (split out of `e2e/scores.firstpaint.spec.ts` for exactly this reuse) rather than copy-pasting
// the v7 boot-fixture apparatus.
import { expect, test, type Page } from "@playwright/test";
import { panelStorageKey, type PanelGeometry } from "../src/lib/ui/panelGeometry";
import { BLENDED_RASTER_RGB, gotoScoresMap, OCEAN_PROBES, readPixel } from "./scores-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

const COLLAPSED_GEOMETRY: PanelGeometry = { collapsed: true, detent: "half" };

/** seeds the "shell" panel's desktop geometry as collapsed, BEFORE any app script runs (never
 * after `goto` — a post-load `localStorage.setItem` would not reproduce the bug, since
 * `Panel.svelte` only reads this once, in its own `onMount`). */
async function seedCollapsedShellPanel(page: Page): Promise<void> {
  const key = panelStorageKey("shell", "desktop");
  const value = JSON.stringify(COLLAPSED_GEOMETRY);
  await page.addInitScript(
    ([k, v]) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        // private mode / storage disabled -- the same "chrome, not correctness" guard
        // panelGeometry.ts's own loadPanelGeometry/savePanelGeometry apply; a spec run under
        // those conditions simply exercises the (never-collapsed) default instead.
      }
    },
    [key, value] as const,
  );
}

test.describe("0.10.21 fix 1: a COLLAPSED desktop scores panel still paints the raster + legend", () => {
  test("panel collapsed at load, raster painted at both ocean probes, floating legend visible", async ({
    page,
  }) => {
    // two probes at up to 40s of polling each (below) can exceed Playwright's 30s default test
    // timeout on its own -- widen the TEST's own budget, same as scores.firstpaint.spec.ts.
    test.setTimeout(90_000);
    await seedCollapsedShellPanel(page);
    await gotoScoresMap(page, "v7");

    // (a) the seed actually took -- the panel really is collapsed, not just intended to be. Same
    // selectors e2e/keyboard-walk.spec.ts already uses for this component's collapsed state.
    await expect(page.locator("#panel-region .panel-pill")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#panel-region .panel-surface")).toHaveCount(0);

    // (b) painted raster pixels at the two ocean probe points -- the bug: this used to stay the
    // basemap colour forever, because `ScoresLens.svelte` (the only place `mapExtra.raster` was
    // ever computed, pre-fix) was never mounted while the panel body never rendered a DOM node.
    await page.waitForFunction(() => !!window.__atlasMap!.handle.map.getLayer("r_lyr"), undefined, {
      timeout: 20_000,
    });
    for (const [lon, lat] of OCEAN_PROBES) {
      await expect
        .poll(async () => (await readPixel(page, lon, lat))?.slice(0, 3).join(","), {
          message: `no score raster pixel painted at ${lon},${lat} with the panel collapsed`,
          timeout: 40_000,
        })
        .toBe(BLENDED_RASTER_RGB.join(","));
    }

    // (c) the floating Scores legend is visible -- the OTHER thing the old, panel-mount-bound
    // `mapExtra` used to gate (`ScoresLegend.svelte` reads it the same way the raster does).
    const legend = page.locator('[data-testid="scores-legend"]');
    await expect(legend).toBeVisible({ timeout: 10_000 });
  });
});

/** fires the real click event MapLibre's own `map.on("click", ...)` listener receives -- same
 * technique as `e2e/scores.popup.spec.ts`'s own `fireMapClick` (not imported from there: that
 * file's helper is local to it, matching this repo's existing convention of small, per-spec
 * copies rather than a shared e2e util for a two-line function). */
async function fireMapClick(page: Page, lngLat: { lng: number; lat: number }): Promise<void> {
  await page.evaluate((ll) => {
    (
      window as unknown as {
        __atlasMap: { handle: { map: { fire(type: string, props: object): void } } };
      }
    ).__atlasMap.handle.map.fire("click", { lngLat: ll, point: { x: 0, y: 0 } });
  }, lngLat);
}

// review item M1: the click handler used to live INSIDE ScoresLens.svelte (the panel body), so a
// collapsed panel or the Places tool open meant a click did nothing at all -- no `sel=cell:`, no
// popup, no announcement. Fixed by moving click -> selection -> popup to a lens-level owner
// (`state.svelte.ts#handleMapClick`) Shell.svelte calls directly, regardless of the panel/tool.
test.describe("review M1: a scores click works with no panel mounted at all", () => {
  test("panel collapsed at load: a click still writes sel=cell: and shows the popup", async ({
    page,
  }) => {
    await seedCollapsedShellPanel(page);
    await gotoScoresMap(page, "v7");
    await expect(page.locator("#panel-region .panel-pill")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#panel-region .panel-surface")).toHaveCount(0);

    await fireMapClick(page, { lng: OCEAN_PROBES[0][0], lat: OCEAN_PROBES[0][1] });

    await expect.poll(() => new URL(page.url()).search).toContain("sel=cell:");
    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });
  });

  test("the Places tool open (not the scores panel): a click still writes sel=cell: and shows the popup", async ({
    page,
  }) => {
    await gotoScoresMap(page, "v7");
    // switch to Places -- ScoresLens.svelte (the scores panel body) never mounts while this tool
    // is active, the SAME "no panel body" condition the collapsed case above reproduces a
    // different way (M1's review text: "or the Places tool open").
    await page.getByRole("button", { name: "Places" }).click();
    await expect(page.locator("#panel-region")).toContainText(/Turn on pick mode|places/i, {
      timeout: 10_000,
    });

    await fireMapClick(page, { lng: OCEAN_PROBES[0][0], lat: OCEAN_PROBES[0][1] });

    await expect.poll(() => new URL(page.url()).search).toContain("sel=cell:");
    await expect(page.locator(".atlas-popup")).toBeVisible({ timeout: 15_000 });
  });
});

// usability M3: a rail click on a collapsed desktop panel used to leave it collapsed -- only the
// clicked pill's own label text changed, so the tool the user just picked never actually rendered.
test.describe("usability M3: a rail click un-collapses a collapsed desktop panel", () => {
  test("panel collapsed at load, click a rail tool -> the panel body renders", async ({ page }) => {
    await seedCollapsedShellPanel(page);
    await gotoScoresMap(page, "v7");
    await expect(page.locator("#panel-region .panel-pill")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#panel-region .panel-surface")).toHaveCount(0);

    await page.getByRole("button", { name: "Table" }).click();

    await expect(page.locator("#panel-region .panel-surface")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#panel-region .panel-pill")).toHaveCount(0);
    await expect(page.locator(".panel-title")).toHaveText("Table");
  });
});
