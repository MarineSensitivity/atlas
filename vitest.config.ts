import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // pure logic only (version/session resolution, size-budget, dist checks) — no DOM
    include: ["tests/**/*.test.ts"],
    // "include" is already a strict allowlist under tests/, so spikes/** and the parallel
    // spike-agent worktrees under .claude/ can't match — excluded explicitly anyway, defensively.
    exclude: ["tests/fixtures/**", "node_modules/**", "spikes/**", ".claude/**"],
  },
});
