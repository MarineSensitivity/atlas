// U0 usability walk (round 2): shared helpers for the scripted walks of the LIVE app. These drive
// https://marinesensitivity.org/atlas/ (public v7) and the live bucket -- NOT hermetic, on purpose:
// the point is what a first-time user meets. Screenshots land in docs/usability/ as JPEG q70;
// observations append to .tmp/usability/obs-<walk>.json so docs/usability.md can cite them.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, firefox, webkit } from "@playwright/test";

export const ATLAS = process.env.ATLAS_URL ?? "https://marinesensitivity.org/atlas";
export const SHOTS = "docs/usability";
export const OBS_DIR = ".tmp/usability";
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OBS_DIR, { recursive: true });

export const ENGINES = { chromium, firefox, webkit };

/** one walk's observation log: `note()` appends, `save()` writes the JSON. */
export function createLog(walk) {
  const rows = [];
  return {
    rows,
    note(state, data) {
      const row = { state, t: new Date().toISOString(), ...data };
      rows.push(row);
      process.stdout.write(`[${walk}] ${state}: ${JSON.stringify(data).slice(0, 400)}\n`);
    },
    save() {
      writeFileSync(`${OBS_DIR}/obs-${walk}.json`, JSON.stringify(rows, null, 2));
    },
  };
}

/** a fresh context = a first-time visitor (empty localStorage). `colorScheme` is the OS setting. */
export async function openContext(
  browser,
  { width = 1280, height = 800, colorScheme = "dark", touch = false, clipboard = true } = {},
) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    acceptDownloads: true,
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 1,
  });
  // chromium only: webkit rejects "clipboard-write" at newPage() time, not at grant time
  if (clipboard) await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  const failed = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  return { ctx, page, consoleErrors, failed };
}

/** load a URL and time: DOMContentLoaded, map style loaded, first raster tile drawn, map idle. */
export async function load(page, search = "", { waitIdle = true, timeout = 45_000 } = {}) {
  const t0 = Date.now();
  await page.goto(`${ATLAS}/${search}`, { waitUntil: "domcontentloaded", timeout });
  const tDom = Date.now() - t0;
  let tStyle = null;
  let tIdle = null;
  try {
    await page.waitForFunction(() => !!window.__atlasMap?.handle?.map?.isStyleLoaded?.(), null, {
      timeout,
    });
    tStyle = Date.now() - t0;
  } catch {
    /* recorded as null */
  }
  if (waitIdle) {
    try {
      await page.waitForFunction(
        () => {
          const m = window.__atlasMap?.handle?.map;
          return !!m && m.loaded() && m.areTilesLoaded();
        },
        null,
        { timeout },
      );
      tIdle = Date.now() - t0;
    } catch {
      /* recorded as null */
    }
  }
  return { tDom, tStyle, tIdle };
}

/** dismiss the welcome modal the way a user would ("Explore"); returns whether it was up. */
export async function dismissWelcome(page, { timeout = 12_000 } = {}) {
  const explore = page.getByRole("button", { name: /^explore$/i }).first();
  try {
    await explore.waitFor({ state: "visible", timeout });
  } catch {
    return false;
  }
  await explore.click();
  await explore.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  return true;
}

/** wait for the map to settle (tiles loaded) after an interaction, bounded. */
export async function settle(page, ms = 20_000) {
  await page
    .waitForFunction(
      () => {
        const m = window.__atlasMap?.handle?.map;
        return !m || (m.loaded() && m.areTilesLoaded());
      },
      null,
      { timeout: ms },
    )
    .catch(() => {});
  await page.waitForTimeout(600);
}

export async function shot(page, name, opts = {}) {
  const path = `${SHOTS}/${name}.jpg`;
  // a busy WebGL page can stall a capture under load: retry once with a longer budget, then
  // report instead of aborting the whole walk
  for (const timeout of [30_000, 90_000]) {
    try {
      await page.screenshot({ path, type: "jpeg", quality: 70, timeout, ...opts });
      process.stdout.write(`  shot ${path}\n`);
      return path;
    } catch (e) {
      process.stdout.write(`  shot FAILED ${path} (${String(e).split("\n")[0]})\n`);
    }
  }
  return null;
}

/** screen point of a lng/lat on the live map (null if the map is not up). */
export function project(page, lng, lat) {
  return page.evaluate(
    ([x, y]) => {
      const m = window.__atlasMap?.handle?.map;
      if (!m) return null;
      const p = m.project([x, y]);
      const r = m.getContainer().getBoundingClientRect();
      return { x: p.x + r.left, y: p.y + r.top };
    },
    [lng, lat],
  );
}

/** what is focused, described briefly. */
export function focused(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    const name =
      a.getAttribute("aria-label") ||
      a.getAttribute("title") ||
      (a.textContent || "").trim().slice(0, 40) ||
      a.getAttribute("placeholder") ||
      "";
    const r = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    return `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""} "${name}" @${Math.round(r.x)},${Math.round(r.y)} outline=${cs.outlineStyle}/${cs.outlineWidth}`;
  });
}

export function visibleText(page, selector) {
  return page
    .locator(selector)
    .first()
    .innerText({ timeout: 3000 })
    .catch(() => null);
}

export function search(page) {
  return page.evaluate(() => location.search + location.hash);
}
