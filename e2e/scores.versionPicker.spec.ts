// atlas-4 step 3 — D15's e2e gate: "?ver=v9 on the public host shows the notice, its link is the
// preview URL with the same #, and zero requests are made under /v9/". The "zero requests" half
// is already covered by e2e/shell.smoke.spec.ts's release-access gate (unchanged, atlas-2/3); this
// spec covers the NEW half — the notice itself and its link.
import { expect, test } from "@playwright/test";
import {
  collectRequests,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";

test.describe("D15: the restricted-version notice on the public host", () => {
  test("?ver=v9 shows a denial notice with a preview-host link carrying the same query + hash", async ({
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

    const link = dialog.getByRole("link", { name: "Continue on the preview host" }).first();
    await expect(link).toHaveAttribute(
      "href",
      "https://preview.marinesensitivity.org/v9/atlas/?ver=v9&area=GA#pl=xyz",
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
  });
});
