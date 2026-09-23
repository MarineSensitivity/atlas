// atlas-8 review round 2, item m5: none of Shell.svelte's dynamic lens/tool `import()`s had a
// `.catch` -- a chunk-load failure left the target `$state` null FOREVER with no word to the user
// (the 0.10.17 symptom, one layer up). Fix: every import site announces through the shared live
// region (`announceChunkFailure()`), and the SAME `if (!Comp)` guard retries the next time its
// effect re-runs (a lens switch away and back). This aborts the real built `ScoresLens-*.js` chunk
// (the naming Vite actually produces, confirmed by a real `npm run build`) and proves the
// announcement fires while the rest of the shell still boots normally.
import { expect, test } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { routeBasemapStyle, routeGlyphs } from "./map-hermetic";

test.describe("item m5: a failed lazy-chunk import announces instead of failing silently", () => {
  test("the scores panel chunk fails to load -> the live region announces it, shell otherwise fine", async ({
    page,
  }) => {
    await routeBucket(page, "v7");
    await routeSession(page, null);
    await routeSealFixture(page);
    await routeBasemapStyle(page);
    await routeGlyphs(page);
    // the scores lens' own panel chunk -- the FIRST of Shell.svelte's dynamic imports, mirroring
    // hermetic.ts#blockAppBundle's own naming convention for the entry chunk.
    await page.route(
      (url) => /\/assets\/ScoresLens-[^/]*\.js$/.test(url.pathname),
      (route) => route.abort(),
    );

    await page.goto("/"); // default view: scores lens, "layers" tool
    await waitForHydration(page);

    // the rest of the shell is unaffected -- only the one aborted chunk failed.
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator("#rail-region")).toBeVisible();
    await expect(page.locator("#panel-region")).toBeVisible();

    const live = page.locator('[role="status"]').first();
    await expect(live).toContainText("Couldn't load the scores panel.", { timeout: 15_000 });

    // the guard: `ScoresLensComp` is still `null`, not some "already failed, never try again"
    // sentinel -- the fallback placeholder text (Shell.svelte's own `TOOL_BODY[activeTool]`)
    // renders in its place, never a permanently blank panel, and the SAME `if (!Comp)` check that
    // just ran is what a later re-run of this effect (a lens switch away and back) retries with.
    await expect(page.locator("#panel-region")).toContainText(
      "Layers, palette and outline options arrive in a later phase.",
    );

    // the rest of the shell is unaffected by the one failed chunk -- switching lenses still works.
    await page.getByRole("button", { name: "Species" }).click();
    await expect(page.locator(".search-field")).toBeVisible();
  });
});
