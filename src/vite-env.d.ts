/// <reference types="vite/client" />

/** injected by `vite.config.ts`'s `define` — `package.json`'s `version`, as a string literal
 * inlined at build time (see that file's comment on why NOT a runtime `import` of package.json). */
declare const __APP_VERSION__: string;

/** injected by `vite.config.ts`'s `define` — `git rev-parse --short HEAD` at build time, or
 * `"unknown"` when git is unavailable (atlas-8 Deliverable 4: the "Report a problem" issue body). */
declare const __APP_SHA__: string;
