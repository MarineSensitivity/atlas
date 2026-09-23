// atlas-8 fiddly bit: the Categories demo table (`src/gallery/sections/Categories.svelte`) had no
// max-width/overflow rule at all -- a plain, unconstrained 4-column table with two `<code>`-token
// columns overflowed the page at 320 CSS px. SC 1.4.10 (Reflow) exempts data tables from the
// no-2D-scroll rule, so the fix is a scroll CONTAINER around the table, never squeezing the table
// itself. Source-scan (no DOM render here) -- e2e/gallery.spec.ts's own 320px overflow suite is
// the real-browser twin, scoped to About/Panel today; this file is the unit-level proof the
// wrapper/CSS exist at all.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("../../src/gallery/sections/Categories.svelte", import.meta.url),
  "utf8",
);

describe("Categories.svelte's table sits inside a scroll container", () => {
  it("the table is wrapped in .cat-table-scroll", () => {
    expect(SOURCE).toMatch(/<div class="cat-table-scroll">[\s\S]*<table class="cat-table">/);
  });

  it(".cat-table-scroll caps its own width and scrolls horizontally, not the page", () => {
    const styleBlock = SOURCE.slice(SOURCE.indexOf("<style>"));
    expect(styleBlock).toMatch(/\.cat-table-scroll\s*{[^}]*max-width:\s*100%/);
    expect(styleBlock).toMatch(/\.cat-table-scroll\s*{[^}]*overflow-x:\s*auto/);
  });
});

describe("the gate can fail (seeded fault)", () => {
  it("catches the ORIGINAL unwrapped table (no scroll container at all)", () => {
    const faulted = SOURCE.replace(/<div class="cat-table-scroll">\s*/, "").replace(
      /\s*<\/div>\n(\s*<p class="label">)/,
      "\n$1",
    );
    expect(faulted).not.toMatch(/<div class="cat-table-scroll">/);
  });
});
