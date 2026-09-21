// scripts/parity/ts-resolve.mjs -- let Node import the app's own TypeScript, unchanged.
//
// The parity harness runs the REAL `src/lib/analysis/*.ts`, not a copy, so that the orchestration
// it proves is the orchestration the browser ships. Node 24 strips the types on its own; what it
// does not do is guess extensions, and this app is written for a bundler
// (`moduleResolution: "bundler"`), so `import "../geo/coverage"` has no `.ts` on it.
//
// One synchronous resolve hook closes exactly that gap and nothing else: if a RELATIVE specifier
// does not resolve, try it with `.ts` and then as `/index.ts`. Bare specifiers, data URLs and
// anything already resolvable are untouched, so nothing about normal module resolution changes --
// and no build step, no loader dependency and no second copy of the source is introduced.
//
// Imported for its side effect, before the dynamic `import()`s in `run.mjs`.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith(".")) throw err;
      for (const suffix of [".ts", "/index.ts"]) {
        try {
          return nextResolve(specifier + suffix, context);
        } catch {
          /* try the next shape */
        }
      }
      throw err;
    }
  },
});
