import { expect, test } from "@playwright/test";
import {
  BUCKET,
  collectConsoleErrors,
  collectRequests,
  mountUnder,
  routeBucket,
  routeSealFixture,
  routeSession,
} from "./hermetic";

// atlas-0 Deliverable 5: the smoke spec. Runs against the built production bundle served by
// `vite preview` (see playwright.config.ts webServer), across chromium/webkit/firefox.
//
// HERMETIC: the registry and every release file live in the S3 bucket, and this spec routes all of
// them to fixtures (e2e/hermetic.ts) — no test here ever touches the live network. That also makes
// the release-access gate (plan D6) testable end to end: the fixture registry marks v9 restricted,
// and the assertions are about which requests the browser did and did not make.

test.describe("shell smoke", () => {
  test("index.html paints the real shell (atlas-3 step 3) with zero console errors", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await routeBucket(page);
    await routeSession(page, null);
    await routeSealFixture(page);

    await page.goto("/");

    // the shell (top bar, tool rail, panel, map placeholder) is real by the time the page settles
    // -- the static skeleton (index.html's own inlined critical CSS + markup) already painted an
    // identical-geometry placeholder before this, which is what e2e/shell.cls.spec.ts measures.
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator("#rail-region")).toBeVisible();
    await expect(page.locator("#panel-region")).toBeVisible();
    await expect(page.locator("#map")).toBeVisible();
    // "Scores"/"Species" (the lens switch, top bar) and "Places"/"Report" (two of the rail's five
    // tools) are each a real, visible, accessibly-named control in the hydrated shell.
    for (const label of ["Scores", "Species"]) {
      await expect(page.locator(".topbar").getByRole("button", { name: label })).toBeVisible();
    }
    for (const label of ["Places", "Report"]) {
      await expect(page.locator("#rail-region").getByRole("button", { name: label })).toBeVisible();
    }

    // latest.txt = v7, a public release: it renders, and no PREVIEW badge appears. VersionBadge.svelte
    // (untouched by this step) still renders these exact classes.
    await expect(page.locator(".ms-version")).toHaveText("v7");
    await expect(page.locator(".ms-preview-badge")).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  // report.html's own smoke coverage moved to e2e/report.spec.ts (atlas-7 steps 2-4): this file's
  // one placeholder assertion (`#report-root[data-hydrated]`) described the atlas-7-step-1-era
  // stub, which report-main.ts no longer sets -- the real document needs the hermetic bucket/
  // session routing e2e/report.spec.ts already sets up, not a bare `page.goto`.
});

test.describe("release-access gate (plan D6)", () => {
  test("public host + ?ver=v9: not one request under /v9/, falls through to latest", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const urls = collectRequests(page);
    await routeBucket(page);
    await routeSession(page, null); // no session.json: this is the public host

    await page.goto("/?ver=v9");

    await expect(page.locator(".ms-version")).toHaveText("v7");
    await expect(page.locator(".ms-preview-badge")).toHaveCount(0);

    expect(urls.filter((u) => u.includes("/v9/"))).toEqual([]);
    expect(urls).toContain(`${BUCKET}v7/manifest.json`);
    expect(errors).toEqual([]);
  });

  test("/v9/atlas/ + session.json {preview:true}: v9's manifest comes from the bucket base", async ({
    page,
  }) => {
    const urls = collectRequests(page);
    await routeBucket(page);
    await mountUnder(page, "/v9/atlas/");
    await routeSession(page, { preview: true }); // registered last: wins over the mount rewrite

    await page.goto("/v9/atlas/");

    await expect(page.locator(".ms-version")).toHaveText("v9");
    await expect(page.locator(".ms-preview-badge")).toHaveText("PREVIEW");

    // the exact absolute URL — not /v9/atlas/v9/manifest.json, and not any same-origin path.
    expect(urls).toContain(`${BUCKET}v9/manifest.json`);
    expect(urls.filter((u) => u.includes("/v9/atlas/v9/"))).toEqual([]);
  });

  test("/v9/atlas/ + session.json 404: no v9 request at all", async ({ page }) => {
    const urls = collectRequests(page);
    await routeBucket(page);
    await mountUnder(page, "/v9/atlas/");
    await routeSession(page, null);

    await page.goto("/v9/atlas/");

    await expect(page.locator(".ms-version")).toHaveText("v7");
    await expect(page.locator(".ms-preview-badge")).toHaveCount(0);

    expect(urls.filter((u) => u.startsWith(BUCKET) && u.includes("/v9/"))).toEqual([]);
    expect(urls).toContain(`${BUCKET}v7/manifest.json`);
  });
});

test.describe("a failed bundle load (atlas-3 handover item (b), fix list #14)", () => {
  // the ONLY fallback used to be a <noscript>, which never runs when script IS enabled and just
  // broken -- with every asset blocked, the page sat there forever: a title, an h1, two dead skip
  // links and ten aria-hidden skeleton parts, announcing and showing nothing. Fix: `src/main.ts`
  // sets `data-hydrated` on `<html>` right after `mount()` returns; index.html's own timed inline
  // script reveals a plain, visible `role="alert"` message if that attribute is still absent 8s
  // after the script starts. REVERTED (this fix alone) -> RED: no `#bundle-load-failed` element
  // ever appears, however long the test waits.
  test("index.html reveals a visible role=alert message when the bundle never runs", async ({
    page,
  }) => {
    await routeBucket(page);
    await routeSession(page, null);
    await routeSealFixture(page);
    await page.route("**/assets/*.js", (route) => route.abort());

    await page.goto("/");

    // the skeleton paints regardless -- it is plain static HTML/CSS, no JS required.
    await expect(page.locator("#rail-region")).toBeVisible();

    const message = page.locator("#bundle-load-failed");
    await expect(message).toBeVisible({ timeout: 12_000 });
    await expect(message).toHaveAttribute("role", "alert");
    await expect(message).toContainText("could not load its application code");
    // genuinely on screen, not clipped/zero-size the way the visually-hidden map equivalent is.
    const box = await message.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(10);
    expect(box?.height ?? 0).toBeGreaterThan(10);
  });

  test("a bundle that DOES run never shows the fallback message", async ({ page }) => {
    await routeBucket(page);
    await routeSession(page, null);
    await routeSealFixture(page);

    await page.goto("/");
    await expect(page.locator("#rail-region .rail")).toBeAttached();
    // well past the 8s timer, on a page that DID hydrate: the message must never fire.
    await page.waitForTimeout(9000);
    await expect(page.locator("#bundle-load-failed")).toHaveCount(0);
  });
});
