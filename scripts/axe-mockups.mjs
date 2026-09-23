#!/usr/bin/env node
// Usage: node scripts/axe-mockups.mjs [--set=r2]
// atlas-3: axe over the three mockups in both themes. Target (and gate): zero serious and zero
// critical findings. Moderate/minor are printed but do not fail — atlas-8 re-runs this over the
// real gallery and the app, where they turn into a fix list.
// U0 / round 2: `--set=r2` runs the same gate over the R1–R5 decision mockups (R2_MOCKUPS, each
// entry at its own viewport and theme) instead of the atlas-3 set. The default is unchanged.
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import {
  MOCKUPS,
  R2_MOCKUPS,
  THEMES,
  mockupUrl,
  r2MockupUrl,
  serveStatic,
} from "./mockup-serve.mjs";

const set = process.argv.find((a) => a.startsWith("--set="))?.slice("--set=".length) ?? "atlas-3";
if (set !== "atlas-3" && set !== "r2") {
  process.stderr.write(`axe: unknown --set=${set} (expected r2, or nothing for the atlas-3 set)\n`);
  process.exit(2);
}

/** every (label, url, viewport, theme) the chosen set covers */
function runs(origin) {
  if (set === "r2") {
    return R2_MOCKUPS.map((m) => ({
      label: m.shot,
      url: r2MockupUrl(origin, m),
      width: m.width,
      height: m.height,
      theme: m.theme,
    }));
  }
  return MOCKUPS.flatMap((m) =>
    THEMES.map((theme) => ({
      label: `${m.name} [${theme}]`,
      url: mockupUrl(origin, m.file, theme),
      width: m.width,
      height: m.height,
      theme,
    })),
  );
}

const server = await serveStatic(4372, ".");
const browser = await chromium.launch();
let serious = 0;
let critical = 0;
let count = 0;

try {
  for (const r of runs(server.origin)) {
    count += 1;
    // axe-core/playwright requires a real context (it injects into every frame)
    const context = await browser.newContext({
      viewport: { width: r.width, height: r.height },
      colorScheme: r.theme === "paper" ? "light" : "dark",
    });
    const page = await context.newPage();
    await page.goto(r.url, { waitUntil: "networkidle" });
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const n = (impact) => violations.filter((v) => v.impact === impact).length;
    serious += n("serious");
    critical += n("critical");
    process.stdout.write(
      `  ${r.label}: ${n("critical")} critical, ${n("serious")} serious, ` +
        `${n("moderate")} moderate, ${n("minor")} minor\n`,
    );
    for (const v of violations) {
      process.stdout.write(
        `      · ${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node(s))\n`,
      );
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (serious || critical) {
  process.stderr.write(`axe: FAIL — ${critical} critical and ${serious} serious finding(s)\n`);
  process.exit(1);
}
process.stdout.write(`axe: PASS — 0 critical, 0 serious across ${count} ${set} mockup page(s)\n`);
