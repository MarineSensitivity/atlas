#!/usr/bin/env node
// Usage: node scripts/axe-mockups.mjs
// atlas-3: axe over the three mockups in both themes. Target (and gate): zero serious and zero
// critical findings. Moderate/minor are printed but do not fail — atlas-8 re-runs this over the
// real gallery and the app, where they turn into a fix list.
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { MOCKUPS, THEMES, mockupUrl, serveStatic } from "./mockup-serve.mjs";

const server = await serveStatic(4372, ".");
const browser = await chromium.launch();
let serious = 0;
let critical = 0;

try {
  for (const m of MOCKUPS) {
    for (const theme of THEMES) {
      // axe-core/playwright requires a real context (it injects into every frame)
      const context = await browser.newContext({
        viewport: { width: m.width, height: m.height },
        colorScheme: theme === "paper" ? "light" : "dark",
      });
      const page = await context.newPage();
      await page.goto(mockupUrl(server.origin, m.file, theme), { waitUntil: "networkidle" });
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const count = (impact) => violations.filter((v) => v.impact === impact).length;
      serious += count("serious");
      critical += count("critical");
      process.stdout.write(
        `  ${m.name} [${theme}]: ${count("critical")} critical, ${count("serious")} serious, ` +
          `${count("moderate")} moderate, ${count("minor")} minor\n`,
      );
      for (const v of violations) {
        process.stdout.write(
          `      · ${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node(s))\n`,
        );
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (serious || critical) {
  process.stderr.write(`axe: FAIL — ${critical} critical and ${serious} serious finding(s)\n`);
  process.exit(1);
}
process.stdout.write("axe: PASS — 0 critical, 0 serious across 3 mockups × 2 themes\n");
