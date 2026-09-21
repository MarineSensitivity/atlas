import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startForeignServer } from "../foreign-server.mjs";

// atlas-2 Step 3 (Sonnet half): "measure ... whether a cross-origin repository (the bucket) works"
// -- neither docs/spikes/S3.md nor S4.md tested this (S3.md's own gap list: "the extension mirror
// was tested for parquet only, on wasm_eh, in chromium" -- same-origin only in both spikes).
//
// The app's OWN data fetches (manifest.json, tables/*.parquet) already cross the browser's
// same-origin boundary today (src/lib/release/dataBase.ts's PUBLIC_DATA_BASE is the S3 bucket, a
// different origin than either host the app is served from) and that already works in production,
// which only happens because the bucket answers CORS for those objects. This spec measures whether
// DuckDB-WASM's OWN internal fetch for `custom_extension_repository` is subject to the exact same
// CORS mechanism -- i.e. whether hosting the extension mirror ON the bucket (cross-origin to the
// app) would work the same way, without needing to touch the (read-only, per this task) real
// bucket: a local "foreign origin" server stands in, once WITHOUT CORS headers and once WITH.

const FOREIGN_PORT = 4392;
const publicDuckdbExt = fileURLToPath(new URL("../../../../public/duckdb-ext", import.meta.url));

test.describe("cross-origin custom_extension_repository", () => {
  test("a foreign origin WITHOUT CORS headers: the extension fetch fails", async ({ page }) => {
    const server = await startForeignServer({
      port: FOREIGN_PORT,
      dir: publicDuckdbExt,
      cors: false,
    });
    try {
      // extensions.duckdb.org still reachable here on purpose -- isolates "does cross-origin work
      // at all" from the separate same-origin-mirror question the other specs already cover.
      await page.goto("/");
      await page.waitForFunction(() => "__engineTest" in window);
      const boot = await page.evaluate(
        (repo) => window.__engineTest.boot({ platform: "eh", extensionRepository: repo }),
        `http://localhost:${FOREIGN_PORT}`,
      );
      expect(boot.ok, `boot failed: ${boot.error}`).toBe(true);

      const result = await page.evaluate(() => window.__engineTest.countTaxon());
      console.log(
        `[engine-e2e][cross-origin][no-cors] ok=${result.ok} error=${result.error ?? ""}`,
      );
      expect(result.ok, "expected the no-CORS foreign origin to fail").toBe(false);
    } finally {
      await server.close();
    }
  });

  test("a foreign origin WITH CORS headers: the extension fetch succeeds", async ({ page }) => {
    const server = await startForeignServer({
      port: FOREIGN_PORT,
      dir: publicDuckdbExt,
      cors: true,
    });
    try {
      await page.goto("/");
      await page.waitForFunction(() => "__engineTest" in window);
      const boot = await page.evaluate(
        (repo) => window.__engineTest.boot({ platform: "eh", extensionRepository: repo }),
        `http://localhost:${FOREIGN_PORT}`,
      );
      expect(boot.ok, `boot failed: ${boot.error}`).toBe(true);

      const result = await page.evaluate(() => window.__engineTest.countTaxon());
      console.log(`[engine-e2e][cross-origin][cors] ok=${result.ok} error=${result.error ?? ""}`);
      expect(
        result.ok,
        `expected the CORS-enabled foreign origin to succeed: ${result.error}`,
      ).toBe(true);
      expect(result.n).toBe(37_067);
    } finally {
      await server.close();
    }
  });
});
