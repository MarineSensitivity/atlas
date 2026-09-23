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
    // firefox: same launch shape playwright.config.ts uses -- prefs, and HEADED whenever a
    // virtual display is available on linux (headless Playwright Firefox has no WebGL there).
    browser = await launcher.launch(
      name === "firefox"
        ? {
            firefoxUserPrefs: prefs,
            headless: !(process.platform === "linux" && !!process.env.DISPLAY),
          }
        : {},
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
