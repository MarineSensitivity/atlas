// B5 (docs/usability.md §4/§3.5): "Download HTML: white text on a light page (no data-theme on the
// exported root); seal remote so missing offline."
//
// Root cause: `assembleStandaloneHtml()` (src/report/exportHtml.ts) built a fresh `<html>` tag with
// no `data-theme` -- `tokens.css`'s bare `:root` (no attribute) IS the dark "navy" theme
// (`--text-primary: #ffffff`), so the exported document's own inlined CSS painted every themed
// element with navy's values while `report.css`'s literal (non-token) backgrounds stayed light.
// `report.html` itself has always carried `data-theme="paper"` explicitly for the SAME reason
// (that file's own header comment) -- the export needed a copy of the same fix. The seal `<img>`
// carries a remote `src`; `cloneNode()` copies that same remote URL (and copies no event listener,
// so the live page's own `onerror` fallback never came along either), so the file showed a broken
// image once opened without a network.
//
// This spec follows e2e/report.spec.ts's OWN "Download HTML opens OFFLINE" test almost exactly
// (same `gotoReport`/`saveAs`/route-everything-to-abort recipe -- see that file's own comments for
// why `download.path()` alone is not enough and why routing beats `context({offline:true})`), but
// in a NEW file per this round's rules (never edit e2e/report.spec.ts) and with the TWO assertions
// that test specifically covers: body text contrast and the seal.
//
// The seal itself is build-time gated (`VITE_SEAL`/`VITE_AGENCY`, sealVisibility.ts) and this
// worktree's local build sets neither, so `.agency-lockup` never mounts here (same as every other
// e2e spec in this repo -- only e2e/gallery.spec.ts's own demo scaffold renders both branches
// unconditionally, precisely because it does NOT depend on the real env var). To exercise the FIX
// itself (not the separate, already-tested "does the seal show at all" gate), this spec injects one
// `.agency-lockup img` node carrying the SAME default remote URL `sealUrl` resolves to
// (`Report.svelte`), routed to the SAME seal fixture `gotoReport` already registers
// (`routeSealFixture`, hermetic.ts) -- so `fetchAsDataUrl(sealUrl)` (exportHtml.ts) fetches a real,
// hermetic image over the SAME route every other spec here already trusts, not a live one.
import { expect, test } from "@playwright/test";
import { gotoReport, PL, waitForMapCapture } from "./report-hermetic";

const SEAL_URL = "https://marinesensitivity.org/branding/mma-seal.svg";

test.describe("B5: Download HTML, opened offline", () => {
  test("the exported document has readable (non-white) text on its light page, and the seal survives with no network", async ({
    page,
    browser,
  }) => {
    await gotoReport(page, { ver: "v7", pl: PL });
    await expect(page.locator(".progress-line")).toContainText("Done");
    await waitForMapCapture(page); // P4: attribute-based wait -- `.map-print` is off-screen by default

    // simulate the seal build (this file's own header): a real `.agency-lockup img` node, at the
    // SAME url `sealUrl` defaults to, in the exact place `onDownloadHtml`'s transform looks for it
    // (`.agency-lockup img`, Report.svelte).
    await page.evaluate((sealUrl) => {
      const header = document.querySelector(".report-header");
      if (!header) throw new Error("test setup: .report-header not found");
      const lockup = document.createElement("div");
      lockup.className = "agency-lockup";
      const img = document.createElement("img");
      img.src = sealUrl;
      img.alt = "";
      lockup.appendChild(img);
      header.appendChild(lockup);
    }, SEAL_URL);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download HTML" }).click(),
    ]);
    const savedPath = test.info().outputPath("downloaded-report-export.html");
    await download.saveAs(savedPath);

    const offlineContext = await browser.newContext();
    try {
      const offlinePage = await offlineContext.newPage();
      const networkRequests: string[] = [];
      await offlinePage.route(/^https?:\/\//, (route) => {
        networkRequests.push(route.request().url());
        return route.abort();
      });
      const errors: string[] = [];
      offlinePage.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await offlinePage.goto(`file://${savedPath}`);

      // --- B5 part 1: readable text, not white-on-light ------------------------------------------
      expect(
        await offlinePage.evaluate(() => document.documentElement.getAttribute("data-theme")),
      ).toBe("paper");
      expect(
        await offlinePage.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
      ).toBe("light");
      // report.css: `body { color: var(--text-primary, #1a1f29); }`. Paper's --text-primary is
      // --mma-navy (#001a57 -> rgb(0, 26, 87)); the pre-fix bug painted this rgb(255, 255, 255)
      // (navy theme's --text-primary, tokens.css's un-attributed :root default).
      expect(await offlinePage.evaluate(() => getComputedStyle(document.body).color)).toBe(
        "rgb(0, 26, 87)",
      );

      // --- B5 part 2: the seal survives with the network cut off -----------------------------------
      const seal = offlinePage.locator(".agency-lockup img");
      await expect(seal).toHaveCount(1);
      const src = await seal.getAttribute("src");
      expect(src).toMatch(/^data:/);
      // a broken/empty data URI still decodes to naturalWidth 0 -- assert it actually RENDERED.
      expect(
        await seal.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      ).toBe(true);

      expect(networkRequests).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await offlineContext.close();
    }
  });
});
