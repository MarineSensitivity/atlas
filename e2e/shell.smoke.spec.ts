import { expect, test, type Page } from "@playwright/test";

// atlas-0 Deliverable 5: the smoke spec. Runs against the built production bundle served by
// `vite preview` (see playwright.config.ts webServer), across chromium/webkit/firefox.
//
// HERMETIC: the registry and every release file live in the S3 bucket, and this spec routes all of
// them to fixtures — no test here ever touches the live network. That also makes the release-access
// gate (plan D6) testable end to end: the fixture registry marks v9 restricted, and the assertions
// are about which requests the browser did and did not make.

const BUCKET = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/";

/** the registry shape, matching the real versions.json (orchestrator-verified 2026-09-21). */
const VERSIONS_FIXTURE = [
  { ver: "v7", status: "release", access: "public", prev: "v6", released: "2026-09-12" },
  { ver: "v7b", status: "prerelease", access: "restricted", prev: "v7", released: "2026-09-20" },
  { ver: "v8", status: "prerelease", access: "restricted", prev: "v7", released: "2026-08-02" },
  { ver: "v9", status: "prerelease", access: "restricted", prev: "v8", released: "2026-09-05" },
];

// session.json (same-origin, the one door into preview mode) legitimately 404s on the public host,
// and {ver}/app/boot.json does not exist until atlas-1 — both are swallowed into safe defaults by
// the early-fetch script. Chromium and WebKit (not Firefox) still surface a fetch()'s non-2xx as a
// console "error" regardless of the .catch() — so this is the ONE class of message the spec allows
// through; anything else still fails it.
const EXPECTED_MISSING_FILES = new Set(["session.json", "boot.json"]);

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const url = msg.location()?.url ?? "";
    const basename = url.split("/").pop() ?? "";
    if (msg.text().includes("Failed to load resource") && EXPECTED_MISSING_FILES.has(basename))
      return;
    errors.push(`[${msg.type()}] ${msg.text()} (${url})`);
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

/** every URL the page requested, so a test can assert what was NOT fetched. */
function collectRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => urls.push(req.url()));
  return urls;
}

/** fixture responses for the bucket: latest.txt, versions.json and each release's manifest. */
async function routeBucket(page: Page, latest = "v7") {
  await page.route(
    (url) => url.href.startsWith(BUCKET),
    async (route) => {
      const path = route.request().url().slice(BUCKET.length);
      if (path.startsWith("latest.txt")) {
        return route.fulfill({ status: 200, contentType: "text/plain", body: `${latest}\n` });
      }
      if (path.startsWith("versions.json")) {
        return route.fulfill({ status: 200, json: VERSIONS_FIXTURE });
      }
      const manifest = /^(v[0-9]+[a-z]?)\/manifest\.json/.exec(path);
      if (manifest) {
        return route.fulfill({ status: 200, json: { ver: manifest[1], capabilities: {} } });
      }
      return route.fulfill({ status: 404, body: "" }); // app/boot.json: not published until atlas-1
    },
  );
}

/**
 * Serve the same dist/ under a version-prefixed path, the preview host's shape
 * (`preview.marinesensitivity.org/{ver}/atlas/`, plan D1/D2). Rewrites the prefix away and fetches
 * from the preview server's root — which also proves the build's asset URLs are relative.
 */
async function mountUnder(page: Page, prefix: string) {
  await page.route(
    (url) => url.pathname.startsWith(prefix),
    async (route) => {
      const url = new URL(route.request().url());
      url.pathname = url.pathname.slice(prefix.length - 1);
      route.fulfill({ response: await route.fetch({ url: url.toString() }) });
    },
  );
}

/** the same-origin session.json: absent (public host) or a signed-in preview body. */
async function routeSession(page: Page, body: object | null) {
  await page.route(
    (url) => url.pathname.endsWith("/session.json"),
    (route) =>
      body
        ? route.fulfill({ status: 200, json: body })
        : route.fulfill({ status: 404, body: "not found" }),
  );
}

test.describe("shell smoke", () => {
  test("index.html paints the static shell with zero console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await routeBucket(page);
    await routeSession(page, null);

    await page.goto("/");

    // the static shell (topbar, tool rail, panel skeleton, map placeholder) paints from HTML +
    // inlined CSS alone (plan atlas-0 Deliverable 2: "shell that paints with no JavaScript bundle").
    await expect(page.locator(".ms-topbar")).toBeVisible();
    await expect(page.locator(".ms-rail")).toBeVisible();
    await expect(page.locator("#panel")).toBeVisible();
    await expect(page.locator("#map")).toBeVisible();
    for (const label of ["Scores", "Species", "Places", "Report"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }

    // latest.txt = v7, a public release: it renders, and no PREVIEW badge appears.
    await expect(page.locator(".ms-version")).toHaveText("v7");
    await expect(page.locator(".ms-preview-badge")).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("report.html paints with zero console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/report.html");

    await expect(page.locator("#report-root")).toBeVisible();
    await expect(page.locator("#report-root")).toHaveAttribute("data-hydrated", "true");

    expect(errors).toEqual([]);
  });
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
