import { defineConfig, devices } from "@playwright/test";

// atlas-0 S3 spike. Its own Playwright config (plan atlas-0, Step 4: "each in spikes/<n>/ with its
// own tiny page and Playwright spec") -- reuses the root's @playwright/test install (browsers
// already installed there; resolved via node_modules lookup, nothing added to this repo's root
// package.json). Chromium only: the display question reads `performance.memory` (Chrome-only) and
// candidate (a)/(b) both exercise WebGL/duckdb-wasm paths this spike does not need cross-engine
// coverage for (unlike the app's own e2e/shell.smoke.spec.ts).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // each test wants a cold cache; run sequentially, one browser context per test
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4313/",
    trace: "off",
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4313/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
