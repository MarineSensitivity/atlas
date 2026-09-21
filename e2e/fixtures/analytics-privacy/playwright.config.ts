import { fileURLToPath, URL } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Fix round 1's privacy gate, scoped exactly like spikes/*/playwright.config.ts: its OWN config, its
// OWN webServer, its OWN port (4382, inside this worktree's assigned 4381-4389 range — never 4331,
// the main app's e2e port, and never a spikes/* port). @playwright/test itself resolves from the
// ROOT node_modules (browsers already installed there); this file only scopes testDir/webServer.
const fixtureDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  testDir: fixtureDir,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4382/",
    trace: "retain-on-failure",
  },
  webServer: {
    // Playwright's default cwd for `command` is this config file's own directory; `cwd: repoRoot`
    // overrides that so the plain `npm run` script (defined in the ROOT package.json) resolves.
    command:
      "npm run build:fixture:analytics-privacy && npx vite preview --config e2e/fixtures/analytics-privacy/vite.config.ts --port 4382 --strictPort",
    cwd: repoRoot,
    url: "http://localhost:4382/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
