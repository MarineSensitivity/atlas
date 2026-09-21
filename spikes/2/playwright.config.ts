import { defineConfig, devices } from "@playwright/test";

// atlas-0 Step 4, S2 harness. Own Playwright config, but @playwright/test itself resolves from
// the ROOT's node_modules (this worktree's ../../node_modules -- see package.json's "e2e" script,
// which invokes ../../node_modules/.bin/playwright directly): browsers are already installed at
// the repo root and must NOT be reinstalled here.
//
// Port 4312 / strictPort: this worktree's assigned port for every server it starts, so other
// agents running in parallel on this machine don't collide with it.
//
// chromium only: S2's gate is a WebGL canvas pixel probe (gl.readPixels) plus a network-request
// assertion, not a cross-browser layout check (that's S1's job across chromium/webkit/firefox) --
// see RESULTS.md for whether Playwright's bundled Chromium actually painted the canvas headless.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4312/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4312/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
