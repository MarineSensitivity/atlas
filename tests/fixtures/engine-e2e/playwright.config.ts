import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));

// atlas-2 Step 3 (Sonnet half): the required engine e2e gate -- "a Playwright spec (chromium,
// firefox, webkit) that boots the engine on a page, reads a small public parquet ... with
// extensions.duckdb.org BLOCKED and asserts the count." Scoped separately from the root
// playwright.config.ts (own testDir, own port 4391 -- the 4391-4399 range assigned to this step) so
// `npm run e2e` (the shell smoke spec, against the real dist/) never picks these specs up, and this
// config never touches index.html/report.html or the real dist/. Run via `npm run e2e:engine`.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // some specs start their own extra server on a fixed port (4392) -- avoid two runs racing over it
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4391/",
    trace: "on-first-retry",
  },
  webServer: {
    command: `npx vite dev --config ${here}vite.config.ts`,
    url: "http://localhost:4391/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
