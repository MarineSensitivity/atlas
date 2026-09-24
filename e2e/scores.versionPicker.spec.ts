// atlas-4 step 3 — D15's e2e gate: "?ver=v9 on the public host shows the notice, its link is the
// preview URL with the same #, and zero requests are made under /v9/". The "zero requests" half
// is already covered by e2e/shell.smoke.spec.ts's release-access gate (unchanged, atlas-2/3); this
// spec covers the NEW half — the notice itself and its link.
//
// round 2, Q4 (P8 item 8, deferred): the preview host has not deployed the Atlas's own
// `/{ver}/atlas/` route yet (atlas-9), so `previewLinkFor` is now gated behind the build-time
// `VITE_PREVIEW_ATLAS_ROUTE` flag (previewLink.ts) -- unset by default, which is what THIS spec's
// own build carries (playwright.config.ts's `webServer` runs a plain `npm run build`, same as
// every other spec here, e2e/report.export.spec.ts's own header). The first test below therefore
// changed from asserting the atlas link's href to asserting its ABSENCE plus the honest fallback
// sentence and working Scores/Species links -- this is the red-first proof of the gate itself.
// `tests/release/previewLink.test.ts` covers BOTH values of the flag at the pure-function level.
import { expect, test } from "@playwright/test";
import {
  collectRequests,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";

test.describe("D15: the restricted-version notice on the public host", () => {
  test("?ver=v9: with VITE_PREVIEW_ATLAS_ROUTE unset, no /atlas/ preview link renders -- the honest fallback (Scores/Species) does instead (round 2, Q4)", async ({
    page,
  }) => {
    const requests = collectRequests(page);
    await routeBucket(page); // default latest = v7; v9 is `restricted` per VERSIONS_FIXTURE
    await routeSession(page, null); // public host: no session.json
    await routeSealFixture(page);
    await page.goto("/?ver=v9&area=GA#pl=xyz");
    await waitForHydration(page);

    const dialog = page.getByRole("dialog", { name: "Data release" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("v9");
    await expect(dialog).toContainText("under review");

    // the gate itself: the not-yet-deployed atlas route is never linked, anywhere in the modal.
    await expect(dialog.getByRole("link", { name: "Continue on the preview host" })).toHaveCount(0);
    for (const link of await dialog.getByRole("link").all()) {
      expect(await link.getAttribute("href")).not.toMatch(/\/atlas\//);
    }

    const notice = dialog.locator(".denied-notice");
    await expect(notice).toContainText("The preview host does not serve the Atlas yet; open the");
    await expect(notice.getByRole("link", { name: "Scores" })).toHaveAttribute(
      "href",
      "https://preview.marinesensitivity.org/v9/scores/",
    );
    await expect(notice.getByRole("link", { name: "Species" })).toHaveAttribute(
      "href",
      "https://preview.marinesensitivity.org/v9/species/",
    );

    expect(requests.some((u) => /\/v9\//.test(u))).toBe(false);
  });

  test("the version chip opens the SAME modal for a manual look, listing every release", async ({
    page,
  }) => {
    await routeBucket(page);
    await routeSession(page, null);
    await routeSealFixture(page);
    await page.goto("/");
    await waitForHydration(page);

    await page.locator('[data-control="version-chip"]').click();
    const dialog = page.getByRole("dialog", { name: "Data release" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("v7");
    await expect(dialog).toContainText("v9");
    await expect(dialog.getByText("restricted")).toHaveCount(3); // v7b, v8, v9 in VERSIONS_FIXTURE

    // round 2, Q4: every restricted ROW (not just the denied notice) falls back the same way.
    await expect(dialog.getByRole("link", { name: "Continue on the preview host" })).toHaveCount(0);
  });
});
