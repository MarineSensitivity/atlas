import { expect, test } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession } from "./hermetic";

// atlas-8 Deliverable 4 (beta feedback, zero backend): the real "Report a problem" control, in a
// real browser, with a real place drawn into the hash -- the one thing a unit test (which never
// touches `location` at all -- see tests/feedback/noHash.test.ts's whole point) cannot prove: that
// the ACTUAL rendered `href`, read off the real DOM, never carries the fragment. HERMETIC, same
// convention as every other shell spec (e2e/hermetic.ts) -- no request ever reaches the live network.

const SECRET_PLACE = "g1.test.SECRET-GEOMETRY-XYZ";

async function gotoShellWithPlace(page: import("@playwright/test").Page) {
  await routeBucket(page);
  await routeSession(page, null);
  await routeSealFixture(page);
  // `ver`/`lens`/`pal` in the query (none at their own default, so all three round-trip); the place
  // lives ONLY in the hash, exactly like a real drawn place would (plan D8).
  await page.goto(`/?ver=v7&lens=species&pal=viridis#pl=${SECRET_PLACE}`, {
    waitUntil: "networkidle",
  });
}

/** the issue body ("body" query param), fully decoded -- `URLSearchParams.get` already does the
 * decoding, so this never double-decodes (which can throw on a literal "%" in the text). */
function issueBody(href: string): string {
  return new URL(href).searchParams.get("body") ?? "";
}

test.describe("Report a problem: the control's href never carries the hash", () => {
  test("real browser: hash is present in location, absent from the control's href", async ({
    page,
  }) => {
    await gotoShellWithPlace(page);

    // sanity: the secret really is in the live location before we check the control -- otherwise a
    // passing assertion below could just mean the setup silently failed to carry it at all.
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain(SECRET_PLACE);

    const link = page.locator('[data-control="feedback"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();

    expect(href).not.toContain("#");
    expect(href).not.toContain("pl=");
    expect(href).not.toContain(SECRET_PLACE);

    // the version, lens and query ARE kept -- only the fragment is stripped.
    const url = new URL(href as string);
    expect(url.hostname).toBe("github.com");
    expect(url.pathname).toBe("/MarineSensitivity/atlas/issues/new");
    expect(url.searchParams.get("labels")).toBe("beta-feedback");

    const body = issueBody(href as string);
    expect(body).not.toContain("#");
    expect(body).not.toContain(SECRET_PLACE);
    expect(body).toContain("Lens: species");
    expect(body).toContain("Release: v7");

    // the query the address bar actually shows (formatSel's own defaults-omitted form) is exactly
    // what the issue body's "URL:" line carries -- proving "query kept" against the REAL app, not
    // just a hand-built fixture.
    const addressBarQuery = await page.evaluate(() => window.location.search);
    expect(addressBarQuery).toContain("ver=v7");
    expect(addressBarQuery).toContain("lens=species");
    expect(addressBarQuery).toContain("pal=viridis");
    const pageOriginAndPath = await page.evaluate(() => location.origin + location.pathname);
    expect(body).toContain(`- URL: ${pageOriginAndPath}${addressBarQuery}`);
  });

  test("a real <a target=_blank rel=noopener>, keyboard-reachable, with an accessible name", async ({
    page,
  }) => {
    await gotoShellWithPlace(page);
    const link = page.locator('[data-control="feedback"]');
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    expect(await link.evaluate((el) => el.tagName)).toBe("A");

    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveAccessibleName(/report a problem/i);
  });

  test("the href is recomputed when the lens changes, never frozen at mount", async ({ page }) => {
    await gotoShellWithPlace(page);
    const link = page.locator('[data-control="feedback"]');
    const before = await link.getAttribute("href");
    expect(issueBody(before as string)).toContain("Lens: species");

    await page.locator(".topbar").getByRole("button", { name: "Scores" }).click();

    await expect
      .poll(async () => issueBody((await link.getAttribute("href")) as string))
      .toContain("Lens: scores");
    // and the OLD value is gone -- this is a live recompute, not an appended second line.
    const after = await link.getAttribute("href");
    expect(issueBody(after as string)).not.toContain("Lens: species");
  });
});
