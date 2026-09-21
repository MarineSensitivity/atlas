import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));

// atlas-2 Step 3b: the browser half of the parity gate, scoped exactly like the engine fixture's
// config (own testDir, own ports) so `npm run e2e` never picks it up. Two servers: 4441 serves the
// release data in the bucket's own layout (a different ORIGIN than the page, as in production), 4442
// serves the harness page. Run via `npm run e2e:parity`.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // one DuckDB-WASM boot per test and a shared 4441 data server
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4442/",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `node ${here}../../../scripts/parity/serve.mjs v9 v7`,
      url: "http://127.0.0.1:4441/v9/app/boot.json",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npx vite dev --config ${here}vite.config.ts`,
      url: "http://localhost:4442/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
