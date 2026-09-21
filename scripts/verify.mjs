#!/usr/bin/env node
// SKELETON (atlas-0 Deliverable 5). The real state matrix — every combination of view state
// (release, lens, places, ...) the app can be in — grows with atlas-2 through atlas-6; this only
// wires up the two fixed pieces the plan already specifies: the two viewports and the
// `assertLayout()` rule ("no horizontal overflow and every control on screen").
//
// Usage once there is something to check: `node scripts/verify.mjs` (expects `vite preview` already
// serving `dist/`, e.g. via `npm run build && npm run preview -- --port 4173 --strictPort`).
import { chromium } from "@playwright/test";

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};

// filled in by atlas-2+ as view states exist (release picker, lens, places, ...). Each entry is a
// path+query+hash fragment appended to the base URL. Empty today: the shell has no view state yet.
export const STATE_MATRIX = [{ name: "shell (no state)", path: "/" }];

/**
 * No horizontal overflow, and every interactive control (`[data-control]`) fully inside the
 * viewport. Returns a list of problems; empty = pass.
 * @param {import("@playwright/test").Page} page
 */
export async function assertLayout(page) {
  const problems = [];

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) problems.push("horizontal overflow on <html>");

  const viewport = page.viewportSize();
  const controls = page.locator("[data-control]");
  const count = await controls.count();
  for (let i = 0; i < count; i++) {
    const box = await controls.nth(i).boundingBox();
    const name = await controls.nth(i).getAttribute("data-control");
    if (!box) {
      problems.push(`control "${name}" has no bounding box (not rendered)`);
      continue;
    }
    if (!viewport) continue;
    const offscreen =
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > viewport.width ||
      box.y + box.height > viewport.height;
    if (offscreen)
      problems.push(`control "${name}" is off-screen at ${viewport.width}x${viewport.height}`);
  }

  return problems;
}

async function main() {
  const baseURL = process.env.VERIFY_BASE_URL ?? "http://localhost:4173";
  const browser = await chromium.launch();
  let failed = false;

  try {
    for (const viewportName of Object.keys(VIEWPORTS)) {
      const page = await browser.newPage({ viewport: VIEWPORTS[viewportName] });
      for (const state of STATE_MATRIX) {
        await page.goto(new URL(state.path, baseURL).toString());
        const problems = await assertLayout(page);
        const label = `${state.name} @ ${viewportName}`;
        if (problems.length) {
          failed = true;
          process.stderr.write(`✗ ${label}\n`);
          for (const p of problems) process.stderr.write(`    ${p}\n`);
        } else {
          process.stdout.write(`✓ ${label}\n`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  process.exit(failed ? 1 : 0);
}

// only run as a CLI, not when imported (tests import assertLayout/VIEWPORTS/STATE_MATRIX directly).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
