import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // pure logic only (version/session resolution, size-budget, dist checks) — no DOM
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/fixtures/**", "node_modules/**"],
  },
});
