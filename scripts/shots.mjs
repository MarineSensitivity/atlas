#!/usr/bin/env node
// scripts/shots.mjs -- atlas-8 step 5 / Deliverable 2: the Shiny-vs-Atlas screenshot pairs on
// `docs/parity.html`.
//
// Each STATE below is ONE view expressed twice: a URL (plus, where the old app has no URL state, a
// short scripted interaction) against the live Shiny apps on `app.marinesensitivity.org`, and the
// equivalent URL against the published Atlas on the Pages site. Both sides are driven by real
// chromium at 1280x800.
//
//   node scripts/shots.mjs                      # every state, into docs/parity/shots/
//   node scripts/shots.mjs --only scores-default,report-gaa
//   node scripts/shots.mjs --out .tmp/shots     # somewhere else (a dry run)
//
// Rules this script keeps, because they are what make the page trustworthy:
//   * PUBLIC v7 only. v7 is `latest.txt`; v7b/v8/v9 are restricted and are never requested here.
//   * The Shiny apps boot slowly (Shiny Server, R: measured 9-13 s to first paint). Every wait is
//     on a REAL rendered element, never a bare sleep, with >= 60 s timeouts and 2 retries.
//   * A blank Shiny capture is a FAILED pair. It is recorded as failed in `shots.json` and the page
//     prints it as failed -- it is never quietly shipped as if the comparison had happened.
//   * `shots.json` records both URLs, the wall time, the byte size and the rendered checks, so the
//     parity page can state exactly what was and was not compared.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SHINY = "https://app.marinesensitivity.org/v7";
const ATLAS = "https://marinesensitivity.org/atlas";
const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT = 90_000;
const WAIT_TIMEOUT = 60_000;
const RETRIES = 2;
/** a uniform 1280x800 jpeg at q80 is ~10-20 KB; anything real is far bigger. Below this the
 * capture is treated as blank -- the "a blank Shiny screenshot is a FAILED pair" rule. */
const MIN_BYTES = 40_000;

// ---------------------------------------------------------------------------- shiny helpers

/**
 * Dismiss the Shiny welcome splash ("Take a Tour" / "Explore").
 *
 * It is rendered by the SERVER after the session connects, so it appears a second or two AFTER the
 * map canvas exists: an immediate `if (count)` misses it and every capture then shows the modal
 * instead of the app (measured on the species app, first full run). Wait for the button, click it,
 * then wait for it to go away.
 */
async function dismissSplash(page) {
  const explore = page.getByRole("button", { name: /^explore$/i });
  await explore
    .first()
    .waitFor({ state: "visible", timeout: 25_000 })
    .catch(() => {});
  if (await explore.count()) {
    await explore
      .first()
      .click({ timeout: 10_000 })
      .catch(() => {});
    await explore
      .first()
      .waitFor({ state: "hidden", timeout: 15_000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
  }
}

/** pick an option out of a selectize control by its visible text (Shiny hides the real <select>). */
async function selectize(page, id, textRe) {
  await page.click(`#${id}-selectized`, { timeout: 20_000 });
  const option = page.locator(".selectize-dropdown-content .option", { hasText: textRe }).first();
  await option.waitFor({ state: "visible", timeout: 20_000 });
  await option.click();
  await page.waitForTimeout(3500);
}

async function openShinyScores(page) {
  await page.goto(`${SHINY}/scores/`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForSelector("#sel_lyr", { state: "attached", timeout: WAIT_TIMEOUT });
  await page.waitForSelector(".maplibregl-canvas", { timeout: WAIT_TIMEOUT });
  await dismissSplash(page);
  await page.waitForTimeout(4000);
}

async function openShinySpecies(page, query = "") {
  await page.goto(`${SHINY}/species/${query}`, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT,
  });
  await page.waitForSelector("#sel_sp", { state: "attached", timeout: WAIT_TIMEOUT });
  await page.waitForSelector(".maplibregl-canvas", { timeout: WAIT_TIMEOUT });
  await dismissSplash(page);
  await page.waitForTimeout(4500);
}

/** the Shiny tab strip: "Map", "Plot of Scores", "Table of Species", "Report". */
async function shinyTab(page, name) {
  await page.locator("a[role=tab]", { hasText: name }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(4000);
}

/**
 * Did the Shiny side really render? Three failures this catches, all seen in practice: the app
 * dropped its websocket (`#shiny-disconnected-overlay`), the page is a bare shell with no output
 * in it, or an output is still recalculating. The recalculating check is a bounded POLL rather than
 * an instant read — Shiny marks outputs busy for a moment on every tab change.
 */
async function shinyRendered(page) {
  await page
    .waitForFunction(() => document.querySelectorAll(".recalculating").length === 0, {
      timeout: 25_000,
    })
    .catch(() => {});
  return page.evaluate(() => {
    const overlay = document.querySelector("#shiny-disconnected-overlay");
    if (overlay && getComputedStyle(overlay).display !== "none") return false;
    // a capture with the welcome splash still up is a picture of a modal, not of the state this
    // pair claims to compare -- fail it rather than ship it
    const modal = Array.from(document.querySelectorAll(".modal, .modal-backdrop, [role=dialog]"));
    if (modal.some((m) => m.getBoundingClientRect().height > 100)) return false;
    const output =
      document.querySelectorAll(
        ".maplibregl-canvas, canvas, table, .js-plotly-plot, svg, .shiny-html-output",
      ).length > 0;
    return output && document.body.innerText.trim().length > 120;
  });
}

// ---------------------------------------------------------------------------- atlas helpers

/** the one place an Atlas URL is formed: `<base>/[report.html]?<query>[#<hash>]`. A stray slash
 * before the query gave `…/report.html/?ver=v7`, which is a Pages 404 — caught by the "blank
 * capture" rule on the first dry run, which is what that rule is for. */
export function atlasUrl(search, { report = false } = {}) {
  if (!search.startsWith("?"))
    throw new Error(`atlasUrl: search must start with "?", got "${search}"`);
  return `${ATLAS}/${report ? "report.html" : ""}${search}`;
}

async function openAtlas(page, search, { report = false } = {}) {
  const url = atlasUrl(search, { report });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  if (report) {
    await page.waitForSelector(".report h1, h1", { timeout: WAIT_TIMEOUT });
    // the document renders progressively; wait for the scores table to carry a row
    await page
      .waitForFunction(() => document.querySelectorAll("table tbody tr").length > 0, {
        timeout: WAIT_TIMEOUT,
      })
      .catch(() => {});
    await page.waitForTimeout(4000);
  } else {
    await page.waitForFunction(
      () => {
        const m = window.__atlasMap?.handle?.map;
        return !!m && typeof m.isStyleLoaded === "function" && m.isStyleLoaded();
      },
      { timeout: WAIT_TIMEOUT },
    );
    // the Atlas has a welcome modal of its own, and it mounts a moment AFTER the map's style
    // loads -- the same race as the Shiny splash (dismissSplash), and it covered several captures
    // on the first full run. Wait for it, dismiss it, wait for it to go.
    const explore = page.getByRole("button", { name: /^explore$/i });
    await explore
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {});
    if (await explore.count()) {
      await explore
        .first()
        .click({ timeout: 10_000 })
        .catch(() => {});
      await explore
        .first()
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {});
    }
    await page.waitForTimeout(4000);
  }
  return url;
}

/** open one of the five rail tools by its accessible name. */
async function atlasTool(page, name) {
  await page.getByRole("button", { name, exact: true }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(3000);
}
// R3-W8 item 4: the Flower plot moved into the Layers pane's own second tab -- "Layers" (the rail
// tool, `.first()` above already resolves the rail one over the panel tab, DOM-order) then
// "Flower plot" (the tab).
async function atlasFlowerTool(page) {
  await atlasTool(page, "Layers");
  await atlasTool(page, "Flower plot");
}

async function atlasRendered(page, { report = false } = {}) {
  if (report) {
    return page.evaluate(() => document.querySelectorAll("table tbody tr").length > 0);
  }
  return page.evaluate(() => {
    // same rule as the Shiny side: a capture with a dialog over the app is not the state this pair
    // claims to compare
    const dialog = Array.from(document.querySelectorAll("[role=dialog], dialog[open]"));
    if (dialog.some((d) => d.getBoundingClientRect().height > 100)) return false;
    const m = window.__atlasMap?.handle?.map;
    if (!m) return false;
    try {
      return m.isStyleLoaded() && m.queryRenderedFeatures().length > 0;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------- the states

/**
 * `shiny: null` marks a state the old apps simply do not have (the atlas's new controls). It is
 * reported as "atlas only", never as a failed pair.
 */
export const STATES = [
  {
    id: "scores-default",
    title: "Scores · default view",
    rows: ["S-01", "S-03", "S-05", "S-13"],
    caption:
      "The landing view of each app on v7: the FULL-study-area camera, the composite score raster over the same COG, the same rescale endpoints in the legend.",
    shiny: { url: `${SHINY}/scores/`, open: openShinyScores },
    atlas: { search: "?ver=v7&theme=dark" },
  },
  {
    id: "scores-programareas",
    title: "Scores · Program Areas choropleth",
    rows: ["S-02", "S-04", "S-07"],
    caption:
      "Spatial unit switched to Program Areas. Both draw all 20 areas from the same PMTiles; the atlas fills them with the 11-bin rule and rounds the legend to 1 dp.",
    shiny: {
      url: `${SHINY}/scores/ (Spatial units → "Program areas")`,
      open: async (page) => {
        await openShinyScores(page);
        await selectize(page, "sel_unit", /program areas/i);
      },
    },
    atlas: { search: "?ver=v7&unit=programarea&theme=dark" },
  },
  {
    id: "scores-component-layer",
    title: "Scores · a component layer (fish, rescaled by ecoregion)",
    rows: ["S-03", "S-05"],
    caption:
      "The layer select, grouped by category. `extrisk_fish_ecoregion_rescaled` on both sides, same COG, same 0–100 rescale.",
    shiny: {
      url: `${SHINY}/scores/ (Layer → "fish: ext. risk, ecorgn")`,
      open: async (page) => {
        await openShinyScores(page);
        await selectize(page, "sel_lyr", /fish: ext\. risk, ecorgn/i);
      },
    },
    atlas: { search: "?ver=v7&lyr=extrisk_fish_ecoregion_rescaled&theme=dark" },
  },
  {
    id: "scores-study-area-ak",
    title: "Scores · study area Alaska",
    rows: ["S-01"],
    caption:
      "The study area is a CAMERA, not a filter: both fly to Alaska and both keep drawing the FULL COG (no study-area key ever reaches a tile or data URL — `tileUrlLeaksStudyArea` is the gate).",
    shiny: {
      url: `${SHINY}/scores/ (Study area → "Alaska")`,
      open: async (page) => {
        await openShinyScores(page);
        await selectize(page, "sel_subregion", /Alaska/i);
      },
    },
    atlas: { search: "?ver=v7&area=AK&theme=dark" },
  },
  {
    id: "scores-flower",
    title: "Scores · flower plot, nothing selected",
    rows: ["S-13", "S-14"],
    caption:
      "The default flower, centre 24 on both sides. Shiny reads an unversioned CSV and draws the ring on a full tab; the atlas reads this release's own `flower_default` (ID-08), gives `primary producer` a real colour (ID-09) and draws the ring inside the side panel — so it is SMALLER here, with every component's exact value written out beneath it (that text is also the figure's accessible summary) and a \"Show table\" toggle for the numbers.",
    shiny: {
      url: `${SHINY}/scores/ (tab "Plot of Scores")`,
      open: async (page) => {
        await openShinyScores(page);
        await shinyTab(page, "Plot of Scores");
      },
    },
    atlas: {
      search: "?ver=v7&theme=dark",
      after: async (page) => atlasFlowerTool(page),
    },
  },
  {
    id: "scores-species-table",
    title: "Scores · species table",
    rows: ["S-15", "S-16", "S-17", "S-18"],
    caption:
      "The species table for the full study area: the same twelve columns in the same order, the same number formats, the same taxon/model links. The atlas adds per-column filters and keyboard cell navigation.",
    shiny: {
      url: `${SHINY}/scores/ (tab "Table of Species")`,
      open: async (page) => {
        await openShinyScores(page);
        await shinyTab(page, "Table of Species");
      },
    },
    atlas: {
      search: "?ver=v7&theme=dark",
      after: async (page) => {
        await atlasTool(page, "Table");
        // the panel's own "Full screen" control, so the table shows the rows a reviewer wants to
        // compare against the Shiny app's full-tab table (the panel WIDTH is fixed by design).
        // housekeeping fix (2026-09-25): this read "Full height" -- the PHONE Sheet's own label
        // (Sheet.svelte) -- but this harness runs a single 1280x800 DESKTOP viewport, where the
        // maximize control is Panel.svelte's "Full screen" (see its aria-label, line ~366); U1's
        // R1 panel rework split the two, and this script was never updated. A fresh page.click()
        // (default 60s action timeout, `page.setDefaultTimeout(WAIT_TIMEOUT)` above) waits on a
        // locator matching zero elements and times out rather than failing fast, so this silently
        // turned every one of these three states (species/composition/zones tables) into a FAILED
        // pair on the parity page instead of a stale-selector error.
        await page.getByRole("button", { name: "Full screen", exact: true }).first().click();
        // the species table is the one panel that needs the engine (DuckDB-WASM + Parquet), so
        // wait for a real ROW rather than a fixed sleep over a spinner
        await page.waitForSelector("table tbody tr", { timeout: 60_000 });
        await page.waitForTimeout(1500);
      },
    },
  },
  {
    id: "scores-composition",
    title: "Scores · composition treemap",
    rows: ["S-19"],
    caption:
      "Composition of the same selection. The atlas's treemap is ONE level (species category); the Shiny app's has six WoRMS ranks (gap G-06).",
    shiny: {
      url: `${SHINY}/scores/ (tab "Table of Species" → "Composition")`,
      open: async (page) => {
        await openShinyScores(page);
        await shinyTab(page, "Table of Species");
        await page
          .locator("a[role=tab]", { hasText: "Composition" })
          .first()
          .click({ timeout: 20_000 });
        await page.waitForTimeout(6000);
      },
    },
    atlas: {
      search: "?ver=v7&theme=dark",
      after: async (page) => {
        await atlasTool(page, "Table");
        // the panel's own "Full screen" control, so the table shows the rows a reviewer wants to
        // compare against the Shiny app's full-tab table (the panel WIDTH is fixed by design).
        // housekeeping fix (2026-09-25): this read "Full height" -- the PHONE Sheet's own label
        // (Sheet.svelte) -- but this harness runs a single 1280x800 DESKTOP viewport, where the
        // maximize control is Panel.svelte's "Full screen" (see its aria-label, line ~366); U1's
        // R1 panel rework split the two, and this script was never updated. A fresh page.click()
        // (default 60s action timeout, `page.setDefaultTimeout(WAIT_TIMEOUT)` above) waits on a
        // locator matching zero elements and times out rather than failing fast, so this silently
        // turned every one of these three states (species/composition/zones tables) into a FAILED
        // pair on the parity page instead of a stale-selector error.
        await page.getByRole("button", { name: "Full screen", exact: true }).first().click();
        await page.getByRole("button", { name: "Composition" }).first().click({ timeout: 20_000 });
        // the treemap is a lazy chunk over an engine query: wait for a drawn cell, not a timer
        await page.waitForSelector(".table-panel svg rect, .table-panel canvas", {
          timeout: 60_000,
        });
        await page.waitForTimeout(1500);
      },
    },
  },
  {
    id: "scores-zones-table",
    title: "Scores · zones table (new)",
    rows: ["S-22"],
    caption:
      'Every zone of the release\'s one unit, ranked by the current layer, with all components — the keyboard and screen-reader equivalent of the choropleth, and the "report on selected" entry point. The Shiny apps have no equivalent (ID-13).',
    shiny: null,
    atlas: {
      search: "?ver=v7&unit=programarea&theme=dark",
      after: async (page) => {
        await atlasTool(page, "Table");
        // the panel's own "Full screen" control, so the table shows the rows a reviewer wants to
        // compare against the Shiny app's full-tab table (the panel WIDTH is fixed by design).
        // housekeeping fix (2026-09-25): this read "Full height" -- the PHONE Sheet's own label
        // (Sheet.svelte) -- but this harness runs a single 1280x800 DESKTOP viewport, where the
        // maximize control is Panel.svelte's "Full screen" (see its aria-label, line ~366); U1's
        // R1 panel rework split the two, and this script was never updated. A fresh page.click()
        // (default 60s action timeout, `page.setDefaultTimeout(WAIT_TIMEOUT)` above) waits on a
        // locator matching zero elements and times out rather than failing fast, so this silently
        // turned every one of these three states (species/composition/zones tables) into a FAILED
        // pair on the parity page instead of a stale-selector error.
        await page.getByRole("button", { name: "Full screen", exact: true }).first().click();
        await page.getByRole("button", { name: "Zones" }).first().click({ timeout: 20_000 });
        // Tier 0 only (boot.zones): rows appear without the engine, so this wait is short
        await page.waitForSelector("table tbody tr", { timeout: 30_000 });
        await page.waitForTimeout(1500);
      },
    },
  },
  {
    id: "species-default",
    title: "Species · default taxon",
    rows: ["P-01", "P-04", "P-08", "P-15"],
    caption:
      'Both open on Dermochelys coriacea (Leatherback Turtle), the merged model, from the same COG through the same titiler. Four things to compare. **The surface:** the atlas paints it on load; the Shiny app opens on a study-area globe with the taxon out of view and offers "Zoom to layer" (ID-12, G-02). **The inputs:** all six are SELECTABLE pills in Shiny, struck through in the atlas — because **v7 publishes no surface for any of them**, and the atlas says so in each pill\'s title rather than letting you pick one and see nothing (P-05; this is also why the plan\'s "viewing one input" state cannot be shown on a public release — the PMTiles range branch, P-09, is exercised against v9 fixtures in `e2e/species.smoke.spec.ts`). **The outlines:** Program Areas in white on the atlas, Ecoregions in black on Shiny, which also lets you change them (ID-11, G-25). **The card:** the same facts, ESA/IUCN/WoRMS/MMPA and the Values tree, in a panel instead of a drawer.',
    shiny: { url: `${SHINY}/species/`, open: (page) => openShinySpecies(page) },
    atlas: { search: "?ver=v7&lens=species&theme=dark" },
  },
  {
    id: "species-deeplink",
    title: "Species · legacy deep link (?mdl_seq=54383 → Walrus)",
    rows: ["P-16", "P-11"],
    caption:
      "The SAME legacy query on both sides. Shiny rewrites it to `?mdl_key=54383`; the atlas resolves it through the release's alias shard to `?sp=…`, logs `deeplink_mdl_key{resolution}` and rewrites the URL.",
    shiny: {
      url: `${SHINY}/species/?mdl_seq=54383`,
      open: (page) => openShinySpecies(page, "?mdl_seq=54383"),
    },
    atlas: { search: "?ver=v7&lens=species&mdl_seq=54383&theme=dark" },
  },
  {
    id: "species-picker",
    title: "Species · the picker, open",
    rows: ["P-01", "P-02"],
    caption:
      'The species picker with its list open: grouped by category, labelled `{sp_cat}: {scientific} (common)`, "Only species in US waters" on by default. The atlas searches ~22 k rows client-side (folded diacritics, scientific and common).',
    shiny: {
      url: `${SHINY}/species/ (Species picker, open)`,
      open: async (page) => {
        await openShinySpecies(page);
        await page.click("#sel_sp-selectized", { timeout: 20_000 });
        await page.waitForTimeout(2500);
      },
    },
    atlas: {
      search: "?ver=v7&lens=species&theme=dark",
      after: async (page) => {
        const field = page.getByRole("combobox").first();
        if (await field.count()) {
          await field.click({ timeout: 20_000 }).catch(() => {});
        } else {
          await page
            .getByPlaceholder(/search/i)
            .first()
            .click({ timeout: 20_000 });
        }
        await page.waitForTimeout(2500);
      },
    },
  },
  {
    id: "report-gaa",
    title: "Report · a Program Area (GAA)",
    rows: ["R-01", "R-02", "R-03", "R-21", "R-27"],
    caption:
      'Left: the Shiny Report tab — a FORM that POSTs to the API and renders server-side in "a couple of minutes". Right: the atlas report, recomputed in the browser from the release the moment the URL opens, with its own export bar (ID-04).',
    shiny: {
      url: `${SHINY}/scores/ (tab "Report")`,
      open: async (page) => {
        await openShinyScores(page);
        await shinyTab(page, "Report");
      },
    },
    atlas: {
      search: "?ver=v7&theme=dark#pl=z.pa.GAA&t=Gulf%20of%20Alaska%20Program%20Area",
      report: true,
    },
  },
  {
    id: "report-figures",
    title: "Report · map and flower (new)",
    rows: ["R-16", "R-17", "R-28"],
    caption:
      "The report's own figures: places filled by mean score over a ramp that spans THIS report (widened ±0.5 when equal), and one flower per place whose centre is the table's Overall. No Shiny equivalent was captured — the old report exists only after a server render.",
    shiny: null,
    atlas: {
      search: "?ver=v7&theme=dark#pl=z.pa.GAA&t=Gulf%20of%20Alaska%20Program%20Area",
      report: true,
      after: async (page) => {
        await page
          .locator("h2", { hasText: /Plot of Scores/i })
          .first()
          .scrollIntoViewIfNeeded()
          .catch(() => {});
        await page.waitForTimeout(3000);
      },
    },
  },
  {
    id: "theme-paper",
    title: "Scores · light theme",
    rows: [],
    caption:
      "Both apps carry a dark and a light theme. The atlas's is `?theme=light` (paper) — a URL value, so a shared link reproduces it; Shiny's is a toggle only.",
    shiny: {
      url: `${SHINY}/scores/ (theme toggle → light)`,
      open: async (page) => {
        await openShinyScores(page);
        // bslib's own dark-mode web component (`<bslib-input-dark-mode id="tgl_dark">`, top right);
        // it flips `<html data-bs-theme>`, which is what this waits on rather than a sleep.
        await page.locator("#tgl_dark").click({ timeout: 20_000 });
        await page.waitForFunction(
          () => document.documentElement.getAttribute("data-bs-theme") === "light",
          { timeout: 20_000 },
        );
        await page.waitForTimeout(4000);
      },
    },
    atlas: { search: "?ver=v7&theme=light" },
  },
];

// ---------------------------------------------------------------------------- the runner

async function capture(page, file) {
  const buf = await page.screenshot({ path: file, type: "jpeg", quality: 80 });
  return buf.length;
}

async function shootSide(browser, outDir, state, side) {
  const spec = state[side];
  if (!spec) return null;
  const file = join(outDir, `${state.id}-${side}.jpg`);
  const rel = `shots/${state.id}-${side}.jpg`;
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(WAIT_TIMEOUT);
    const t0 = Date.now();
    try {
      let url;
      if (side === "shiny") {
        await spec.open(page);
        url = spec.url;
      } else {
        url = await openAtlas(page, spec.search, { report: !!spec.report });
        if (spec.after) await spec.after(page);
      }
      const rendered =
        side === "shiny"
          ? await shinyRendered(page)
          : await atlasRendered(page, { report: !!spec.report });
      const bytes = await capture(page, file);
      const ms = Date.now() - t0;
      const blank = bytes < MIN_BYTES;
      await ctx.close();
      if (!rendered || blank) {
        lastError = !rendered ? "the app did not finish rendering" : `blank capture (${bytes} B)`;
        if (attempt < RETRIES) continue;
        return { side, file: rel, url, ms, bytes, ok: false, reason: lastError };
      }
      return { side, file: rel, url, ms, bytes, ok: true, reason: null };
    } catch (err) {
      lastError = String(err?.message ?? err).split("\n")[0];
      await ctx.close().catch(() => {});
      if (attempt >= RETRIES) {
        return {
          side,
          file: null,
          url: side === "shiny" ? spec.url : atlasUrl(spec.search, { report: !!spec.report }),
          ms: Date.now() - t0,
          bytes: 0,
          ok: false,
          reason: lastError,
        };
      }
    }
  }
  return null;
}

export async function run({ outDir, only, side = "both" }) {
  mkdirSync(outDir, { recursive: true });
  const states = only?.length ? STATES.filter((s) => only.includes(s.id)) : STATES;
  // `--only` and `--side` MERGE into an existing manifest: re-shooting one state, or only the
  // Atlas half of every state, must not drop what is already there. (The Shiny half costs ~70 s a
  // state -- the apps take that long to paint -- so `--side atlas` is the difference between a
  // 3-minute and a 20-minute re-run when only the Atlas changed.)
  const previous = new Map(
    (existsSync(join(outDir, "shots.json"))
      ? JSON.parse(readFileSync(join(outDir, "shots.json"), "utf8")).states
      : []
    ).map((s) => [s.id, s]),
  );
  // imported lazily so `scripts/parity-page/build.mjs` (and its vitest) can read STATES -- the
  // captions and the checklist ids below are page content -- without pulling in Playwright.
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const results = [];
  for (const state of states) {
    const keep = previous.get(state.id);
    const shiny =
      side === "atlas" ? (keep?.shiny ?? null) : await shootSide(browser, outDir, state, "shiny");
    const atlas =
      side === "shiny" ? (keep?.atlas ?? null) : await shootSide(browser, outDir, state, "atlas");
    const pairOk = (!state.shiny || shiny?.ok) && atlas?.ok;
    results.push({
      id: state.id,
      title: state.title,
      caption: state.caption,
      rows: state.rows,
      atlasOnly: !state.shiny,
      ok: !!pairOk,
      shiny,
      atlas,
    });
    const mark = pairOk ? "ok" : "FAILED";
    console.log(
      `${mark.padEnd(6)} ${state.id.padEnd(24)} shiny ${shiny ? `${shiny.ms} ms ${shiny.bytes} B ${shiny.ok ? "" : `(${shiny.reason})`}` : "(none)"} | atlas ${atlas ? `${atlas.ms} ms ${atlas.bytes} B ${atlas.ok ? "" : `(${atlas.reason})`}` : "(none)"}`,
    );
  }
  await browser.close();
  // the merged list is written in STATES order, never in the order they happened to be run
  for (const r of results) previous.set(r.id, r);
  const merged = STATES.map((s) => previous.get(s.id)).filter(Boolean);
  const manifest = {
    generated: new Date().toISOString(),
    viewport: VIEWPORT,
    shinyBase: SHINY,
    atlasBase: ATLAS,
    ver: "v7",
    states: merged,
  };
  writeFileSync(join(outDir, "shots.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...manifest, ran: results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : null;
  };
  const outDir = resolve(arg("out") ?? "docs/parity/shots");
  const only = (arg("only") ?? "").split(",").filter(Boolean);
  const side = arg("side") ?? "both";
  if (!["both", "shiny", "atlas"].includes(side))
    throw new Error(`--side must be both|shiny|atlas`);
  if (args.includes("--clean")) rmSync(outDir, { recursive: true, force: true });
  const manifest = await run({ outDir, only, side });
  const ran = manifest.ran;
  const failed = ran.filter((s) => !s.ok);
  console.log(
    `\nthis run: ${ran.length} states · ${ran.length - failed.length} complete · ${failed.length} failed` +
      ` | manifest now holds ${manifest.states.length} of ${STATES.length} states` +
      ` (${manifest.states.filter((s) => !s.ok).length} failed)`,
  );
  process.exit(failed.length ? 1 : 0);
}
