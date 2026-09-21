import { defineConfig, devices } from "@playwright/test";

// atlas-0 S4 spike — reuses the ROOT's @playwright/test install (node's resolver walks up to the
// repo root's node_modules; browsers are already installed there, nothing extra needed here).
// Port 4314 + strictPort: other agents run in parallel on this machine against their own spikes,
// so this must never silently fall onto a different port.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // duckdb-wasm part (b) tests share a worker/wasm instantiation cost; keep it simple and serial
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  // generous: duckdb-spatial.spec.ts's per-stage timeouts (src/duckdb-gpkg-test.ts) sum to up to
  // ~140s worst case (one 60s "instantiate" allowance + four 20s stages) — this outer test
  // timeout needs room for that internal accounting to actually surface a "which stage" error
  // instead of Playwright's own timeout masking it.
  timeout: 150_000,
  use: {
    baseURL: "http://localhost:4314/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4314/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
