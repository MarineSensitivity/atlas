import { defineConfig, devices } from "@playwright/test";

// atlas-0 Step 4, S1 harness. Deliberately its own config (not the root's) -- own testDir, own
// webServer on port 4311/strictPort (this machine runs other agents' servers in parallel; 4311 is
// this task's assigned port), and it reuses the ROOT's installed @playwright/test (this file itself
// resolves `@playwright/test` via node's normal node_modules walk-up to ../../node_modules since
// spikes/1/package.json intentionally does not declare it -- do not add it there).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a spike measurement run should not retry-and-hide a flaky/hanging result
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4311/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --port 4311 --strictPort",
    url: "http://localhost:4311/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
