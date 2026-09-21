import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));

// atlas-2 Step 4: the OPFS persistence gate, promoted from `spikes/1/e2e/` to the real store.
// Its own config (own testDir, own port 4451 -- the 4451-4459 range assigned to this step) so
// `npm run e2e` never picks these specs up. Run via `npm run e2e:opfs`.
//
// `workers: 1`. Every spec here contends for ONE origin's OPFS and ONE Web Lock namespace; the
// per-test persistent profile (`persistent.ts`) isolates the storage, but running several real
// DuckDB-WASM instances at once on one machine is what makes a timing budget meaningless.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0, // a persistence measurement that needs a retry is a result, not a flake to hide
  timeout: 120_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4451/",
    trace: "on-first-retry",
  },
  webServer: {
    command: `npx vite dev --config ${here}vite.config.ts`,
    url: "http://localhost:4451/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
