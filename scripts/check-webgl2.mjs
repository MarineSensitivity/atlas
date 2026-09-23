#!/usr/bin/env node
// 0.10.14: "can this machine's browsers create a WebGL2 context at all?" as its own CI gate.
//
// WHY THIS EXISTS. maplibre-gl needs WebGL2. chromium brings its own software rasterizer
// (SwiftShader), so it works anywhere; FIREFOX uses the SYSTEM GL stack, and a GPU-less runner has
// only Mesa's software path -- which Firefox's blocklist disables unless `webgl.force-enabled` is
// set, and which is not there at all unless the Mesa DRI drivers are installed. On GitHub's
// ubuntu-latest both were true, and the result was six confusing e2e reds (run 35819393922:
// `GPUInitializationError: WebGL2 is required to display this map`, and the serial describes then
// skipped everything behind them). One explicit gate that says "firefox: no WebGL2, renderer=..."
// beats six specs failing for a reason none of them is about.
//
// Usage: `node scripts/check-webgl2.mjs [browser...]` (default: chromium firefox webkit).
// Exit 0 only if EVERY requested browser reports a usable WebGL2 context.
import { readFileSync } from "node:fs";
import { chromium, firefox, webkit } from "@playwright/test";

const LAUNCHERS = { chromium, firefox, webkit };

const prefs = Object.fromEntries(
  Object.entries(
    JSON.parse(readFileSync(new URL("./firefox-webgl-prefs.json", import.meta.url), "utf8")),
  ).filter(([k]) => !k.startsWith("_")),
);

const names = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const wanted = names.length ? names : ["chromium", "firefox", "webkit"];

// the SAME explicit switch playwright.config.ts reads, validated the same way -- this script has
// to launch firefox exactly as the suite does or it is gating a different browser than it tests.
const FIREFOX_HEADED = process.env.FIREFOX_HEADED === "1";
if (FIREFOX_HEADED && !process.env.DISPLAY) {
  console.error(
    "check-webgl2: FIREFOX_HEADED=1 but $DISPLAY is unset — headed Firefox needs a display. " +
      'Wrap this command in `xvfb-run -a --server-args="-screen 0 1280x1024x24" ...`.',
  );
  process.exit(1);
}

// print the launch conditions BEFORE launching anything: when this gate and the suite disagree,
// this line is what says which of them was headed and on what display (fix round 1).
console.log(
  `check-webgl2: platform=${process.platform} DISPLAY=${process.env.DISPLAY ?? "(unset)"} ` +
    `FIREFOX_HEADED=${process.env.FIREFOX_HEADED ?? "(unset)"} -> firefox headless=${!FIREFOX_HEADED}`,
);

let failed = 0;
for (const name of wanted) {
  const launcher = LAUNCHERS[name];
  if (!launcher) {
    console.error(`check-webgl2: FAIL unknown browser "${name}"`);
    failed++;
    continue;
  }
  let browser;
  try {
    // firefox: the same launch shape playwright.config.ts uses -- the same prefs file and the
    // same explicit FIREFOX_HEADED switch (headless Playwright Firefox has no WebGL on linux).
    browser = await launcher.launch(
      name === "firefox" ? { firefoxUserPrefs: prefs, headless: !FIREFOX_HEADED } : {},
    );
    const page = await browser.newPage();
    const info = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const gl = canvas.getContext("webgl2");
      if (!gl) return { ok: false, reason: "getContext('webgl2') returned null" };
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        ok: true,
        version: gl.getParameter(gl.VERSION),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    });
    if (info.ok) {
      console.log(`check-webgl2: OK   ${name} — ${info.version} / ${info.renderer}`);
    } else {
      console.error(`check-webgl2: FAIL ${name} — ${info.reason}`);
      failed++;
    }
  } catch (err) {
    console.error(`check-webgl2: FAIL ${name} — ${err instanceof Error ? err.message : err}`);
    failed++;
  } finally {
    await browser?.close();
  }
}

if (failed) {
  console.error(
    `check-webgl2: ${failed} browser(s) cannot create a WebGL2 context. Every map spec on that ` +
      "engine is meaningless until this is fixed — on linux that usually means the Mesa DRI " +
      "drivers (libgl1-mesa-dri) are missing, or scripts/firefox-webgl-prefs.json is not being " +
      "applied.",
  );
  process.exit(1);
}
console.log("check-webgl2: all requested browsers have WebGL2");
