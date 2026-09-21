import { expect, test, type Page } from "@playwright/test";

// atlas-0 Deliverable 5: the one smoke spec. Runs against the built production bundle served by
// `vite preview` (see playwright.config.ts webServer), across chromium/webkit/firefox.

// The early-fetch script (index.html) unconditionally probes these same-origin files (plan D2/D6):
// latest.txt, versions.json, session.json. This build ships none of them — no release has been
// published to this dist/ — so all three legitimately 404, exactly like a real GitHub Pages deploy
// before atlas-1 (or the public host, for session.json, forever). Chromium and WebKit (not Firefox)
// surface a fetch()'s non-2xx response as a console "error" regardless of the .catch() that already
// turns it into a safe default (see src/lib/release/{version,session}.ts and their unit tests) — so
// this is the ONE class of message the spec allows through; anything else still fails it.
const EXPECTED_MISSING_FILES = new Set(["latest.txt", "versions.json", "session.json"]);

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const url = msg.location()?.url ?? "";
    const basename = url.split("/").pop() ?? "";
    if (msg.text().includes("Failed to load resource") && EXPECTED_MISSING_FILES.has(basename)) return;
    errors.push(`[${msg.type()}] ${msg.text()} (${url})`);
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test.describe("shell smoke", () => {
  test("index.html paints the static shell with zero console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);

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

    // let the early-fetch promises and the Svelte mount settle. Against this static preview server
    // none of latest.txt/versions.json/session.json exist, so every one of them must resolve to a
    // safe default (public / unresolved version) without throwing or logging anything.
    await page.waitForTimeout(250);

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
