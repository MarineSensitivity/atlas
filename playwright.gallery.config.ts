import { defineConfig, devices } from "@playwright/test";

// atlas-3 step 2, Deliverable 3/4: the gallery's own Playwright config, separate from the main
// e2e/shell.smoke.spec.ts config -- that one's webServer only builds/serves index.html + report.html
// (vite.config.ts's entries); gallery.html is a second, independent build (vite.gallery.config.ts)
// that lands in the SAME dist/, so `npm run build` (which runs both) followed by a plain
// `vite preview` here serves it too. Port 4401 per this worktree's port allocation (4401-4409).
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["gallery.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4401/",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run preview -- --port 4401 --strictPort",
    url: "http://localhost:4401/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
