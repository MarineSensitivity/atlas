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
// 2026-09-25 fourth pass (P round V5 fix, Opus eyes-on review of 0.10.59): the THREE FIXED desktop pixel
// guesses below all sampled land for the current globe camera ((335,400)/(490,585)/(600,520) all read
// RGB 14,14,14 in the desktop-02 shot) -- the "stop at first real popup" loop from the third pass never
// found one, so states 06/07/09/10 silently shot the whole study area instead of a per-cell flower/table,
// and the log read clean because nothing WARNed about it (a hand-picked pixel is only ever correct for
// ONE camera). `tapScoredCell` no longer guesses pixels at all: it PROJECTS a short list of known,
// real-world scored lon/lat points (northern Gulf of Mexico, Gulf of Alaska, mid-Atlantic shelf) with
// the live `window.__atlasMap.handle.map.project()` (the exact technique e2e/places.pick.spec.ts's own
// `screenPointFor` and scripts/verify.mjs already use), so a tap survives any camera/zoom/projection the
// app ships next. When NONE of the candidates lands a real scored-cell popup, this WARNs explicitly and
// the caller marks the shot filename `-MISSED` (never a clean-looking log for an untested state again).
// Also new: a "programarea" state that selects a real Program Area through the Scores-lens search field
// (ScoresSearch.svelte -- same mechanism the Places picker's "Add a Program Area" uses) so the flower/
// table's PROGRAM AREA NAME ROUTING (map popup, flower title, table header) is actually visible in a
// screenshot for the first time -- every prior state only ever tapped a raw cell.
// 2026-09-25 fifth pass (W5 fix, Opus eyes-on review 5 of 0.10.66): the "report" state's own two
// scroll shots (14/15) blindly `mouse.wheel(0, 1400)` from the top of the report -- on the phone
// that never reaches the map figure at all (13-report-top ends at the "Map" heading), and on
// desktop it only ever shows the figure's own top 190px. Neither shot ever framed the figure's
// legend + figcaption, so the single-swatch legend (W4's own fix, `model.map.single`) and the
// painted place were never actually visible in any shot. A new "13b-report-map" shot scrolls the
// map figure itself (`figure[aria-describedby="map-summary"]`, Report.svelte's own selector for
// it) into view with a real `Element.scrollIntoView({block:"center"})` -- centred, not merely
// "into the viewport", so there is margin above AND below the figure's own ~450px height on both
// viewports -- then shoots it, on both viewports (no phone-only/desktop-only guard).
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
// R3-W8 item 4: the Flower plot is no longer its own rail tool -- it moved into the Layers pane as
// that pane's own second tab (`src/lib/ui/LayersPanel.svelte`'s `infoTab`, labelled "Flower plot"
// for the Scores lens). Opening it is now "Layers" (the rail tool) then "Flower plot" (the tab).
async function openFlowerTab(page) {
  await tool(page, "Layers");
  await page
    .getByRole("button", { name: "Flower plot", exact: true })
    .first()
    .click({ timeout: 20_000 });
  await page.waitForTimeout(1000);
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
// fourth pass (2026-09-25, V5 fix): known real-world points that are scored US ocean cells on
// every released version this harness targets -- never a pixel, which is only ever right for one
// camera. Each is `[lon, lat, label]`; `label` is for the WARN line only.
const KNOWN_SCORED_POINTS = [
  [-90.55, 28.6, "northern Gulf of Mexico"],
  [-150.0, 57.0, "Gulf of Alaska"],
  [-74.5, 38.5, "mid-Atlantic shelf"],
];

/** `map.project()` returns CANVAS-relative pixels; a real `page.mouse.click()` needs
 * viewport-absolute ones, so this adds the canvas's own `getBoundingClientRect()` offset -- the
 * SAME technique e2e/places.pick.spec.ts's `screenPointFor` and scripts/verify.mjs already use.
 * Returns `null` when the map handle is not mounted yet (a caller must not click blind on that). */
async function screenPointFor(page, lonLat) {
  return page.evaluate((ll) => {
    const map = window.__atlasMap?.handle?.map;
    if (!map) return null;
    const rect = map.getCanvas().getBoundingClientRect();
    const p = map.project(ll);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, lonLat);
}

/**
 * Taps the first of `KNOWN_SCORED_POINTS` that produces a REAL scored-cell popup, PROJECTED with
 * the live camera at shoot time rather than a hand-picked pixel (fourth-pass fix: the third pass's
 * fixed desktop pixels all sampled land once the globe camera changed, and the loop below -- kept
 * from the third pass -- silently found nothing to stop on, so four desktop states shot the whole
 * study area with no warning at all). V4's own "stop at first REAL popup" rule is unchanged: every
 * atlas popup carries `.atlas-popup` (`src/lib/map/popup.ts#createPopup`), but a click on
 * land/unscored ocean ALSO opens one, just with "No scored cell here" text, so a later candidate
 * must not fire once an earlier one already landed a real popup.
 *
 * Returns `true` on a hit, `false` when every candidate missed -- the caller WARNs and marks the
 * shot filename `-MISSED` rather than silently shooting the full study area again.
 */
async function tapScoredCell(page, vp) {
  for (const [lon, lat, label] of KNOWN_SCORED_POINTS) {
    const pt = await screenPointFor(page, [lon, lat]);
    if (!pt) {
      log(`  tapScoredCell: no map handle yet, skipping ${label}`);
      continue;
    }
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(2500);
    const popup = page.locator(".atlas-popup");
    if (await popup.count()) {
      const text = await popup
        .first()
        .innerText()
        .catch(() => "");
      if (!text.includes("No scored cell")) return true;
    }
    log(`  tapScoredCell: ${label} (${lon}, ${lat}) missed`);
  }
  log(`WARN tapScoredCell: every candidate point missed for ${vp} -- no per-cell state shot`);
  return false;
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
// V5 fix (new state): selects a real Program Area through the Scores-lens search field
// (ScoresSearch.svelte) so the flower/table's PROGRAM AREA NAME ROUTING (map popup, flower title,
// table header) is actually on screen -- every earlier state only ever tapped a raw cell, so a
// review could never check the routing this way (Opus eyes-on: "The routing of Program Area names
// through the name table ... cannot be checked from these shots, because no state selects a
// Program Area in the Scores lens"). Phone opens the search field inside its own modal first
// (Shell.svelte's `openPhoneSearch`); desktop's field is already in the topbar.
//
// Shell.svelte mounts BOTH the desktop topbar field (`[data-control="search"]`) and the phone
// modal's copy (inside its own `<dialog>`, role="dialog" name="Search") at once (same lazy
// `ScoresSearchComp` load gates both `{:else if}` branches) -- `page.getByLabel(...)` alone
// matched BOTH regardless of viewport, and `.waitFor()` on that 2-element locator failed
// silently (`.catch(() => false)`) rather than picking either -- measured: this WARNed on every
// phone run despite the modal genuinely being open and visible. Scoping to the ONE container
// each viewport actually uses removes the ambiguity.
async function selectProgramArea(page, vp) {
  let container;
  if (vp === "phone") {
    const trigger = page.getByRole("button", { name: "Search species and places" });
    if (await trigger.count()) {
      await trigger.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    container = page.getByRole("dialog", { name: "Search" });
  } else {
    container = page.locator('[data-control="search"]');
  }
  const input = container.getByRole("combobox", { name: "Search Program Areas or coordinates" });
  const ok = await input
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    log(`WARN selectProgramArea: no search field found for ${vp}`);
    return false;
  }
  // by KEY, not name: search.ts#matchZones matches only the release's own PUBLISHED zone `name`
  // (never the app-side PROGRAM_AREA_NAMES fallback labels use) -- the real v7 release publishes
  // no `name` at all for GAA (the same gap V1's fix documented for the report/flower/table
  // labels), so "Gulf of America" gets "No matches" while the key still resolves every time. The
  // rendered OPTION label still reads "Gulf of America (GAA)" via that same fallback, so this is
  // a robust way to reach it, not a workaround that only proves something else. (The search-by-
  // name gap itself is out of this round's scope -- reported, not fixed, in the hand-back.)
  await input.fill("GAA");
  await page.waitForTimeout(500);
  const option = container.getByRole("option", { name: /Gulf of America|GAA/i }).first();
  if (!(await option.count())) {
    log(`WARN selectProgramArea: no GAA match for ${vp}`);
    return false;
  }
  await option.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return true;
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
      // V5 fix: a MISSED tap (no candidate lon/lat landed a scored cell) still shoots, so the
      // orchestrator sees a real image -- but the filename itself now says so, rather than a
      // clean-looking log hiding four untested states the way it did before this fix.
      const hit = await tapScoredCell(p, vp);
      const missed = hit ? "" : "-MISSED";
      await openFlowerTab(p);
      await shot(p, vp, `06-flower-half${missed}`);
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
      await shot(p, vp, `07-flower-petal${missed}`);
      await sheet(p, "Full height");
      await shot(p, vp, `08-flower-full${missed}`);
    },
  },
  {
    id: "table",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      const hit = await tapScoredCell(p, vp);
      const missed = hit ? "" : "-MISSED";
      await tool(p, "Table");
      // third pass (b): the per-cell species list takes ~7s cold -- wait for it rather than
      // shooting mid-"Loading species…" (bounded; WARNs and shoots anyway if it never resolves).
      await waitForSpeciesLoaded(p);
      await shot(p, vp, `09-table-half${missed}`);
      await sheet(p, "Full height");
      await waitForSpeciesLoaded(p);
      await shot(p, vp, `10-table-full${missed}`);
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
      // W5 fix: the map figure itself (legend + caption) was never in frame -- 1400px blind scroll
      // on the phone overshoots it entirely, and on desktop only its top 190px ever showed. Scroll
      // it into view DIRECTLY (never by a fixed pixel guess), centred so there is margin on every
      // side of its own ~450px box (map + legend + figcaption), then shoot before the two blind
      // scrolls below (which cover the rest of the report unrelated to this figure).
      const mapFigure = r.locator('figure[aria-describedby="map-summary"]');
      if (await mapFigure.count()) {
        await mapFigure.evaluate((el) =>
          el.scrollIntoView({ block: "center", behavior: "instant" }),
        );
        await r.waitForTimeout(500);
        await shot(r, vp, "13b-report-map");
      } else {
        log(
          `WARN report-map: figure[aria-describedby='map-summary'] not found -- skipping the map-figure shot`,
        );
      }
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
  {
    id: "programarea",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      const picked = await selectProgramArea(p, vp);
      const missed = picked ? "" : "-MISSED";
      await shot(p, vp, `19-programarea-popup${missed}`);
      // R3-B17 (Opus eyes-on review 5, 2026-09-25): review 5 could not verify the map tooltip's
      // FULL Program Area name in 19-programarea-popup on desktop -- the docked panel (still open
      // at its default detent from page load; nothing in this state ever collapses it) sits over
      // the popup's own anchor point. `selectZone`'s bounds-fit padding (state.svelte.ts) only
      // reserves the panel's footprint when a REAL zone bbox is available (a loaded map tile
      // today, R3-B14/C3's published `boot.zones[].bbox` once a release carries one); the
      // fallback path centers the camera on the WHOLE viewport, which the panel then covers. This
      // does not change what the app itself renders -- it just gets the panel out of the way
      // (same `collapseSheet` used by state "map"/02) so this harness can actually photograph the
      // tooltip's full name on desktop.
      if (vp === "desktop") {
        await collapseSheet(p);
        await shot(p, vp, `19b-programarea-popup-collapsed${missed}`);
      }
      await openFlowerTab(p);
      await shot(p, vp, `20-programarea-flower${missed}`);
      await tool(p, "Table");
      await waitForSpeciesLoaded(p);
      await shot(p, vp, `21-programarea-table${missed}`);
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
