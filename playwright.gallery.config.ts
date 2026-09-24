import { defineConfig, devices } from "@playwright/test";

// atlas-3 step 2, Deliverable 3/4: the gallery's own Playwright config, separate from the main
// e2e/shell.smoke.spec.ts config -- that one's webServer only builds/serves index.html + report.html
// (vite.config.ts's entries); gallery.html is a second, independent build (vite.gallery.config.ts)
// that lands in the SAME dist/, so `npm run build` (which runs both) followed by a plain
// `vite preview` here serves it too. Port 4401 per this worktree's port allocation (4401-4409).
//
// gallery axe ceilings round (r2-gax): PW_PORT overrides the port, mirroring playwright.config.ts's
// own mechanism -- `npm run test:faults`' seeded-fault gate builds+serves a THROWAWAY, patched
// `git worktree` and must never reuse an already-running gallery preview on 4401 (that would
// silently test the unpatched bytes and the fault would stay green for the wrong reason). Unset,
// nothing changes: port 4401, reused locally, exactly as before.
const PORT = process.env.PW_PORT ?? "4401";
const BASE_URL = `http://localhost:${PORT}/`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["gallery.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI && !process.env.PW_PORT,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
