import { defineConfig, devices } from "@playwright/test";

// atlas-0 Deliverable 5: one smoke spec (shell paints, zero console errors) across the three
// engines. `webServer` builds then serves the real production bundle (`vite preview`), the same
// thing size-budget.mjs and check-relative-assets.mjs run against — not the dev server, which
// would exercise a different code path (unbundled, absolute /src/ URLs).
export default defineConfig({
  // scoped to this directory only — the S1-S4 spike harnesses each run their own Playwright
  // config out of spikes/<n>/ on their own ports (4311-4314); this one never crawls spikes/**.
  testDir: "./e2e",
  // e2e/fixtures/** are standalone mini-projects (their own vite.config.ts, never reachable from
  // index.html/report.html's static graph — same idea as tests/fixtures/**, which vitest.config.ts
  // excludes the same way) with their OWN scoped Playwright config and webServer, run via their own
  // npm script — e2e/fixtures/analytics-privacy/ is the first of these. Without this, Playwright's
  // default recursive spec discovery would also try to run that spec here, against a webServer that
  // never starts its fixture build.
  //
  // gallery.spec.ts is the same story the other way: it has its OWN scoped config
  // (playwright.gallery.config.ts, port 4401) so it is excluded here — this config's webServer
  // never varies its baseURL by lens, and running it here too would double-execute every gallery
  // test (once correctly scoped, once against this config's chromium/webkit/firefox matrix with no
  // guarantee the gallery's own baseline snapshots exist for webkit/firefox).
  testIgnore: ["fixtures/**", "gallery.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4331/",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run preview -- --port 4331 --strictPort",
    url: "http://localhost:4331/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
