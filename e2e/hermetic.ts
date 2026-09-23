// Shared Playwright helpers so every spec against the real built shell stays HERMETIC (every
// bucket URL routed to a fixture, matching e2e/shell.smoke.spec.ts's original convention) instead
// of each spec re-inventing its own fixture registry. Not a `*.spec.ts` file, so playwright.config.ts
// never tries to run it as a test on its own.
import type { Page } from "@playwright/test";
import type { IncompleteResult } from "axe-core";
import { routeBasemapStyle, routeGlyphs, solidPng } from "./map-hermetic";
import { isTeardownRaceError, safeRoute } from "./routeSafety";

export { isTeardownRaceError, safeRoute };

export const BUCKET = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/";

/** the registry shape, matching the real versions.json (orchestrator-verified 2026-09-21). */
export const VERSIONS_FIXTURE = [
  { ver: "v7", status: "release", access: "public", prev: "v6", released: "2026-09-12" },
  { ver: "v7b", status: "prerelease", access: "restricted", prev: "v7", released: "2026-09-20" },
  { ver: "v8", status: "prerelease", access: "restricted", prev: "v7", released: "2026-08-02" },
  { ver: "v9", status: "prerelease", access: "restricted", prev: "v8", released: "2026-09-05" },
];

// session.json (same-origin, the one door into preview mode) legitimately 404s on the public host,
// and {ver}/app/boot.json does not exist until atlas-1 -- both are swallowed into safe defaults by
// the early-fetch script. Chromium and WebKit (not Firefox) still surface a fetch()'s non-2xx as a
// console "error" regardless of the .catch() -- so this is the ONE class of message a spec allows
// through; anything else still fails it.
export const EXPECTED_MISSING_FILES = new Set(["session.json", "boot.json"]);

/**
 * The map's cross-origin tile/style/glyph origins → fixtures, so no spec ever reaches the live
 * network for them. The basemap is CARTO's vector GL style now (atlas-map basemap fix, 2026-09-23:
 * the raster endpoint started requiring a key) — `routeBasemapStyle()` (map-hermetic.ts) routes its
 * WHOLE chain (style.json, its TileJSON, every `.mvt` tile, the sprite, wrapped with `safeRoute()`
 * throughout — see routeSafety.ts's own header for the teardown-race it guards); `routeGlyphs()`
 * covers the font range every basemap now needs for CARTO's own place/road labels, not just a zone
 * label. A spec that needs a distinguishable PAINTED score-raster pixel (e2e/map.spec.ts) still
 * registers its OWN, later-winning titiler route — Playwright matches handlers in reverse
 * registration order.
 */
export async function routeMapTileOrigins(page: Page) {
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  // a real (transparent) PNG, not a 204 and not a hand-typed base64 blob: MapLibre reports a tile
  // it cannot DECODE through `map.on("error")`, which logs to the console — and "zero console
  // errors" is the smoke spec's whole assertion (an invalid literal produced 35 of them).
  await page.route(
    "https://titiler-v8.marinesensitivity.org/**",
    safeRoute((route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: solidPng(0, 0, 0, 1, 0) }),
    ),
  );
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const url = msg.location()?.url ?? "";
    const basename = url.split("/").pop() ?? "";
    if (msg.text().includes("Failed to load resource") && EXPECTED_MISSING_FILES.has(basename))
      return;
    errors.push(`[${msg.type()}] ${msg.text()} (${url})`);
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

/** every URL the page requested, so a test can assert what was NOT fetched. */
export function collectRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => urls.push(req.url()));
  return urls;
}

/**
 * Every cross-origin GET the shell makes, routed to a fixture: the release bucket (latest.txt,
 * versions.json, each release's manifest and — when `boot` is given — `{ver}/app/boot.json`) AND
 * the map's tile origins.
 *
 * The tile origins are folded in here on purpose (atlas-map): the moment the shell mounted a real
 * MapLibre map, EVERY spec that loads the shell started requesting CARTO basemap tiles, and a
 * hermeticity rule that each spec has to remember separately is one that a future spec will
 * silently break. `routeBucket` is the one call every shell spec already makes.
 */
export async function routeBucket(page: Page, latest = "v7", boot?: object) {
  await routeMapTileOrigins(page);
  await page.route(
    (url) => url.href.startsWith(BUCKET),
    safeRoute(async (route) => {
      const path = route.request().url().slice(BUCKET.length);
      if (path.startsWith("latest.txt")) {
        return route.fulfill({ status: 200, contentType: "text/plain", body: `${latest}\n` });
      }
      if (path.startsWith("versions.json")) {
        return route.fulfill({ status: 200, json: VERSIONS_FIXTURE });
      }
      const manifest = /^(v[0-9]+[a-z]?)\/manifest\.json/.exec(path);
      if (manifest) {
        return route.fulfill({ status: 200, json: { ver: manifest[1], capabilities: {} } });
      }
      if (boot && /^v[0-9]+[a-z]?\/app\/boot\.json/.test(path)) {
        return route.fulfill({ status: 200, json: boot });
      }
      return route.fulfill({ status: 404, body: "" }); // app/boot.json: not published until atlas-1
    }),
  );
}

/**
 * Serve the same dist/ under a version-prefixed path, the preview host's shape
 * (`preview.marinesensitivity.org/{ver}/atlas/`, plan D1/D2). Rewrites the prefix away and fetches
 * from the preview server's root -- which also proves the build's asset URLs are relative.
 */
export async function mountUnder(page: Page, prefix: string) {
  await page.route(
    (url) => url.pathname.startsWith(prefix),
    // the most likely site of the teardown race this file's header describes: a REAL cross-fetch
    // (`route.fetch`) that can still be in flight when the test/page ends.
    safeRoute(async (route) => {
      const url = new URL(route.request().url());
      url.pathname = url.pathname.slice(prefix.length - 1);
      route.fulfill({ response: await route.fetch({ url: url.toString() }) });
    }),
  );
}

/** the same-origin session.json: absent (public host) or a signed-in preview body. */
export async function routeSession(page: Page, body: object | null) {
  await page.route(
    (url) => url.pathname.endsWith("/session.json"),
    safeRoute((route) =>
      body
        ? route.fulfill({ status: 200, json: body })
        : route.fulfill({ status: 404, body: "not found" }),
    ),
  );
}

/** the seal image About.svelte's default VITE_SEAL_URL points at -- routed so no spec here ever
 * touches the live network (matching e2e/gallery.spec.ts's convention).
 *
 * ALSO seeds the welcome modal's "don't show again" localStorage key (atlas-4 step 3,
 * `WelcomeModal.svelte`) via `addInitScript`, so it runs before the page's own scripts on every
 * navigation from here on. Every spec in this file already calls this ONE function as part of its
 * hermetic setup, and the welcome modal's native `<dialog>` (`showModal()`) blocks pointer events
 * across the WHOLE page while open -- an unrelated spec clicking `.topbar`/`#rail-region`/panel
 * controls would otherwise time out (measured: this broke shell.url-state/a11y/cls/theme-flash
 * wholesale the moment the modal landed). A spec that wants to see the real welcome modal clears
 * this key itself (`e2e/scores.welcome.spec.ts`) rather than expecting the shared default to show it. */
export async function routeSealFixture(page: Page) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">' +
    '<circle cx="100" cy="100" r="90" fill="#123456"/></svg>';
  await page.route(
    "**/branding/mma-seal.svg",
    safeRoute((route) => route.fulfill({ contentType: "image/svg+xml", body: svg })),
  );
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("atlas.welcome.dontShowAgain", "1");
    } catch {
      /* private mode / storage disabled -- the modal just shows, no spec breaks because of it */
    }
  });
}

/** the shell's one same-origin, one-time setup for a hermetic public-host load: routes the
 * bucket + session.json + seal, in the order that matters (session registered so it wins over a
 * later mountUnder rewrite, matching shell.smoke.spec.ts's original comment). */
export async function gotoPublicShell(page: Page, path = "/") {
  await routeBucket(page);
  await routeSession(page, null);
  await routeSealFixture(page);
  await page.goto(path);
}

/**
 * Aborts the app's own entry chunk (`./assets/index-<hash>.js`, the built `<script type="module">`
 * index.html emits) so ONLY the static skeleton + inlined critical CSS ever paints -- no
 * hydration, ever. Used by both the geometry-equality gate (e2e/shell.cls.spec.ts) and the
 * no-flash gate (e2e/shell.theme-flash.spec.ts): a real browser-level way to isolate "what does
 * the skeleton alone look like" from "what does main.ts's `$effect` paper over a few ms later."
 * Does not block `modulepreload-polyfill-*.js` or `report-*.js` -- only the app entry.
 */
export async function blockAppBundle(page: Page) {
  await page.route(
    (url) => /\/assets\/index-[^/]*\.js$/.test(url.pathname),
    safeRoute((route) => route.abort()),
  );
}

/** waits for the REAL Rail component (`.rail`, not the skeleton's `.sk-rail`) to exist -- the
 * signal that main.ts has cleared the skeleton and Shell.svelte has mounted. */
export async function waitForHydration(page: Page) {
  await page.waitForSelector("#rail-region .rail", { state: "attached" });
}

/** `#rrggbb` -> the exact `rgb(r, g, b)` string `getComputedStyle` returns, for asserting a
 * computed background/color against a `tokens.css` value without a color-parsing library. */
export function hexToRgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb color: "${hex}"`);
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * atlas-3 closing review, item 4: axe's own `color-contrast` rule cannot statically resolve two
 * kinds of composited color this app uses on purpose (color-mix()/backdrop-filter glass surfaces,
 * and SVG <text> painted over a <rect> it reports as "overlapped" even though the label and its
 * background share one element and one fixed, separately-gated contrast) -- so both
 * e2e/gallery.spec.ts and e2e/shell.a11y.spec.ts exempt `color-contrast` from their "every
 * incomplete finding is triaged" gate. A rule-id-keyed exemption alone is a silent hole: it would
 * also cover a FUTURE unrelated color-contrast defect, however many nodes or for whatever reason
 * axe cites, forever. This pins it instead: a node-count ceiling (the number actually measured
 * for this page/viewport, recorded by the caller) and a closed set of the axe "cannot determine"
 * message keys actually observed here -- a new incomplete node, or an existing one axe now cites
 * for a NEW reason, still fails even though the rule id is still `color-contrast`.
 *
 * To re-triage after a real content change: run the failing spec, read the new count/reason from
 * the failure, and only raise the ceiling (or add a reason key) once you've confirmed the new case
 * is actually gated elsewhere (e.g. scripts/contrast.mjs) -- never just to make the number match.
 */
export function extractColorContrastReasonKeys(nodes: IncompleteResult["nodes"]): string[] {
  return nodes.flatMap((node) => {
    const checks = [...node.any, ...node.all, ...node.none];
    return checks
      .map((c) => (c.data as { messageKey?: string } | null)?.messageKey)
      .filter((k): k is string => typeof k === "string");
  });
}

/**
 * Asserts axe's `incomplete` results contain nothing EXCEPT `color-contrast`, and that
 * `color-contrast`'s own node count/reasons stay within the pinned ceiling/allow-list above.
 */
export function assertColorContrastIncompletePinned(
  incomplete: IncompleteResult[],
  ceiling: number,
  allowedReasonKeys: readonly string[],
) {
  const untriaged = incomplete.filter((v) => v.id !== "color-contrast");
  if (untriaged.length) {
    throw new Error(
      `axe reported an untriaged incomplete finding (not color-contrast): ${JSON.stringify(untriaged, null, 2)}`,
    );
  }
  const colorContrast = incomplete.find((v) => v.id === "color-contrast");
  const nodeCount = colorContrast?.nodes.length ?? 0;
  if (nodeCount > ceiling) {
    throw new Error(
      `color-contrast incomplete node count ${nodeCount} exceeds the pinned ceiling of ${ceiling}`,
    );
  }
  const reasons = colorContrast ? extractColorContrastReasonKeys(colorContrast.nodes) : [];
  const unexpected = reasons.filter((k) => !allowedReasonKeys.includes(k));
  if (unexpected.length) {
    throw new Error(
      `color-contrast incomplete cited an unexpected reason: ${JSON.stringify(unexpected)} (allowed: ${JSON.stringify(allowedReasonKeys)})`,
    );
  }
}
