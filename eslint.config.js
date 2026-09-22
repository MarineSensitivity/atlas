// flat config (ESLint 10 / typescript-eslint 8 / eslint-plugin-svelte 3); formatting itself is
// prettier's job (see .prettierrc.json) so this stays about correctness, not style.
import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default ts.config(
  {
    ignores: [
      "dist",
      "dist-fixture",
      "coverage",
      "playwright-report",
      "test-results",
      "node_modules",
      "tests/fixtures/**/dist", // built fixture output, not source
      "e2e/fixtures/**/dist", // same — e2e/fixtures/analytics-privacy/'s built output
      ".tmp", // sandbox-only TMPDIR override, gitignored
      "spikes", // S1-S4 spike harnesses (each its own package.json); root config must not lint them
      ".claude/worktrees", // parallel spike-agent worktrees, each a full checkout with own node_modules
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  {
    // browser app code: src/, and the e2e/fixture pages that stand in for it. `__APP_VERSION__` is
    // `vite.config.ts`'s `define` (atlas-5: Analytics["appVersion"], inlined at build time — see
    // that file's own comment for why not a runtime `import` of package.json).
    files: ["src/**/*.ts", "src/**/*.svelte", "tests/fixtures/**/*.ts"],
    languageOptions: { globals: { ...globals.browser, __APP_VERSION__: "readonly" } },
  },
  {
    // Node-run tooling: build scripts and *.config.ts files. scripts/verify.mjs also drives
    // Playwright `page.evaluate()` callbacks that run IN the browser, hence both global sets.
    files: ["scripts/**/*.mjs", "*.config.ts", "tests/fixtures/**/*.config.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // tests run under vitest/playwright's Node process, but assert against browser-shaped fakes
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: ts.parser },
    },
  },
  {
    languageOptions: {
      parserOptions: { extraFileExtensions: [".svelte"] },
    },
  },
  {
    // eslint-plugin-svelte's own base config also claims **/*.svelte.ts / **/*.svelte.js (Svelte 5's
    // "universal reactivity" files, e.g. src/lib/state/sel.svelte.ts) and hands them to
    // svelte-eslint-parser with no `parserOptions.parser` delegate — which parses Svelte SFC `<script>`
    // content, not a bare TypeScript module, and fails on ordinary TS (`interface`, `import type`, ...).
    // These files have no <script> tag at all: runes ($state, ...) are plain function calls
    // syntactically, so typescript-eslint's own parser handles them with no special support needed.
    // Placed AFTER the svelte configs (`ts.config()` applies later entries' `languageOptions` on top of
    // earlier ones for the same file) so it overrides the parser choice for this one glob only.
    files: ["**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parser: ts.parser,
    },
  },
);
