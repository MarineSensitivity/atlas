#!/usr/bin/env node
// Usage: node scripts/mockup-shots-r2.mjs [--only=<shot-name-substring>]
// U0 / round 2: screenshot each R1–R5 decision mockup (R2_MOCKUPS in mockup-serve.mjs) into
// docs/usability/ as JPEG (quality 70, device scale 1) — the committed pixels docs/usability.md cites.
// The mockups are static review surfaces under docs/design/mockups/r2/, never part of the app (D13).
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { R2_MOCKUPS, r2MockupUrl, serveStatic } from "./mockup-serve.mjs";

const OUT = "docs/usability";
const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);

const server = await serveStatic(4373, ".");
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

try {
  for (const m of R2_MOCKUPS) {
    if (only && !m.shot.includes(only)) continue;
    const page = await browser.newPage({
      viewport: { width: m.width, height: m.height },
      deviceScaleFactor: 1,
      colorScheme: m.theme === "paper" ? "light" : "dark",
    });
    await page.goto(r2MockupUrl(server.origin, m), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const path = `${OUT}/${m.shot}.jpg`;
    await page.screenshot({ path, type: "jpeg", quality: 70 });
    process.stdout.write(`  ✓ ${path} (${m.width}×${m.height}, theme=${m.theme})\n`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
