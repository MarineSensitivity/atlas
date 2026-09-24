// atlas-8 step 3, pyramid row "Accessibility": the **scripted keyboard walk**. The plan's own
// sentence is the test plan, verbatim: "select a Program Area, read its scores from the zones
// table, create a place by coordinates, open and export the report, all without a pointer."
//
// NO POINTER, ANYWHERE. Not one `click()`, `fill()`, `check()`, `hover()` or `.focus()` on a target
// control appears below: every control is reached with Tab / Shift+Tab / Arrow keys and activated
// with Enter or Space, and every character typed goes through `keyboard.type()`. (`focus()` on the
// *document body* to start a walk is not a pointer action; nothing else is focused directly.)
// A step that CANNOT be completed that way is a FINDING, recorded as `test.fixme` with its id from
// `docs/accessibility-fixes.md` -- never a reason to reach for the mouse.
//
// WEBKIT: Safari's "Full Keyboard Access" is off by default, so its native Tab sequence visits only
// links and text fields, not buttons; its equivalent key is Option+Tab, Playwright's "Alt+Tab" (the
// same platform default e2e/shell.a11y.spec.ts:189 and e2e/species.smoke.spec.ts's "US only" test
// already document). `tab()`/`shiftTab()` below pick the right one per engine, so this walk really
// does run on all three.
//
// AT EVERY STEP: `assertFocusUsable()` checks that `document.activeElement` is still a real,
// rendered, on-screen control (not `<body>` -- "focus lost") AND that it has an accessible name,
// computed by Playwright's own accname implementation (`ariaSnapshot()`), not a hand-rolled
// approximation. Those two assertions are what the seeded faults in `tests/faults/` turn red:
// `hexbutton-unnamed.patch` (a rail button with no name) and `modal-focus-restore.patch` (a modal
// opened by setting the `open` attribute instead of `showModal()`, so closing it restores focus to
// nothing).
//
// HERMETIC, same convention as every other spec here.
import { expect, test, type Page } from "@playwright/test";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs } from "./map-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 900 } });

const VER = "v7"; // public per hermetic.ts's VERSIONS_FIXTURE -- no preview session needed

/** the ranked layer, and the component the zones table shows beside it. */
const COMPOSITE_KEY = "score_extriskspcat_primprod_ecoregionrescaled_equalweights";
const COMPOSITE_LABEL = "Overall score";

/** the Program Area this walk selects, and the score the zones table must show for it. Read from
 * THIS object by the assertions below, never retyped: the test's expected number and the fixture's
 * published number are one value. */
const TOP_ZONE = { key: "GAA", name: "Gulf of America", score: 73.4 };
// P3 fix (owner-reported, 2026-09-24): "Program area selection should list full names and
// parenthetical acronyms" -- the zone button's/checkbox's accessible name and the Zone column
// cell now read "Gulf of America (GAA)", not the bare name (`paLabel`, src/places/zoneStats.ts).
const TOP_ZONE_LABEL = `${TOP_ZONE.name} (${TOP_ZONE.key})`;
const ZONES = [
  {
    key: TOP_ZONE.key,
    name: TOP_ZONE.name,
    metrics: { [COMPOSITE_KEY]: TOP_ZONE.score, extrisk_bird_ecoregion_rescaled: 51.2 },
  },
  {
    key: "MDA",
    name: "Mid Atlantic",
    metrics: { [COMPOSITE_KEY]: 12.5, extrisk_bird_ecoregion_rescaled: 9.5 },
  },
];

// `units: []` on purpose -- "no drawable unit published" (boot.ts's pre-atlas-1 fallback, the same
// shape e2e/places.spec.ts's round-trip fixture uses), so this walk needs no PMTiles archive and no
// titiler tile: the zones table ranks `boot.zones[primaryUnitType() ?? "programarea"]` either way
// (TablePanel.svelte's own `zonesUnit`), and a zone row's value is read from `boot` VERBATIM
// (zonesTable.ts) -- never recomputed, never an engine call. That is exactly what makes this walk's
// "the number a screen reader hears" assertion meaningful without a DuckDB boot.
const BOOT = {
  ver: VER,
  built_at: "2026-09-05T00:00:00Z",
  id_field: "mdl_key",
  // `grid_id` only, exactly as e2e/report.spec.ts's own zone-place fixture publishes it: with no
  // cell geometry in `boot`, the data engine never boots at all (`getDataEngine` needs a real grid),
  // so a ZONE report completes from `boot.zones[*].metrics` alone -- which is the property this walk
  // depends on (it blocks every `.wasm`, and a keyboard gate must not also be a DuckDB gate). The
  // engine-backed report paths are e2e/report.spec.ts's second fixture tier, with real Parquet.
  grid: { grid_id: "test05r" },
  release: { status: "release", access: "public" },
  units: [],
  zones: { programarea: ZONES },
  datasets: [],
  layers: [
    { metric_key: COMPOSITE_KEY, label: COMPOSITE_LABEL, category: "composite", order: 1 },
    {
      metric_key: "extrisk_bird_ecoregion_rescaled",
      label: "Bird",
      category: "component",
      order: 2,
    },
  ],
};

// --- keyboard primitives -------------------------------------------------------------------------

function tabKey(browserName: string): string {
  return browserName === "webkit" ? "Alt+Tab" : "Tab";
}

function shiftTabKey(browserName: string): string {
  return browserName === "webkit" ? "Shift+Alt+Tab" : "Shift+Tab";
}

interface FocusInfo {
  tag: string;
  id: string;
  cls: string;
  onScreen: boolean;
  rendered: boolean;
  text: string;
  /** the id of the recorded finding that explains why this stop has no accessible name, if any. */
  unnamedFinding: string | null;
}

/**
 * Tab stops KNOWN to have no accessible name, each tied to the finding that records it and to a
 * failing test of its own below. The walk still visits them and still asserts they are rendered,
 * on-screen and not `<body>` -- this exempts the NAME check only. Without it, one defect on one
 * engine's Tab path would stop the whole walk and every later step's coverage with it; with it, the
 * defect is still reported (by its own `test.fixme`), the walk keeps going, and when the fix lands
 * that test goes green and the entry here is deleted. Nothing is added here without a finding id.
 *
 * EMPTY as of the fix round (A11Y-7, the panel body's own name, is fixed -- Panel.svelte's
 * `.panel-body` now carries `role="group" aria-label="{title} details"`): "what the re-audit must
 * show" item 4 (docs/accessibility-fixes.md).
 */
const KNOWN_UNNAMED_STOPS: ReadonlyArray<{ selector: string; finding: string }> = [];

/** the attribute `focusInfo()` stamps on the current `document.activeElement` so the name lookup
 * below can address it by a plain attribute selector. `page.locator(":focus")` looks like the
 * obvious way to do that and is NOT portable: on WebKit, a `<dialog>` opened with `showModal()`
 * takes focus by delegation and `document.querySelector(":focus")` then matches nothing at all,
 * while `document.activeElement` is perfectly well defined (measured -- every stop inside the
 * coordinate dialog timed out on webkit before this). No CSS or test selector in this repo keys off
 * this attribute; it is removed again on the next call. */
const FOCUS_MARK = "data-kw-focus";

/** what `document.activeElement` currently is, geometrically and visually. `null` means focus is on
 * `<body>` (or nowhere) -- i.e. lost. */
async function focusInfo(page: Page): Promise<FocusInfo | null> {
  return page.evaluate(
    ([mark, known]: [string, typeof KNOWN_UNNAMED_STOPS]) => {
      document.querySelectorAll(`[${mark}]`).forEach((n) => n.removeAttribute(mark));
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return null;
      el.setAttribute(mark, "");
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id,
        cls: el.className?.toString?.() ?? "",
        // intersects the viewport, with a real box: a control scrolled into a panel's own overflow
        // container is legitimately only partly visible, but one parked entirely off-screen (the
        // classic "focus went somewhere invisible") never intersects it at all.
        onScreen:
          r.width > 0 &&
          r.height > 0 &&
          r.right > 0 &&
          r.bottom > 0 &&
          r.left < window.innerWidth &&
          r.top < window.innerHeight,
        // `opacity` is deliberately NOT part of this: the file-upload control is a transparent
        // `<input type="file">` stretched over a visible `<label>` (UploadPanel.svelte), a legitimate
        // pattern -- as long as the visible wrapper shows a focus indicator, which is SC 2.4.7 and
        // its own gate below (finding A11Y-3), not "focus was lost".
        rendered: cs.display !== "none" && cs.visibility !== "hidden",
        text: (el.textContent ?? "").trim().slice(0, 60),
        unnamedFinding: known.find((k) => el.matches(k.selector))?.finding ?? null,
      };
    },
    [FOCUS_MARK, KNOWN_UNNAMED_STOPS] as [string, typeof KNOWN_UNNAMED_STOPS],
  );
}

/** the focused element's accessible name, via Playwright's own accname implementation. An
 * `ariaSnapshot()` opens with `- <role> "<name>"` (the name is omitted entirely when there is
 * none), so the quoted group is present exactly when the element HAS a computed name. Call only
 * after `focusInfo()` has stamped `FOCUS_MARK`. */
async function focusedAccessibleName(page: Page): Promise<string | null> {
  const snapshot = await page.locator(`[${FOCUS_MARK}]`).ariaSnapshot();
  const firstLine = snapshot.split("\n")[0] ?? "";
  const match = /^-\s+\S+\s+"([^"]*)"/.exec(firstLine.trim());
  return match ? match[1] : null;
}

/** every step of the walk asserts this: focus is on a rendered, on-screen control that has an
 * accessible name. Returns that name, so a caller can also assert WHICH control it landed on. */
async function assertFocusUsable(
  page: Page,
  step: string,
  // pass the info a caller ALREADY read rather than re-reading it: two `focusInfo()` calls are two
  // round trips, and focus can legitimately change between them (finding A11Y-5 does exactly that,
  // ~100 ms after a rail tool swap) -- which would report the race rather than the state the caller
  // actually decided on.
  known?: FocusInfo | null,
): Promise<string> {
  const info = known !== undefined ? known : await focusInfo(page);
  expect(info, `${step}: focus was lost (document.activeElement is <body>)`).not.toBeNull();
  expect(
    info!.rendered,
    `${step}: focus is on a non-rendered element (${info!.tag}.${info!.cls})`,
  ).toBe(true);
  expect(info!.onScreen, `${step}: focus is off-screen (${info!.tag}.${info!.cls})`).toBe(true);
  const name = await focusedAccessibleName(page);
  // a stop on the recorded known-unnamed list keeps the walk moving; its own test still fails.
  if (!name && info!.unnamedFinding) {
    return `<unnamed ${info!.tag}.${info!.cls} — ${info!.unnamedFinding}>`;
  }
  expect(
    name,
    `${step}: the focused <${info!.tag} class="${info!.cls}"> has no accessible name`,
  ).toBeTruthy();
  return name!;
}

/**
 * Press Tab (or Shift+Tab) until the focused control's accessible name matches, asserting
 * `assertFocusUsable()` on EVERY intermediate stop -- so a nameless or off-screen control anywhere
 * along the path fails the walk even when the destination is reachable. Keyboard only: this is what
 * a person pressing Tab repeatedly actually does.
 */
async function tabTo(
  page: Page,
  browserName: string,
  want: string | RegExp,
  opts: { max?: number; back?: boolean; step: string } = { step: "tabTo" },
): Promise<void> {
  const max = opts.max ?? 60;
  const key = opts.back ? shiftTabKey(browserName) : tabKey(browserName);
  const seen: string[] = [];
  const hit = (name: string) => (typeof want === "string" ? name === want : want.test(name));
  for (let i = 0; i <= max; i++) {
    // the CURRENT stop counts: a dialog's `showModal()` already puts focus on its first control,
    // and "Tab until you reach X" must not step past an X you are standing on. Focus sitting on
    // `<body>` here is not a failure -- it is where a walk STARTS (and, on webkit, where finding
    // A11Y-5 leaves it) -- so the walk simply presses Tab and re-enters from the document top.
    const info = await focusInfo(page);
    if (info) {
      const name = await assertFocusUsable(page, `${opts.step} (stop ${i})`, info);
      seen.push(name);
      if (hit(name)) return;
    }
    if (i === max) break;
    await page.keyboard.press(key);
  }
  throw new Error(
    `${opts.step}: ${max} presses of ${key} never reached ${want}. Visited: ${seen.join(" | ")}`,
  );
}

/** the rail is a roving-tabindex toolbar: Tab reaches it once, then Arrow keys move within it. */
async function railArrowTo(page: Page, label: string, step: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const name = await assertFocusUsable(page, `${step} (rail stop ${i + 1})`);
    if (name === label) return;
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`${step}: the rail's arrow keys never reached "${label}"`);
}

// --- the shared starting point ---------------------------------------------------------------

async function gotoWalk(page: Page, path = "/?proj=mercator"): Promise<void> {
  // every fixture is registered on the browser CONTEXT, not this page: step 3 opens the report in a
  // SECOND tab (`window.open`, the popup-blocker rule TablePanel.svelte's own `onReportSelected`
  // documents), and a page-scoped `page.route()` does not follow it. `BrowserContext` exposes the
  // same `route()`/`addInitScript()` these helpers actually call, so this is a type-SHAPE cast, not
  // a behaviour change (the same kind ScoresLens.svelte's `QueryableMap` cast documents).
  const ctx = page.context() as unknown as Page;
  await blockWasm(ctx); // no engine needed: every number this walk reads comes from boot.json
  await routeBucket(ctx, VER, BOOT);
  await routeSession(ctx, null);
  await routeSealFixture(ctx);
  await routeBasemapStyle(ctx);
  await routeGlyphs(ctx);
  await page.goto(path);
  await waitForHydration(page);
  // start from the very top of the document, the way a keyboard user arriving at the page does.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

/** is `document.activeElement` inside `selector`'s subtree? */
async function focusedInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(
    (sel) => !!(document.activeElement as HTMLElement | null)?.closest?.(sel),
    selector,
  );
}

/** Tab to the "Skip to the tools" link, activate it, and Tab on until the caret is actually inside
 * the rail -- the shell's own documented route from the top of the document into the tool rail
 * (index.html's two skip links, atlas-8's fix for "the rail was reachable only by Shift+Tab").
 *
 * ONE Tab is enough on chromium and webkit. On firefox it is not: see finding A11Y-6 -- the skip
 * link's target `#rail-region` is a plain `<nav>` with no `tabindex`, and firefox puts the
 * sequential-focus starting point AFTER that element's whole subtree, so the first Tab lands on the
 * panel's "Collapse to a pill" and the rail is skipped entirely. The walk keeps Tabbing (round the
 * document if it has to) rather than stopping, and A11Y-6's own test below is what records it. */
async function enterRail(page: Page, browserName: string, step: string): Promise<void> {
  await tabTo(page, browserName, "Skip to the tools", { step: `${step}: skip link` });
  await page.keyboard.press("Enter");
  await page.keyboard.press(tabKey(browserName));
  if (await focusedInside(page, "#rail-region")) {
    await assertFocusUsable(page, `${step}: first rail stop`);
    return;
  }
  // firefox overshoots into the panel (A11Y-6). The rail sits immediately BEFORE the panel in DOM
  // order, so Shift+Tab walks back into it -- still keyboard only, and still the route a person
  // who noticed the overshoot would take.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(shiftTabKey(browserName));
    const info = await focusInfo(page);
    if (!info) continue;
    await assertFocusUsable(page, `${step}: walking back into the rail (stop ${i})`, info);
    if (await focusedInside(page, "#rail-region")) return;
  }
  throw new Error(`${step}: neither Tab nor Shift+Tab reached the tool rail after the skip link`);
}

/** rail -> the named tool, opened. */
async function openTool(
  page: Page,
  browserName: string,
  label: string,
  step: string,
): Promise<void> {
  await enterRail(page, browserName, step);
  await railArrowTo(page, label, step);
  await page.keyboard.press("Enter");
  await expect(page.locator("#panel-region")).toContainText(label);
  // On webkit the tool swap drops focus to <body> about 100 ms later -- finding A11Y-5, gated by
  // its own test below. The walk does NOT stop there: it continues the way a person who just lost
  // the caret has to, by Tabbing again from the top of the document (`tabTo` handles a `<body>`
  // start). Nothing here reaches for a pointer, and nothing here calls `.focus()` on a control.
}

// =================================================================================================
// STEP 1 -- select a Program Area, and read its score, from the zones table
// =================================================================================================

test.describe("step 0: every tab stop announces itself", () => {
  // FIX LIST #A11Y-7, FIXED: the desktop details panel's scrollable body used to be
  // `<div class="panel-body" id="panel-body-shell" tabindex="0">` (Panel.svelte) with NO role and
  // NO accessible name -- a tab stop a screen reader announced as nothing at all. Its phone twin,
  // `Sheet.svelte`'s `.sheet-body`, already carried `role="region" aria-label="{title} details"`;
  // this one lost its label when atlas-3's handover item (a) removed the nested landmark and kept
  // the `tabindex="0"` (which axe's own `scrollable-region-focusable` rule requires). SC 4.1.2
  // Name, Role, Value (A). Now `role="group" aria-label="Layers details"` (a `group`, not a
  // `region`, so the near-duplicate-landmark problem that atlas-3 fix addressed does not come
  // back -- see Panel.svelte's own header comment). REVERTED (this fix alone) -> RED: this test
  // fails with "no accessible name" the moment `role`/`aria-label` are removed from
  // `.panel-body`.
  test("the panel body is a named region, like the sheet body is", async ({ page }) => {
    await gotoWalk(page);
    const body = page.locator("#panel-region .panel-body");
    await expect(body).toHaveAttribute("tabindex", "0");
    await expect(body).toHaveAttribute("role", "group");
    expect(
      (await body.ariaSnapshot()).split("\n")[0],
      "a focusable scroll container must carry a role and a name",
    ).toMatch(/^-\s+\S+\s+"/);
    expect(await body.getAttribute("aria-label")).toBe("Layers details");
  });
});

test.describe("step 0: the rail itself keeps the caret", () => {
  // FIX LIST #6, FIXED (was FIREFOX ONLY): "Skip to the tools" points at `#rail-region`, which
  // used to be a plain `<nav>` with no `tabindex` -- activating the link only moved the
  // sequential-focus STARTING POINT, and firefox placed that point AFTER the target's whole
  // subtree (chromium/webkit happened to land correctly anyway). Measured before the fix: the
  // first Tab after the skip link landed on the panel's "Collapse to a pill" on firefox (the rail
  // skipped entirely). `tabindex="-1"` on `#rail-region` (Shell.svelte) is the standard remedy:
  // the target itself now takes focus directly, so every engine agrees. REVERTED (this fix alone)
  // -> RED on firefox: without `tabindex="-1"` the first Tab lands outside `#rail-region` again.
  test("'Skip to the tools' lands the caret on the tool rail", async ({ page, browserName }) => {
    await gotoWalk(page);
    await tabTo(page, browserName, "Skip to the tools", { step: "A11Y-6: the skip link" });
    await page.keyboard.press("Enter");
    await page.keyboard.press(tabKey(browserName));
    expect(
      await focusedInside(page, "#rail-region"),
      "the first Tab after the skip link must be inside #rail-region",
    ).toBe(true);
  });

  // FIX LIST #5, FIXED (was WEBKIT ONLY): activating a rail tool that CHANGES the open tool used
  // to drop `document.activeElement` to `<body>` roughly 100 ms after the keypress -- i.e. once
  // the newly-chosen tool's lazy panel chunk resolved and the panel body swapped. Measured before
  // the fix (100 ms polls, webkit): activating the ALREADY-open tool kept focus indefinitely,
  // arrowing within the rail without activating kept focus indefinitely, and activating a
  // DIFFERENT tool lost it by the first poll -- chromium and firefox never did any of this.
  // SC 2.4.3 Focus Order (A). Shell.svelte's `armRailFocusRestore` (a `MutationObserver` on
  // `#panel-region`, since the exact swap is not timed to one known instant -- an async import
  // resolves on its own schedule) restores focus to the activated rail button whenever the panel
  // settles, but only while focus has actually been lost to `<body>` in the meantime. REVERTED
  // (this fix alone) -> RED on webkit: without it, focus is lost to `<body>` and never restored.
  test("activating a rail tool leaves focus on that tool", async ({ page, browserName }) => {
    await gotoWalk(page);
    await enterRail(page, browserName, "step 0");
    await railArrowTo(page, "Places", "step 0");
    await page.keyboard.press("Enter");
    await expect(page.locator("#panel-region")).toContainText("Places");
    // settle past the lazy panel chunk resolving, which is when webkit used to lose it.
    await page.waitForTimeout(500);
    const name = await assertFocusUsable(page, "step 0: after activating a rail tool");
    expect(name).toBe("Places");
  });
});

test.describe("step 0: static ARIA fixes #9, #10, #11 (no test existed before this round)", () => {
  // FIX LIST #9 (SC 1.1.1): the map announced itself as "Map of U.S. marine areas" and nothing
  // more -- the project's declared text equivalent (the zones table, four keystrokes away behind
  // the Table rail tool) was never pointed at from the map's own semantics. Fix: `aria-describedby`
  // on `#map` pointing at a visually-hidden sentence naming it. REVERTED (this fix alone) -> RED:
  // `aria-describedby` is absent, or points at an id nothing renders.
  test("the map points at its own text equivalent", async ({ page }) => {
    await gotoWalk(page);
    const map = page.locator("#map");
    const describedBy = await map.getAttribute("aria-describedby");
    expect(describedBy, "#map must carry aria-describedby").toBeTruthy();
    const equivalent = page.locator(`#${describedBy}`);
    await expect(equivalent).toHaveCount(1);
    await expect(equivalent).toContainText("Zones table");
  });

  // FIX LIST #10 (SC 1.3.1): `LayersPanel.svelte`'s own "Layers on the map" section used to be a
  // SECOND `region` landmark (`<section aria-label="Layers on the map">`) nested directly inside
  // Panel.svelte's own region (already named "Layers"), with an `h3` that just repeated the
  // panel's `h2` title. Fix: a plain `div` (never a landmark) with the heading renamed to "Layers
  // on the map" (no longer identical to the panel's own "Layers"). REVERTED (this fix alone) ->
  // RED: a second "Layers on the map" region reappears nested inside the "Layers" panel region.
  test("no second region landmark nested inside the Layers panel's own region", async ({
    page,
  }) => {
    await gotoWalk(page);
    const panelRegion = page.getByRole("region", { name: "Layers" });
    await expect(panelRegion).toHaveCount(1);
    // getByRole with an ancestor locator only matches WITHIN that ancestor's subtree.
    await expect(panelRegion.getByRole("region")).toHaveCount(0);
    await expect(panelRegion.locator(".layers-control h3")).toHaveText("Layers on the map");
  });

  // FIX LIST #11 (SC 1.3.1 + 2.4.6): the floating legend sat in NO landmark at all (a bare `<div>`
  // under `<main>`), so landmark navigation never offered it. Fix: `role="region"` +
  // `aria-labelledby` pointing at its own heading (`ScoresLegend.svelte`'s "not published yet"
  // note, in this fixture's case -- no raster cog data is published, so the shared ramp
  // `Legend.svelte` never renders here; the SAME fix was applied to that fallback markup, not
  // just the ramp). REVERTED (this fix alone) -> RED: no region landmark exists for the legend.
  test("the floating legend is reachable as a landmark", async ({ page }) => {
    await gotoWalk(page);
    const legend = page.locator('[data-testid="scores-legend"]');
    await expect(legend).toBeVisible();
    await expect(legend).toHaveAttribute("role", "region");
    const labelledBy = await legend.getAttribute("aria-labelledby");
    expect(labelledBy, "the legend must carry aria-labelledby").toBeTruthy();
    await expect(page.locator(`#${labelledBy}`)).toHaveCount(1);
  });
});

test.describe("step 1: select a Program Area and read its score from the zones table", () => {
  test("rail -> Table -> Zones -> the zone's own button, by keyboard only", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openTool(page, browserName, "Table", "step 1");

    // into the panel, then the Table panel's own Segmented switch: Species | Zones | Composition.
    await tabTo(page, browserName, "Zones", { step: "step 1: the Zones sub-tab" });
    await page.keyboard.press("Enter");

    const table = page.getByRole("table", { name: `Zones ranked by ${COMPOSITE_LABEL}` });
    await expect(table).toBeVisible();

    // the zone rows are ranked by the composite: GAA (73.4) above MDA (12.5).
    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow).toContainText(TOP_ZONE.name);

    // "select a Program Area": the zone's own name button, reached by Tab, activated by Enter.
    await tabTo(page, browserName, TOP_ZONE_LABEL, { step: "step 1: the zone button" });
    await page.keyboard.press("Enter");

    // URL-is-the-view: selecting a zone writes `sel=zone:programarea:GAA` and nothing else.
    await expect
      .poll(() => page.evaluate(() => new URL(location.href).searchParams.get("sel")))
      .toBe(`zone:programarea:${TOP_ZONE.key}`);

    await assertFocusUsable(page, "step 1: after activating the zone");
  });

  test("the score a screen reader reads from that row IS the release's published number", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openTool(page, browserName, "Table", "step 1b");
    await tabTo(page, browserName, "Zones", { step: "step 1b: the Zones sub-tab" });
    await page.keyboard.press("Enter");

    const table = page.getByRole("table", { name: `Zones ranked by ${COMPOSITE_LABEL}` });
    const row = table.locator("tbody tr", { hasText: TOP_ZONE.name });

    // column order: Select | Rank | Zone | <ranked layer> | <components...> (ZonesTable.svelte).
    const cells = await row.locator("td").allTextContents();
    const trimmed = cells.map((c) => c.trim());
    expect(trimmed[1], `rank column for ${TOP_ZONE.name}`).toBe("1");
    expect(trimmed[2], `zone column for ${TOP_ZONE.name}`).toBe(TOP_ZONE_LABEL);
    // ZonesTable formats with `toLocaleString("en-US", { maximumFractionDigits: 1 })` -- the value
    // the table SHOWS and the value the release PUBLISHES are asserted to be the same number, not
    // two independently-written literals.
    expect(trimmed[3], `${COMPOSITE_LABEL} column for ${TOP_ZONE.name}`).toBe(
      TOP_ZONE.score.toLocaleString("en-US", { maximumFractionDigits: 1 }),
    );

    // and the table is announced as what it is: a ranking by the layer currently on the map.
    await expect(table).toHaveAttribute("aria-label", `Zones ranked by ${COMPOSITE_LABEL}`);
  });
});

// =================================================================================================
// STEP 2 -- create a place by coordinates
// =================================================================================================

test.describe("step 2: create a place by coordinates", () => {
  test("rail -> Places -> Enter coordinates -> type -> Add place, by keyboard only", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openTool(page, browserName, "Places", "step 2");

    await tabTo(page, browserName, "Enter coordinates", {
      step: "step 2: the Enter coordinates button",
    });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Enter coordinates" });
    await expect(dialog).toBeVisible();

    // showModal() puts initial focus inside the dialog; Tab from there reaches the textarea.
    await tabTo(page, browserName, "Coordinates, bounding box, or WKT/GeoJSON", {
      step: "step 2: the coordinates field",
      max: 12,
    });
    await page.keyboard.type("-124.5, 40.0, -123.0, 41.5");

    await tabTo(page, browserName, "Add place", { step: "step 2: the Add place button", max: 12 });
    await page.keyboard.press("Enter");

    await expect(page.locator(".place-row").first()).toBeVisible();
    // URL-is-the-view again: the place round-trips through `#pl=`, never a local-only copy.
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#pl=g1\./);
  });

  test("closing the coordinate dialog with its Close button returns focus to the opener", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openTool(page, browserName, "Places", "step 2b");
    await tabTo(page, browserName, "Enter coordinates", { step: "step 2b: the opener" });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Enter coordinates" })).toBeVisible();

    // showModal() puts initial focus on the dialog's own Close button; Enter activates it.
    await tabTo(page, browserName, "Close", { step: "step 2b: the Close button", max: 12 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Enter coordinates" })).toBeHidden();

    const name = await assertFocusUsable(page, "step 2b: after the dialog closed");
    expect(name, "focus must return to the opener, not to <body>").toBe("Enter coordinates");
    // and the panel the opener lives in is still open underneath it (contrast A11Y-1 below).
    await expect(page.locator("#panel-region .panel-pill")).toHaveCount(0);
  });

  // FIX LIST #1, FIXED: pressing Esc to dismiss a modal that is rendered INSIDE the details panel
  // USED TO also collapse the panel underneath it and park focus on the panel's pill -- so a
  // keyboard user who cancelled a dialog lost the whole panel they were working in and had to
  // re-expand it. Measured on chromium before the fix: `document.activeElement` after Esc was
  // `<button class="pill panel-pill" aria-expanded="false">Places</button>`, never the opener.
  // Cause: Svelte 5 DELEGATES `keydown` to the app root, so `Modal.svelte`'s
  // `event.stopPropagation()` used to run only AFTER `Panel.svelte`'s natively-attached `rootEl`
  // listener had already collapsed the panel. Fix: `Modal.svelte` now attaches its own Esc
  // handler IMPERATIVELY on the dialog element in `onMount` -- exactly `Popover.svelte`'s own
  // pattern -- so it runs during the REAL bubble phase, before the event ever reaches an
  // ancestor Panel. REVERTED (this fix alone, `tests/faults/modal-esc-delegated.patch`) -> RED:
  // this is the new seeded fault (scripts/test-faults.mjs), and this exact test is its gate.
  test("A11Y-1: Esc in the coordinate dialog returns focus to the opener, not the panel pill", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openTool(page, browserName, "Places", "step 2c");
    await tabTo(page, browserName, "Enter coordinates", { step: "step 2c: the opener" });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Enter coordinates" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Enter coordinates" })).toBeHidden();

    // the panel must still be open: Esc belonged to the dialog, the innermost layer.
    await expect(page.locator("#panel-region .panel-pill")).toHaveCount(0);
    const name = await assertFocusUsable(page, "step 2c: after Esc");
    expect(name).toBe("Enter coordinates");
  });

  // FIX LIST #2, FIXED: `Modal.svelte`'s Tab trap USED TO count DISABLED controls as focusable
  // (`FOCUSABLE_SELECTOR` was a bare `button, [href], input, select, textarea, ...` with no
  // `:not(:disabled)`), so when the dialog's LAST control is disabled -- which is the coordinate
  // dialog's own opening state, "Add place" being disabled until you type something -- `active
  // === last` was never true, the trap never fired, and Tab off the textarea landed on `<body>`
  // for one step. Measured on chromium before the fix, empty dialog:
  //   Close -> textarea -> BODY -> Close -> ...
  // and with text typed (Add place enabled) the cycle was already correct:
  //   textarea -> Add place -> Close -> textarea.
  // Fix: `FOCUSABLE_SELECTOR` now excludes `:disabled` on every selector that can carry it, and
  // `isVisible()` additionally filters a hidden one. REVERTED (this fix alone) -> RED: Tab off
  // the empty dialog's textarea lands on `<body>` again.
  test("A11Y-2: Tab never leaves an open modal, even when its last control is disabled", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openTool(page, browserName, "Places", "step 2e");
    await tabTo(page, browserName, "Enter coordinates", { step: "step 2e: the opener" });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Enter coordinates" })).toBeVisible();

    // three presses is one full cycle of the dialog's three controls; none may land on <body>.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press(tabKey(browserName));
      const inside = await page.evaluate(
        () => !!document.querySelector("dialog[open]")?.contains(document.activeElement),
      );
      expect(inside, `press ${i + 1} left the open dialog`).toBe(true);
    }
  });

  // A modal rendered at the SHELL root (outside `#panel-region`) has no panel to collapse, so this
  // is the clean, unaffected proof that a dialog returns focus to whatever opened it -- and it is
  // the gate the seeded fault `tests/faults/modal-focus-restore.patch` turns red (that patch opens
  // the dialog by setting the `open` attribute instead of calling `showModal()`, so the platform
  // never records a previously-focused element and `close()` restores focus to nothing).
  test("the release dialog returns focus to the version chip that opened it", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await tabTo(page, browserName, /release/i, { step: "step 2d: the version chip" });
    const opener = await focusedAccessibleName(page);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Data release" })).toBeVisible();

    await tabTo(page, browserName, "Close", { step: "step 2d: the Close button", max: 12 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Data release" })).toBeHidden();

    const name = await assertFocusUsable(page, "step 2d: after the release dialog closed");
    expect(name, "focus must return to the version chip, not to <body>").toBe(opener);
  });
});

// =================================================================================================
// STEP 3 -- open the report for the selected Program Area, and export it
// =================================================================================================

test.describe("step 3: open the report and export it", () => {
  /** step 1, replayed as this step's precondition: rail -> Table -> the Zones sub-tab. */
  async function openZonesTable(page: Page, browserName: string, step: string): Promise<void> {
    await openTool(page, browserName, "Table", `${step} setup`);
    await tabTo(page, browserName, "Zones", { step: `${step} setup: the Zones sub-tab` });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("table", { name: /^Zones ranked by/ })).toBeVisible();
  }

  /** check the Program Area's own row checkbox (Space, the platform key for a checkbox) and
   * activate "Report on selected" -- which opens report.html in a NEW TAB (`window.open`, so the
   * popup blocker still sees a user gesture; TablePanel.svelte's own rule). */
  async function reportOnSelectedZone(page: Page, browserName: string): Promise<Page> {
    await tabTo(page, browserName, `Select ${TOP_ZONE_LABEL} for report`, {
      step: "step 3: the zone's report checkbox",
    });
    await page.keyboard.press("Space");
    await tabTo(page, browserName, /^Report on selected \(1\)$/, {
      step: "step 3: the Report on selected button",
      back: true,
    });
    const [reportPage] = await Promise.all([
      page.context().waitForEvent("page"),
      page.keyboard.press("Enter"),
    ]);
    await reportPage.waitForLoadState("domcontentloaded");
    return reportPage;
  }

  test("'Report on selected' opens report.html on that Program Area", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openZonesTable(page, browserName, "step 3");
    const reportPage = await reportOnSelectedZone(page, browserName);

    expect(reportPage.url()).toMatch(/report\.html/);
    expect(reportPage.url()).toContain("#pl=");
    await expect(reportPage.locator("h1")).toHaveText("BOEM Marine Sensitivity Report");
    // a ZONE place needs no engine at all -- its scores are `boot.zones[*].metrics`, read verbatim
    // (the same reason e2e/report.spec.ts's first fixture tier runs under `blockWasm()`), so the
    // document completes here even though this walk blocks DuckDB throughout.
    await expect(reportPage.locator(".progress-line").first()).toContainText("Done", {
      timeout: 30_000,
    });
    // V4 fix (owner phone report, 2026-09-24): ARIA name, not `hasText` -- the caption moved OUT
    // of `<table>` to a sibling `<p class="table-caption">` (report.css's own header), and
    // `aria-labelledby` keeps the table's accessible name the same text that caption carries.
    await expect(
      reportPage.getByRole("table", { name: "Mean component and overall scores" }),
    ).toContainText(TOP_ZONE.name);
    await reportPage.close();
  });

  test("an export can be triggered from the report by keyboard alone", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openZonesTable(page, browserName, "step 3b");
    const reportPage = await reportOnSelectedZone(page, browserName);
    await expect(reportPage.locator(".progress-line").first()).toContainText("Done", {
      timeout: 30_000,
    });

    await reportPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    const [download] = await Promise.all([
      reportPage.waitForEvent("download"),
      (async () => {
        await tabTo(reportPage, browserName, "Download HTML", {
          step: "step 3b: the Download HTML button",
        });
        await reportPage.keyboard.press("Enter");
      })(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.html$/);
    await reportPage.close();
  });

  // the OTHER keyboard route to the report: the per-place anchor in the Places panel
  // (`Places.svelte`'s `reportHref`), a plain <a href> that Enter follows in THIS tab. Its document
  // is a CUSTOM (drawn/entered) place, whose scores DO need the engine -- blocked here -- so this
  // asserts the navigation and the document's identity, not its completed contents (which
  // e2e/report.spec.ts's engine-backed tier owns, with real Parquet fixtures).
  test("a place row's 'Open in report' link is keyboard-operable and carries the place", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openTool(page, browserName, "Places", "step 3c");
    await tabTo(page, browserName, "Enter coordinates", { step: "step 3c: the opener" });
    await page.keyboard.press("Enter");
    await tabTo(page, browserName, "Coordinates, bounding box, or WKT/GeoJSON", {
      step: "step 3c: the coordinates field",
      max: 12,
    });
    await page.keyboard.type("-124.5, 40.0, -123.0, 41.5");
    await tabTo(page, browserName, "Add place", { step: "step 3c: Add place", max: 12 });
    await page.keyboard.press("Enter");
    await expect(page.locator(".place-row").first()).toBeVisible();

    await tabTo(page, browserName, "Open in report", { step: "step 3c: the report link" });
    await page.keyboard.press("Enter");

    await page.waitForURL(/report\.html/);
    expect(page.url()).toContain("pl=");
    await expect(page.locator("h1")).toHaveText("BOEM Marine Sensitivity Report");
  });

  // FIX LIST #4, FIXED: the report's progress/status line USED TO be
  // `<p class="progress-line" role="status" aria-live="off">` (Report.svelte). An explicit
  // `aria-live="off"` OVERRODE the implicit `polite` that `role="status"` carries, so the one
  // message telling a screen-reader user that a multi-second document build is running, and then
  // that it finished, was announced to nobody. Fix: `aria-live="off"` dropped (role="status"'s
  // own implicit polite is exactly what this needs) plus `aria-atomic="true"`. SC 4.1.3 Status
  // Messages (AA). REVERTED (this fix alone) -> RED: `aria-live` reads "off" again.
  test("A11Y-4: the report's progress line is actually announced", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openZonesTable(page, browserName, "step 3d");
    const reportPage = await reportOnSelectedZone(page, browserName);
    const line = reportPage.locator(".progress-line").first();
    await expect(line).toHaveAttribute("role", "status");
    expect(
      await line.getAttribute("aria-live"),
      'aria-live="off" silences the implicit polite of role="status"',
    ).not.toBe("off");
    await reportPage.close();
  });
});

// =================================================================================================
// STEP 4 -- R1 (docs/usability.md §7): the panel's dock/resize/maximize controls, keyboard only
// =================================================================================================

test.describe("step 4: R1 panel controls (dock/resize/maximize) are keyboard reachable and operable", () => {
  test("Full screen maximizes the panel; Esc restores it and returns focus to the control", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await tabTo(page, browserName, "Full screen", { step: "step 4: the Full screen control" });
    await page.keyboard.press("Enter");
    await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "true");
    await assertFocusUsable(page, "step 4: after maximizing");

    await page.keyboard.press("Escape");
    await expect(page.locator("#panel-region")).toHaveAttribute("data-maximized", "false");
    const restored = await assertFocusUsable(page, "step 4: after Esc restores");
    expect(restored, "focus must return to the control that opened maximize").toBe("Full screen");
  });

  test("the resize handle is reachable and resizes with arrow keys (10px, 50px with Shift)", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await tabTo(page, browserName, "Resize panel", { step: "step 4: the resize handle" });
    await page.keyboard.press("ArrowLeft"); // dock=right (default): ArrowLeft grows the panel
    await expect(page.locator(":focus")).toHaveAttribute("aria-valuenow", "390");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(page.locator(":focus")).toHaveAttribute("aria-valuenow", "440");
  });
});

// =================================================================================================
// STEP 5 -- R2 (docs/usability.md §7): About + Feedback in the top bar, keyboard only
// =================================================================================================

test.describe("step 5: R2 top-bar controls (About, Feedback) are keyboard reachable", () => {
  test("About opens a dialog; Close returns focus to the (i) button", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await tabTo(page, browserName, "About this release", { step: "step 5: the (i) button" });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "About this release" })).toBeVisible();

    await tabTo(page, browserName, "Close", { step: "step 5: the Close button", max: 12 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "About this release" })).toBeHidden();

    const name = await assertFocusUsable(page, "step 5: after About closes");
    expect(name, "focus must return to the (i) button, not to <body>").toBe("About this release");
  });

  test("Feedback is a reachable, named top-bar control", async ({ page, browserName }) => {
    await gotoWalk(page);
    // just reachable + named here -- the click behaviour itself is e2e/shell.chrome.spec.ts's own
    // gate (kept behind one function so a later U3 round changes only that, never this control).
    await tabTo(page, browserName, "Feedback", { step: "step 5: the Feedback control" });
    await assertFocusUsable(page, "step 5: Feedback focused");
  });
});

// =================================================================================================
// SC 2.4.7 Focus Visible -- every stop the walk passes through must SHOW that it has focus
// =================================================================================================

// FIX LIST #3, FIXED: the upload control is an `opacity: 0` `<input type="file">` stretched over
// a visible `<label class="dropzone">` (UploadPanel.svelte) -- a legitimate pattern, except that
// `.dropzone` USED TO have no `:focus-within` rule, so tabbing onto it painted nothing anywhere on
// screen. A keyboard user Tabbing through the Places panel simply lost the caret for one stop.
// SC 2.4.7 Focus Visible (AA). Fix: a `.dropzone:focus-within` outline rule. REVERTED (this fix
// alone) -> RED: the dropzone's computed style is identical focused and unfocused again.
test.describe("focus visibility", () => {
  test("A11Y-3: the file-upload control shows a visible focus indicator", async ({
    page,
    browserName,
  }) => {
    await gotoWalk(page);
    await openTool(page, browserName, "Places", "focus-visible");

    async function dropzoneStyle() {
      return page.locator(".dropzone").evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
          boxShadow: cs.boxShadow,
          borderColor: cs.borderColor,
          background: cs.backgroundColor,
        };
      });
    }
    const unfocused = await dropzoneStyle();

    await tabTo(page, browserName, /Drop a file here/, {
      step: "focus-visible: the upload control",
    });
    // the input itself is transparent, so the ONLY thing that can show focus is its visible
    // wrapper: its computed painting must differ while the input inside it has focus.
    const focused = await dropzoneStyle();
    expect(focused, "the dropzone paints identically focused and unfocused").not.toEqual(unfocused);
  });
});
