// scripts/tour-guide.mjs -- screenshots of the app's OWN guided tour, for the docs "Atlas user guide".
//
//   node scripts/tour-guide.mjs [--base https://marinesensitivity.org/atlas/] [--out <dir>]
//                               [--theme dark|light] [--viewport 1280x800] [--ver v7]
//                               [--species 54247] [--no-hero]
//
// What it does: opens the app (default = the LIVE site, so the guide shows what users get; `--base`
// may point at a local `npm run preview`), starts the REAL tour with `?tour=on`, and walks it with
// driver.js's own Next button, shooting every step. Each PNG therefore carries driver.js's own
// highlight + popover exactly as a user sees it. For each step it writes
//   {out}/atlas-{scores|species}-{nn}.png
// and one {out}/steps.json -- the manifest shape the docs repo's guide page already reads
// (docs/figures/apps-guide/steps.json): [{app, app_key, n, title, text, selector, url, image}].
// Unless --no-hero it also writes {out}/hero-scores.png and {out}/hero-species.png (1600x1000) for
// the homepage, and hero-scores-default.png (the same view with the panel left open).
//
// The titles / texts / anchors come FROM src/shell/tour.ts (transpiled here with the TypeScript compiler
// already in devDependencies), so the guide cannot drift from the app's data; the popover that is
// actually on screen is then compared against that data, so a tour.ts that no longer matches the
// deployed build (a live site older/newer than this checkout) fails loudly instead of documenting
// the wrong thing.
//
// Failure is loud on purpose: a guide with a blank shot is the failure this script guards against.
// A step whose popover or anchor never appears, whose popover disagrees with tour.ts, or whose map
// never settles (tiles still loading, camera still moving, a "Loading…" message still up) stops the
// run with a non-zero exit and the lens + step id in the message. Nothing is shot "best effort".
import { chromium } from "@playwright/test";
import ts from "typescript";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- args ---------------------------------------------------------------------------------------
function parseArgs(argv) {
  const o = {
    base: "https://marinesensitivity.org/atlas/",
    out: resolve(ROOT, ".tmp/tour-guide"),
    theme: "dark",
    viewport: "1280x800",
    ver: "v7",
    // v7 merged-model key of the Humpback Whale (`taxa.json` of the v7 app bundle). The species
    // tour needs a species on screen so its card / legend / map steps have something to show.
    species: "54247",
    hero: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === "--base") o.base = next();
    else if (a === "--out") o.out = resolve(next());
    else if (a === "--theme") o.theme = next();
    else if (a === "--viewport") o.viewport = next();
    else if (a === "--ver") o.ver = next();
    else if (a === "--species") o.species = next();
    else if (a === "--no-hero") o.hero = false;
    else fail(`unknown argument ${a}`);
  }
  if (!["dark", "light"].includes(o.theme)) fail(`--theme must be dark or light, got ${o.theme}`);
  const m = /^(\d+)x(\d+)$/.exec(o.viewport);
  if (!m) fail(`--viewport must look like 1280x800, got ${o.viewport}`);
  o.vp = { width: Number(m[1]), height: Number(m[2]) };
  if (!/^v[0-9]+[a-z]?$/.test(o.ver)) fail(`--ver must look like v7, got ${o.ver}`);
  o.base = o.base.replace(/\/*$/, "/");
  return o;
}

function fail(msg) {
  console.error(`tour-guide: FAILED: ${msg}`);
  process.exit(1);
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// --- the step list, FROM src/shell/tour.ts ----------------------------------------------------------
async function loadTourData() {
  const src = readFileSync(resolve(ROOT, "src/shell/tour.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  for (const k of ["SCORES_TOUR_STEPS", "SPECIES_TOUR_STEPS"]) {
    if (!Array.isArray(mod[k]) || mod[k].length === 0) fail(`src/shell/tour.ts exports no ${k}`);
  }
  return { scores: mod.SCORES_TOUR_STEPS, species: mod.SPECIES_TOUR_STEPS };
}

/** plain sentences: tags dropped, the handful of entities a tour text could carry decoded. */
function stripHtml(s) {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// --- deep links ------------------------------------------------------------------------------------
// `ui=4.<tool>.<dock>.<size>.<detent>.<row>` (src/shell/uiState.ts) is what reproduces an open rail
// tool; the default desktop panel is docked left at 380 px, half-height detent, no row expanded.
const TOOL_CODE = { layers: "l", details: "d", table: "t", report: "r" };
const TOOL_OF_STEP = {
  scores: {
    layers: "layers",
    details: "details",
    table: "table",
    places: "report",
    report: "report",
  },
  species: { card: "layers" },
};
function deepLink(o, lens, stepId) {
  const q = new URLSearchParams();
  q.set("ver", o.ver);
  if (lens === "species") {
    q.set("lens", "species");
    q.set("sp", o.species);
  }
  const tool = TOOL_OF_STEP[lens]?.[stepId];
  if (tool) q.set("ui", `4.${TOOL_CODE[tool]}.l.380.h.n`);
  return `${o.base}?${q.toString().replace(/%2C/g, ",")}`;
}

// --- readiness ---------------------------------------------------------------------------------------
/** the map is drawn and still: style loaded, every visible tile in, camera not moving, no
 * "Loading…" text anywhere in the app chrome. Returns a reason string while not ready, else "". */
const NOT_READY = () => {
  const h = window.__atlasMap?.handle?.map;
  if (!h) return "map handle missing";
  if (h.isMoving?.()) return "camera moving";
  if (!h.loaded?.()) return "map not loaded";
  if (h.areTilesLoaded && !h.areTilesLoaded()) return "tiles loading";
  const txt = document.body.innerText || "";
  const m = /\bLoading[^\n]{0,40}/i.exec(txt);
  if (m) return `"${m[0].trim()}" on screen`;
  if (document.querySelector('[aria-busy="true"], [role="progressbar"], .spinner'))
    return "spinner on screen";
  return "";
};

async function waitSettled(page, what, timeout = 60_000) {
  const t0 = Date.now();
  let last;
  // two consecutive clean reads 400 ms apart: `idle` can fire a frame before the last tile paints
  for (;;) {
    const r = await page.evaluate(NOT_READY).catch((e) => `evaluate failed: ${e.message}`);
    if (r === "") {
      await page.waitForTimeout(400);
      const r2 = await page.evaluate(NOT_READY).catch(() => "evaluate failed");
      if (r2 === "") return;
      last = r2;
    } else last = r;
    if (Date.now() - t0 > timeout) fail(`${what}: the map never settled (${last})`);
    await page.waitForTimeout(250);
  }
}

async function newPage(browser, o, vp) {
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
    colorScheme: o.theme,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("pageerror:", e.message.slice(0, 200)));
  return { ctx, page };
}

// --- the tour walk -----------------------------------------------------------------------------------
async function shootLens(browser, o, lens, steps, manifest) {
  const label = lens === "scores" ? "Atlas — Scores lens" : "Atlas — Species lens";
  const { ctx, page } = await newPage(browser, o, o.vp);
  const q = new URLSearchParams({ ver: o.ver, theme: o.theme, tour: "on" });
  if (lens === "species") {
    q.set("lens", "species");
    q.set("sp", o.species);
  }
  const url = `${o.base}?${q}`;
  log(`${lens}: ${url}`);
  await page.goto(url, { waitUntil: "load", timeout: 90_000 });

  const popover = page.locator(".driver-popover");
  try {
    await popover.waitFor({ state: "visible", timeout: 45_000 });
  } catch {
    fail(`${lens}: the tour never started (no .driver-popover after ?tour=on)`);
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const nn = String(i + 1).padStart(2, "0");
    const where = `${lens} step ${i + 1}/${steps.length} "${s.id}"`;

    // 1. the popover on screen is THIS step's (progress text + title agree with tour.ts)
    try {
      await page.waitForFunction(
        ([n, total, title]) => {
          const p = document.querySelector(".driver-popover");
          if (!p || getComputedStyle(p).display === "none") return false;
          const prog = p.querySelector(".driver-popover-progress-text")?.textContent?.trim();
          const t = p.querySelector(".driver-popover-title")?.textContent?.trim();
          return prog === `${n} of ${total}` && t === title;
        },
        [i + 1, steps.length, s.title],
        { timeout: 20_000 },
      );
    } catch {
      const seen = await page
        .evaluate(
          () =>
            document.querySelector(".driver-popover")?.textContent?.replace(/\s+/g, " ") ??
            "(no popover)",
        )
        .catch(() => "(unreadable)");
      fail(
        `${where}: popover never showed "${s.title}" (${i + 1} of ${steps.length}); saw: ${seen}`,
      );
    }
    const shownDesc = await page.locator(".driver-popover-description").first().innerText();
    if (stripHtml(shownDesc) !== stripHtml(s.description))
      fail(
        `${where}: popover text differs from src/shell/tour.ts (live build vs this checkout?)\n  tour.ts: ${s.description}\n  on page: ${shownDesc}`,
      );

    // 2. the anchor exists, is visible and is what driver.js highlights
    const anchor = page.locator(s.element).first();
    try {
      await anchor.waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      fail(`${where}: anchor ${s.element} never became visible`);
    }
    const box = await anchor.boundingBox();
    if (!box || box.width < 4 || box.height < 4)
      fail(`${where}: anchor ${s.element} has no size (${JSON.stringify(box)})`);
    if ((await page.locator(".driver-active-element").count()) === 0)
      fail(`${where}: driver.js highlights nothing (no .driver-active-element)`);

    // 3. the map behind the popover is drawn and still, the popover not mid-animation
    await waitSettled(page, where);
    await page.waitForTimeout(500);
    if (!(await popover.isVisible())) fail(`${where}: popover vanished before the shot`);

    const file = `atlas-${lens}-${nn}.png`;
    await page.screenshot({ path: resolve(o.out, file) });
    log(`  ${file}  ${s.title}`);
    manifest.push({
      app: label,
      app_key: `atlas-${lens}`,
      n: i + 1,
      title: s.title,
      text: stripHtml(s.description),
      selector: s.element,
      url: deepLink(o, lens, s.id),
      image: `/figures/atlas-guide/${file}`,
    });

    // 4. advance with the tour's own button (its last step's button is "Done")
    await page.locator(".driver-popover-next-btn").click();
  }
  // the tour ends cleanly: popover gone after Done
  try {
    await popover.waitFor({ state: "hidden", timeout: 10_000 });
  } catch {
    fail(`${lens}: the tour did not close after its last step`);
  }
  await ctx.close();
}

// --- hero images -------------------------------------------------------------------------------------
async function shootHero(browser, o, name, search, { collapse }) {
  const { ctx, page } = await newPage(browser, o, { width: 1600, height: 1000 });
  const url = `${o.base}?${search}`;
  log(`hero ${name}: ${url}`);
  await page.goto(url, { waitUntil: "load", timeout: 90_000 });
  await page.locator('[data-tour="map"]').waitFor({ state: "visible", timeout: 45_000 });
  if (collapse) {
    const btn = page.getByRole("button", { name: "Collapse to a pill" }).first();
    try {
      await btn.waitFor({ state: "visible", timeout: 30_000 });
    } catch {
      fail(`hero ${name}: the panel's "Collapse to a pill" button never appeared`);
    }
    await btn.click();
    await page.waitForTimeout(800);
  }
  await waitSettled(page, `hero ${name}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(o.out, name) });
  log(`  ${name}`);
  await ctx.close();
}

// --- main --------------------------------------------------------------------------------------------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  mkdirSync(o.out, { recursive: true });
  const tour = await loadTourData();
  log(
    `base ${o.base}  out ${o.out}  ${o.theme} ${o.viewport}  ver ${o.ver}  species ${o.species}` +
      `  (${tour.scores.length} scores + ${tour.species.length} species steps from src/shell/tour.ts)`,
  );
  const browser = await chromium.launch();
  const manifest = [];
  try {
    await shootLens(browser, o, "scores", tour.scores, manifest);
    await shootLens(browser, o, "species", tour.species, manifest);
    if (o.hero) {
      const t = `ver=${o.ver}&theme=${o.theme}&tour=off`;
      await shootHero(browser, o, "hero-scores.png", t, { collapse: true });
      await shootHero(browser, o, "hero-scores-default.png", t, { collapse: false });
      await shootHero(browser, o, "hero-species.png", `${t}&lens=species&sp=${o.species}`, {
        collapse: true,
      });
    }
  } finally {
    await browser.close();
  }
  writeFileSync(resolve(o.out, "steps.json"), JSON.stringify(manifest, null, 2) + "\n");
  log(`wrote ${manifest.length} steps -> ${resolve(o.out, "steps.json")}`);
}

main().catch((e) => fail(e?.stack ?? String(e)));
