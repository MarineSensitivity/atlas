// GATE (U3, round 2): html-to-image (capture.ts) and the hand-rolled annotator (annotate.ts) are
// reached ONLY through FeedbackDialog.svelte's own dynamic `import()`, and FeedbackDialog.svelte
// itself is reached ONLY through Shell.svelte's dynamic `import()` -- the same source-scan
// technique tests/places/lazyImports.test.ts and tests/report-lazy-import-duckdb.wiring.test.ts
// already use, extended here for this deliverable's own two lazy modules. `npm run size-budget`
// against a real build is the build-OUTPUT half of this gate (scripts/size-budget-core.mjs's
// FORBIDDEN_LAZY_MARKERS now lists "html-to-image"); this is the source-level half, which holds
// even before/without a build.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FEEDBACK_DIR = fileURLToPath(new URL("../../src/lib/feedback/", import.meta.url));
const SHELL_PATH = fileURLToPath(new URL("../../src/shell/Shell.svelte", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".svelte")) out.push(p);
  }
  return out;
}

/** `import ... from "x"` / `import "x"` at the top level -- NOT `import type` (erased under
 * `verbatimModuleSyntax`, costs nothing at runtime -- FeedbackDialog.svelte's own type-only
 * `AnnotateShape`/`AnnotateTool` import relies on this exact exception) and NOT `await import("x")`. */
const staticImportsOf = (src: string): string[] =>
  [...src.matchAll(/(?:^|\n)\s*import\s(?!type\s)(?:[^;'"]*?\sfrom\s)?["']([^"']+)["']/g)].map(
    (m) => m[1],
  );

const dynamicImportsOf = (src: string): string[] =>
  [...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);

const files = walk(FEEDBACK_DIR).map((p) => [p, readFileSync(p, "utf8")] as const);
const shellSrc = readFileSync(SHELL_PATH, "utf8");

describe("html-to-image and the annotator are dynamic imports, never static", () => {
  it("finds source files under src/lib/feedback/ (an empty walk must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("nothing under src/lib/feedback/ statically imports html-to-image, EXCEPT capture.ts itself", () => {
    // capture.ts's own top-level `import { toCanvas } from "html-to-image"` is fine -- see the
    // dedicated test below for why (it only ever runs once capture.ts's OWN dynamic import()
    // resolves). Every OTHER file in this directory (FeedbackDialog.svelte above all) must not
    // import the package directly.
    for (const [file, src] of files) {
      if (file.endsWith("capture.ts")) continue;
      expect(staticImportsOf(src), `${file} statically imports html-to-image`).not.toContain(
        "html-to-image",
      );
    }
  });

  it("nothing under src/lib/feedback/ statically imports ./capture or ./annotate (a value import)", () => {
    for (const [file, src] of files) {
      if (file.endsWith("capture.ts") || file.endsWith("annotate.ts")) continue; // a module never "imports" itself
      const statics = staticImportsOf(src);
      expect(statics, `${file} statically imports ./capture`).not.toContain("./capture");
      expect(statics, `${file} statically imports ./annotate`).not.toContain("./annotate");
    }
  });

  it("FeedbackDialog.svelte reaches both ./capture and ./annotate dynamically", () => {
    const [, src] = files.find(([f]) => f.endsWith("FeedbackDialog.svelte"))!;
    const dyn = dynamicImportsOf(src);
    expect(dyn).toContain("./capture");
    expect(dyn).toContain("./annotate");
  });

  it("capture.ts reaches html-to-image via an ordinary (static, but LAZY-module-internal) import", () => {
    // capture.ts itself is only ever reached dynamically (asserted below); once it IS loaded, its
    // own top-level `import { toCanvas } from "html-to-image"` is fine -- that import only runs
    // when the dynamic import() that reached capture.ts resolves, so it never touches the entry's
    // static critical path (the exact reasoning tests/report-lazy-import-duckdb.wiring.test.ts's
    // own header documents for @duckdb/duckdb-wasm/docx).
    const [, src] = files.find(([f]) => f.endsWith("capture.ts"))!;
    expect(staticImportsOf(src)).toContain("html-to-image");
  });

  it("SEEDED FAULT: the same scan flags a static import of html-to-image", () => {
    const seeded = 'import { toCanvas } from "html-to-image";\nexport const x = toCanvas;\n';
    expect(staticImportsOf(seeded)).toContain("html-to-image");
  });
});

describe("Shell.svelte reaches FeedbackDialog.svelte only dynamically", () => {
  it("no static import of FeedbackDialog.svelte", () => {
    expect(staticImportsOf(shellSrc)).not.toContain("../lib/feedback/FeedbackDialog.svelte");
  });

  it("a dynamic import of FeedbackDialog.svelte exists (openFeedback())", () => {
    expect(dynamicImportsOf(shellSrc)).toContain("../lib/feedback/FeedbackDialog.svelte");
  });
});
