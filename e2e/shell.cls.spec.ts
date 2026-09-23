import { expect, test, type Page } from "@playwright/test";
import {
  blockAppBundle,
  routeBucket,
  routeSealFixture,
  routeSession,
  waitForHydration,
} from "./hermetic";

// atlas-3 step 3 fix round 1: the PRIMARY gate here is GEOMETRY EQUALITY between the static
// skeleton and the hydrated frame -- not the Layout Instability API, which CANNOT detect a
// skeleton/hydrated mismatch on this page. src/main.ts does `target.replaceChildren()` then
// `mount(Shell)`: every skeleton node is REMOVED and new nodes are CREATED, and the spec only
// reports a "layout shift" for a node whose OWN identity persists across two rendered frames and
// whose rect changed -- a wholesale swap is invisible to it (confirmed: even an 8 px skeleton
// offset produced a measured CLS of 0 before this fix). So this file now captures the bounding
// box of every keyed element with the app bundle BLOCKED (skeleton only, `blockAppBundle`) and
// again after real hydration (`waitForHydration`), and asserts they are pixel-identical (0.5 px
// tolerance for subpixel layout) -- the actual claim atlas-3 step 3 makes. The Layout Instability
// API is kept as a SECONDARY check below: it still catches a font-swap-driven shift on a node that
// DOES persist across frames (e.g. hydrated content settling after `document.fonts.ready`), which
// is a real, previously-caught regression (see shell.css's `.chip` min-width and index.html's
// Carlito preload comments).
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};
const THEMES = ["navy", "paper"] as const;

interface KeySpec {
  key: string;
  skeleton: string;
  hydrated: string;
}

// Every element with a hydrated twin the skeleton claims to match geometrically. Rail tools and
// panel-size controls are keyed by POSITION on the skeleton side (plain `sk-*` placeholders, no
// individual name) and by `aria-label` on the hydrated side (Rail/Panel/Sheet are src/lib/ui/*
// components this step imports but does not edit, so a NEW attribute cannot be added to their
// internal buttons -- aria-label is already there, stable, and exactly what a screen-reader user
// keys off of too). `[aria-label^="Collapse to a"]` matches both Panel's "...pill" and Sheet's
// "...peek" with one selector.
const KEYS: KeySpec[] = [
  { key: "topbar", skeleton: ".topbar", hydrated: ".topbar" },
  { key: "title", skeleton: "#app-title", hydrated: "#app-title" },
  {
    key: "version-chip",
    skeleton: '[data-control="version-chip"]',
    hydrated: '[data-control="version-chip"]',
  },
  {
    key: "lens-switch",
    skeleton: '[data-control="lens-switch"]',
    hydrated: '[data-control="lens-switch"]',
  },
  { key: "search", skeleton: '[data-control="search"]', hydrated: '[data-control="search"]' },
  { key: "share", skeleton: '[data-control="share"]', hydrated: '[data-control="share"]' },
  {
    key: "report-top",
    skeleton: '[data-control="report-top"]',
    hydrated: '[data-control="report-top"]',
  },
  { key: "help", skeleton: '[data-control="help"]', hydrated: '[data-control="help"]' },
  { key: "theme", skeleton: '[data-control="theme"]', hydrated: '[data-control="theme"]' },
  { key: "rail-frame", skeleton: "#rail-region > *", hydrated: "#rail-region > *" },
  {
    key: "rail-layers",
    skeleton: "#rail-region .sk-hexbtn:nth-child(1)",
    hydrated: '#rail-region button[aria-label="Layers"]',
  },
  {
    key: "rail-places",
    skeleton: "#rail-region .sk-hexbtn:nth-child(2)",
    hydrated: '#rail-region button[aria-label="Places"]',
  },
  {
    key: "rail-flower",
    skeleton: "#rail-region .sk-hexbtn:nth-child(3)",
    hydrated: '#rail-region button[aria-label="Flower plot"]',
  },
  {
    key: "rail-table",
    skeleton: "#rail-region .sk-hexbtn:nth-child(4)",
    hydrated: '#rail-region button[aria-label="Table"]',
  },
  {
    key: "rail-report",
    skeleton: "#rail-region .sk-hexbtn:nth-child(5)",
    hydrated: '#rail-region button[aria-label="Report"]',
  },
  { key: "panel-frame", skeleton: "#panel-region > *", hydrated: "#panel-region > *" },
  {
    key: "panel-collapse",
    skeleton: ".sk-panel-controls .sk-panel-ctrl:nth-child(1)",
    hydrated: '#panel-region button[aria-label^="Collapse to a"]',
  },
  {
    key: "panel-half",
    skeleton: ".sk-panel-controls .sk-panel-ctrl:nth-child(2)",
    hydrated: '#panel-region button[aria-label="Half height"]',
  },
  {
    key: "panel-full",
    skeleton: ".sk-panel-controls .sk-panel-ctrl:nth-child(3)",
    hydrated: '#panel-region button[aria-label="Full height"]',
  },
  { key: "about-frame", skeleton: "#about-region > *", hydrated: "#about-region > *" },
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function captureBoxes(page: Page, keys: KeySpec[], side: "skeleton" | "hydrated") {
  const boxes: Record<string, Box | null> = {};
  for (const k of keys) {
    const selector = side === "skeleton" ? k.skeleton : k.hydrated;
    const loc = page.locator(selector).first();
    const box = (await loc.count()) > 0 ? await loc.boundingBox() : null;
    boxes[k.key] = box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
  }
  return boxes;
}

// The two SELF-HOSTED brand faces (src/lib/brand/fonts.css) in the weights the shell paints, as
// CSS font shorthands `document.fonts.load()`/`check()` accept. These are the only faces whose
// metrics can move a box between the skeleton and the hydrated frame; the licensed
// Century Gothic / Calibri faces above them in fonts.css are `local()`-only and simply are not
// present on any CI runner.
const BRAND_FACES = [
  '400 1em "Jost"',
  '700 1em "Jost"',
  '400 1em "Carlito"',
  '700 1em "Carlito"',
] as const;

/** how long a single face gets to load before this helper gives up and NAMES it. */
const FACE_LOAD_TIMEOUT_MS = 10_000;

/**
 * Wait for the brand faces, then assert they are actually loaded.
 *
 * 0.10.14: this used to be `await page.evaluate(() => document.fonts.ready)`, which on
 * WebKit/linux never settled inside the test's budget — all six WebKit cases died as
 * `page.evaluate: Test ended.` at this line (run 35819393922), three of them on every retry.
 * `document.fonts.ready` is a whole-document promise: it is only as prompt as the SLOWEST face
 * in the set (and re-arms on every new font request), so as a wait it is both unbounded and
 * uninformative — when it does not settle there is nothing to report but a timeout.
 *
 * Awaiting the SPECIFIC faces the geometry depends on is bounded and engine-independent, and the
 * failure names the face instead of the line: `document.fonts.load(spec)` races a timer, and
 * whatever is still not `check()`-able afterwards is reported BY NAME. A face that genuinely
 * never loads is therefore a loud, diagnosable red — never a silent 30 s test timeout.
 */
async function settleFonts(page: Page) {
  const unloaded = await page.evaluate(
    async ({ specs, timeoutMs }) => {
      await Promise.all(
        specs.map((spec) =>
          Promise.race([
            document.fonts.load(spec).catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, timeoutMs)),
          ]),
        ),
      );
      return specs.filter((spec) => !document.fonts.check(spec));
    },
    { specs: [...BRAND_FACES], timeoutMs: FACE_LOAD_TIMEOUT_MS },
  );
  expect(
    unloaded,
    `brand face(s) never finished loading within ${FACE_LOAD_TIMEOUT_MS} ms: ${unloaded.join(", ")}`,
  ).toEqual([]);
}

for (const theme of THEMES) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`geometry equality: skeleton vs hydrated -- ${theme} @ ${name}`, async ({ browser }) => {
      const skeletonCtx = await browser.newContext();
      const skeletonPage = await skeletonCtx.newPage();
      await routeBucket(skeletonPage);
      await routeSession(skeletonPage, null);
      await routeSealFixture(skeletonPage);
      await blockAppBundle(skeletonPage);
      await skeletonPage.setViewportSize(viewport);
      await skeletonPage.goto(`/?theme=${theme}`, { waitUntil: "networkidle" });
      await settleFonts(skeletonPage);
      const skeletonBoxes = await captureBoxes(skeletonPage, KEYS, "skeleton");
      await skeletonCtx.close();

      const hydratedCtx = await browser.newContext();
      const hydratedPage = await hydratedCtx.newPage();
      await routeBucket(hydratedPage);
      await routeSession(hydratedPage, null);
      await routeSealFixture(hydratedPage);
      await hydratedPage.setViewportSize(viewport);
      await hydratedPage.goto(`/?theme=${theme}`, { waitUntil: "networkidle" });
      await waitForHydration(hydratedPage);
      await settleFonts(hydratedPage);
      const hydratedBoxes = await captureBoxes(hydratedPage, KEYS, "hydrated");
      await hydratedCtx.close();

      for (const k of KEYS) {
        const s = skeletonBoxes[k.key];
        const h = hydratedBoxes[k.key];
        if (s === null && h === null) continue; // consistently absent at this viewport (e.g. "about" on phone)
        expect(s, `"${k.key}" has a skeleton box but no hydrated twin`).not.toBeNull();
        expect(h, `"${k.key}" has a hydrated box but no skeleton twin`).not.toBeNull();
        if (!s || !h) continue;
        expect(
          Math.abs(s.x - h.x),
          `"${k.key}".x: skeleton ${s.x} vs hydrated ${h.x}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(s.y - h.y),
          `"${k.key}".y: skeleton ${s.y} vs hydrated ${h.y}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(s.width - h.width),
          `"${k.key}".width: skeleton ${s.width} vs hydrated ${h.width}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(s.height - h.height),
          `"${k.key}".height: skeleton ${s.height} vs hydrated ${h.height}`,
        ).toBeLessThanOrEqual(0.5);
      }
    });
  }
}

// --- secondary: the Layout Instability API, over a REAL (unblocked) hydration ------------------
// This does not prove the skeleton matches the hydrated frame (see the header comment) but it DOES
// still catch a shift among nodes that persist once mounted -- e.g. a font swap after
// `document.fonts.ready` settles late, or an async value (the version chip's text) growing a box
// past its reserved space. Both are real regressions this measured and fixed in this step.
test.describe("secondary: post-hydration layout-shift score", () => {
  // scoped to THIS describe block only (a bare top-level `test.skip(fn, ...)` would skip every
  // test in the whole file, including the geometry-equality ones above -- confirmed the hard way).
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Layout Instability API is Chromium-only",
  );

  async function installClsObserver(page: Page) {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
    });
  }

  for (const theme of THEMES) {
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      test(`post-hydration layout-shift score is 0 -- ${theme} @ ${name}`, async ({ page }) => {
        await routeBucket(page);
        await routeSession(page, null);
        await routeSealFixture(page);
        await installClsObserver(page);
        await page.setViewportSize(viewport);

        await page.goto(`/?theme=${theme}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);

        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        expect(cls, `measured post-hydration layout-shift at ${theme}/${name}`).toBe(0);
      });
    }
  }
});
