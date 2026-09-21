#!/usr/bin/env node
// Usage: node scripts/mockup-shots.mjs
// atlas-3 step 1: screenshot each mockup in BOTH themes into docs/design/mockups/screenshots/ with
// stable file names, so the owner's checkpoint reviews committed pixels, not a running server.
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { MOCKUPS, THEMES, mockupUrl, serveStatic } from "./mockup-serve.mjs";

const OUT = "docs/design/mockups/screenshots";

const server = await serveStatic(4371, ".");
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

try {
  for (const m of MOCKUPS) {
    for (const theme of THEMES) {
      const page = await browser.newPage({
        viewport: { width: m.width, height: m.height },
        deviceScaleFactor: 2,
        colorScheme: theme === "paper" ? "light" : "dark",
      });
      await page.goto(mockupUrl(server.origin, m.file, theme), { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const path = `${OUT}/${m.name}-${theme}.png`;
      await page.screenshot({ path });
      process.stdout.write(`  ✓ ${path} (${m.width}×${m.height}, theme=${theme})\n`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
