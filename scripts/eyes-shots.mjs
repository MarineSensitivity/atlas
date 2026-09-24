// scripts/eyes-shots.mjs -- eyes-on screenshots of a LOCAL preview build: the states a person looks at,
// phone (390x844 @2x) + desktop (1280x800), dark theme. Part of every merge since 2026-09-24 (Ben found
// seven obvious phone bugs on a tree every automated gate had passed).
//   npm run build && npx vite preview --port 4386 --strictPort &
//   ATLAS_URL=http://localhost:4386 OUT=.tmp/eyes [ONLY=map,layers] node scripts/eyes-shots.mjs
// 2026-09-24 second pass (Opus review of the first set): welcome needs a BARE url (any query counts as a
// deep link and suppresses the modal); the desktop maximize button is "Full screen"; one browser context
// per state (the sheet detent persists in localStorage); the report opens in a NEW TAB; taps on ocean.
// 2026-09-24 third pass (Opus review, "process" finding #5 -- 3 false results in the second-pass set):
// (a) the flower-petal selector (`svg path` nth(3)) never hit a real petal -- petals are `path.petal`,
// and a real petal can be a zero-score DEGENERATE path (`d=""`, flowerGeometry.ts) that a click cannot
// land on, so the selector also skips those; the step now waits for the tap/hover label
// (`.petal-label`) to actually appear before shooting, and WARNs (never throws) if it does not.
// (b) "Loading species..." takes ~7s cold (real DuckDB-WASM query) -- the table step used to shoot 3-5s
// in, catching the loading text mid-flight; it now waits (bounded 30s) for that text to clear AND a
// real `.species-table` row to render, and WARNs rather than failing outright if neither happens in time
// (a place with genuinely no species would otherwise hang the whole harness for 30s every run).
// (c) Layers is the DEFAULT open tool at its DEFAULT "half" detent (Shell.svelte's `activeTool` state /
// Sheet.svelte's `DEFAULT_SHEET_DETENT`), so 02 (map, no tool click) and 03 (layers, explicit click)
// used to shoot the SAME panel state byte-for-byte -- 02 now collapses the sheet/panel first ("Collapse
// to a peek" on phone, "Collapse to a pill" on desktop) so it shows a clean map, distinct from 03.
// (d) the phone tap points sat low enough in the map area that a resulting popup could land partly under
// the legend chip -- moved higher into the free map area, above the chip's own band.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const BASE = process.env.ATLAS_URL ?? "http://localhost:4380/atlas";
const OUT = process.env.OUT ?? ".tmp/eyes";
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = {
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function go(page, search) {
  await page.goto(`${BASE}/${search}`, { waitUntil: "load", timeout: 90_000 });
  await page.waitForTimeout(4000);
}
async function explore(page) {
  const b = page.getByRole("button", { name: /^explore$/i }).first();
  try {
    await b.waitFor({ state: "visible", timeout: 8000 });
    await b.click();
    await page.waitForTimeout(500);
  } catch {
    /* no welcome modal on this load (deep link or already dismissed) */
  }
}
async function tool(page, name) {
  await page.getByRole("button", { name, exact: true }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(3000);
}
async function sheet(page, name) {
  // phone: "Full height"; desktop (R1 panel): "Full screen"
  for (const n of [name, name === "Full height" ? "Full screen" : name]) {
    const b = page.getByRole("button", { name: n, exact: true }).first();
    if (await b.count()) {
      await b.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
      return;
    }
  }
}
// third pass (c): collapses the default-open Layers panel/sheet down to its smallest detent, so the
// "map" state (02) shows a clean map instead of Layers at its default "half" detent -- byte-identical
// to what "layers" (03) shoots on purpose. phone: "Collapse to a peek" (Sheet.svelte); desktop (R1
// panel): "Collapse to a pill" (Panel.svelte). Best-effort: a release with no default tool open (none
// today) simply finds neither button and leaves the map as-is.
async function collapseSheet(page) {
  for (const n of ["Collapse to a peek", "Collapse to a pill"]) {
    const b = page.getByRole("button", { name: n, exact: true }).first();
    if (await b.count()) {
      await b.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}
async function tapScoredCell(page, vp) {
  // a point in the Gulf of Alaska / California Current after the padded first view; try a few.
  // third pass (d): the phone points sit HIGHER in the map's free area than before -- a point low in
  // the map (closer to the bottom sheet's own band) put the resulting popup partly under the legend
  // chip (Opus re-shot finding); these stay well above where either the chip or a peek-detent sheet
  // sits.
  const pts =
    vp === "phone"
      ? [
          [75, 170],
          [60, 140],
          [90, 200],
        ]
      : [
          [335, 400],
          [490, 585],
          [600, 520],
        ];
  // V4 fix (owner phone report, 2026-09-24, harness item 4): this used to click every candidate
  // point regardless of outcome, so when an EARLIER point already landed a scored cell (a real
  // popup) a LATER point landing on land or open ocean could still fire and dismiss/replace it
  // (`closeOnClick`/a no-data reset) -- measured: states 06/07/09/10 (flower/table) ended up
  // showing the full study area instead of a scored-cell popup on desktop. Every atlas popup
  // carries `.atlas-popup` (`src/lib/map/popup.ts#createPopup`, the ONE popup constructor both
  // lenses use) -- stop at the first tap that produces one.
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(2500);
    if (await page.locator(".atlas-popup").count()) return;
  }
}
// third pass (b): "Loading species..." (TablePanel.svelte) takes ~7s on a cold DuckDB-WASM query --
// waits (bounded, never longer than timeoutMs total) for that text to clear AND a real
// `.species-table` row to render before the caller shoots, so the PNG shows the loaded table rather
// than a mid-flight loading state. A place with genuinely no species (or a load slower than the
// budget) never gets a data row -- this WARNs and returns rather than throwing, so the harness still
// shoots SOMETHING and the orchestrator can see the warning in the log.
async function waitForSpeciesLoaded(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  const loadingGone = await page
    .getByText("Loading species…", { exact: true })
    .first()
    .waitFor({ state: "hidden", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  const remaining = Math.max(0, deadline - Date.now());
  const gotRow = await page
    .locator(".species-table tbody tr")
    .first()
    .waitFor({ state: "visible", timeout: remaining })
    .then(() => true)
    .catch(() => false);
  if (!loadingGone || !gotRow) {
    log(
      "WARN species table did not finish loading within",
      timeoutMs,
      `ms (loadingGone=${loadingGone}, gotRow=${gotRow})`,
    );
  }
}
async function shot(page, vp, name) {
  const p = `${OUT}/${vp}-${name}.png`;
  await page.screenshot({ path: p, timeout: 30_000 });
  log("shot", p);
}
const STATES = [
  {
    id: "welcome",
    run: async (p, vp) => {
      await go(p, "");
      await shot(p, vp, "01-welcome");
    },
  },
  {
    id: "map",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      // third pass (c): Layers is the default open tool at its default "half" detent -- without
      // this, 02 shoots the identical panel state "layers" (03) shoots on purpose.
      await collapseSheet(p);
      await shot(p, vp, "02-map");
    },
  },
  {
    id: "layers",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      await tool(p, "Layers");
      await shot(p, vp, "03-layers-half");
      await sheet(p, "Full height");
      await shot(p, vp, "04-layers-full");
    },
  },
  {
    id: "legend",
    run: async (p, vp) => {
      if (vp !== "phone") return;
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      const c = p.locator(".legend-chip").first();
      if (await c.count()) {
        await c.click();
        await p.waitForTimeout(800);
        await shot(p, vp, "05-legend-modal");
      } else log("no legend chip");
    },
  },
  {
    id: "flower",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      await tapScoredCell(p, vp);
      await tool(p, "Flower plot");
      await shot(p, vp, "06-flower-half");
      // third pass (a): petals are `path.petal` (Flower.svelte), never a bare `svg path` -- and a
      // real petal can be a zero-score DEGENERATE path (`d=""`, flowerGeometry.ts) with no area to
      // click, so this also skips those. A low-score petal is still a real (non-degenerate) path,
      // but a thin annular sliver's BOUNDING-BOX centre -- what Playwright's plain `.click()` targets
      // -- can land in the box's own empty corner rather than on the painted crescent (measured: the
      // FIRST real petal on a live v7 cell was "Bird 3.2", too thin to hit this way). Tries each
      // non-degenerate petal in DOM order until one's tap label (`.petal-label`) actually shows,
      // rather than assuming the first one worked.
      const petals = p.locator('svg path.petal:not([d=""])');
      const petalCount = await petals.count();
      let labelShown = false;
      for (let i = 0; i < petalCount && !labelShown; i++) {
        await petals
          .nth(i)
          .click({ timeout: 5000 })
          .catch(() => {});
        labelShown = await p
          .locator(".petal-label")
          .first()
          .waitFor({ state: "visible", timeout: 2000 })
          .then(() => true)
          .catch(() => false);
      }
      if (!labelShown) log("WARN flower petal tap produced no visible label");
      await shot(p, vp, "07-flower-petal");
      await sheet(p, "Full height");
      await shot(p, vp, "08-flower-full");
    },
  },
  {
    id: "table",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      await tapScoredCell(p, vp);
      await tool(p, "Table");
      // third pass (b): the per-cell species list takes ~7s cold -- wait for it rather than
      // shooting mid-"Loading species…" (bounded; WARNs and shoots anyway if it never resolves).
      await waitForSpeciesLoaded(p);
      await shot(p, vp, "09-table-half");
      await sheet(p, "Full height");
      await waitForSpeciesLoaded(p);
      await shot(p, vp, "10-table-full");
    },
  },
  {
    id: "places",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      await tool(p, "Places");
      await shot(p, vp, "11-places");
      await sheet(p, "Full height");
      await shot(p, vp, "12-places-full");
    },
  },
  {
    id: "report",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark#pl=z.pa.GAA&t=Gulf%20of%20America%20Program%20Area");
      await explore(p);
      const popupP = p
        .context()
        .waitForEvent("page", { timeout: 15_000 })
        .catch(() => null);
      await tool(p, "Report");
      // the rail opens the chooser sheet; "Open report" is what opens report.html in a new tab
      const open = p.getByRole("button", { name: /open report/i }).first();
      if (await open.count()) await open.click({ timeout: 10_000 }).catch(() => {});
      await sheet(p, "Full height");
      const popup = await popupP;
      const r = popup ?? p;
      if (popup) {
        await popup.waitForLoadState("load").catch(() => {});
        log("report opened in a new tab", popup.url());
      }
      await r.waitForTimeout(8000);
      await shot(r, vp, "13-report-top");
      await r.mouse.wheel(0, 1400);
      await r.waitForTimeout(800);
      await shot(r, vp, "14-report-scrolled");
      await r.mouse.wheel(0, 1400);
      await r.waitForTimeout(800);
      await shot(r, vp, "15-report-scrolled2");
    },
  },
  {
    id: "more",
    run: async (p, vp) => {
      if (vp !== "phone") return;
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      const b = p.getByRole("button", { name: "More" }).first();
      if (await b.count()) {
        await b.click();
        await p.waitForTimeout(600);
        await shot(p, vp, "16-more-menu");
      }
    },
  },
  {
    id: "species",
    run: async (p, vp) => {
      await go(p, "?ver=v7&lens=species&theme=dark");
      await explore(p);
      await shot(p, vp, "17-species");
      await go(p, "?ver=v7&lens=species&mdl_seq=54383&theme=dark");
      await explore(p);
      await p.waitForTimeout(6000);
      await shot(p, vp, "18-species-model");
    },
  },
];
const browser = await chromium.launch();
for (const [vp, opts] of Object.entries(VIEWPORTS)) {
  for (const st of STATES) {
    if (only.length && !only.includes(st.id)) continue;
    // a FRESH context per state: the sheet detent / theme / welcome state live in localStorage
    const ctx = await browser.newContext({ ...opts, colorScheme: "dark" });
    const page = await ctx.newPage();
    try {
      await st.run(page, vp);
    } catch (e) {
      log("FAIL", vp, st.id, String(e).split("\n")[0]);
    }
    await ctx.close();
  }
}
await browser.close();
log("done");
