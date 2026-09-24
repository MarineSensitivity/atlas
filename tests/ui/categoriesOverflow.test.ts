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

// the `.col` rule below carries a long prose comment that itself SAYS "min-width: 0" (explaining
// the fix) -- a `[^}]*min-width:\s*0` scan over the raw block would still match that comment even
// after the real declaration is removed (measured: the seeded-fault test below stayed green on
// the WRONG string). Stripping `/* ... */` comments first is what makes the scan see only real
// CSS, the same way a real browser's parser would.
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Categories.svelte's table sits inside a scroll container", () => {
  it("the table is wrapped in .cat-table-scroll", () => {
    expect(SOURCE).toMatch(/<div class="cat-table-scroll"[^>]*>[\s\S]*<table class="cat-table">/);
  });

  it(".cat-table-scroll caps its own width and scrolls horizontally, not the page", () => {
    const styleBlock = SOURCE.slice(SOURCE.indexOf("<style>"));
    expect(styleBlock).toMatch(/\.cat-table-scroll\s*{[^}]*max-width:\s*100%/);
    expect(styleBlock).toMatch(/\.cat-table-scroll\s*{[^}]*overflow-x:\s*auto/);
  });

  // gallery axe ceilings fix: `.cat-table-scroll` only became genuinely internally scrollable
  // once `.col` got its own `min-width: 0` (this round) -- before that the overflow was silently
  // absorbed by `#gallery-main` instead, so this div's scrollWidth never actually exceeded its
  // clientWidth and axe's `scrollable-region-focusable` rule ("Scrollable region must have
  // keyboard access", serious) had nothing to flag. A plain read-only table gives the region no
  // focusable descendant of its own (unlike DataTable.svelte's `.scroll-region`, whose
  // sortable/filterable grid always has one), so the region itself must be the keyboard stop.
  it("is keyboard-focusable with an accessible name, not a second nested landmark", () => {
    expect(SOURCE).toMatch(/<div class="cat-table-scroll"[^>]*\btabindex="0"/);
    // role="group", never "region" -- the gallery section (App.svelte's aria-labelledby
    // <section>) is already an implicit region; a nested region here would be a second landmark
    // with a near-duplicate name (Sheet.svelte's .sheet-body / Panel.svelte's .panel-body fix,
    // same idiom).
    expect(SOURCE).toMatch(/<div class="cat-table-scroll"[^>]*\brole="group"/);
    expect(SOURCE).not.toMatch(/<div class="cat-table-scroll"[^>]*\brole="region"/);
    expect(SOURCE).toMatch(/<div class="cat-table-scroll"[^>]*\baria-label="[^"]+"/);
  });

  // gallery axe ceilings round FOLLOW-UP (CI run 35982505817): the real bug -- `.col` (a flex
  // item of `.gallery-stage`) with no explicit `min-width` floors its shrink at its own
  // min-content size, so `.cat-table-scroll`'s unbreakable `<code>` tokens push `.col` (and a
  // sibling paragraph) past the section's right edge -- was originally guarded ONLY by a real
  // Playwright/axe render at 320 CSS px (e2e/gallery.spec.ts). That gate is not platform
  // independent: dropping `min-width: 0` stayed GREEN on the linux CI runner, because linux
  // Chromium's narrower `<code>` glyph metrics never actually push `.col` past 288px there, so
  // removing the fix changes nothing axe can see. `min-width: 0` is a CSS DECLARATION, not a
  // pixel measurement -- asserting its presence in the SOURCE is the platform-independent form of
  // this same rule, so this it()/its seeded-fault twin below now carry the fault gate instead
  // (scripts/test-faults.mjs's `gallery-categories-min-width-dropped` entry).
  it(".col carries min-width: 0, so it actually shrinks to its section instead of the table's intrinsic width", () => {
    const styleBlock = stripCssComments(SOURCE.slice(SOURCE.indexOf("<style>")));
    expect(styleBlock).toMatch(/\.col\s*{[^}]*min-width:\s*0\b/);
  });
});

describe("the gate can fail (seeded fault)", () => {
  it("catches the ORIGINAL unwrapped table (no scroll container at all)", () => {
    const faulted = SOURCE.replace(/<div class="cat-table-scroll"[^>]*>\s*/, "").replace(
      /\s*<\/div>\n(\s*<p class="label">)/,
      "\n$1",
    );
    expect(faulted).not.toMatch(/<div class="cat-table-scroll"/);
  });

  it("catches the scrollable region losing its keyboard focusability (tabindex dropped)", () => {
    const faulted = SOURCE.replace(/(<div class="cat-table-scroll"[^>]*)\s+tabindex="0"/, "$1");
    expect(faulted).not.toMatch(/<div class="cat-table-scroll"[^>]*\btabindex="0"/);
  });

  // the exact mutation tests/faults/gallery-categories-min-width-dropped.patch applies to the
  // real file -- kept here too as the in-file, self-proving twin (this describe block's own
  // pattern), so `npm test` alone also guards it, not only `npm run test:faults`.
  it("catches `.col` losing min-width: 0 (the real 320px overflow bug, platform-independent)", () => {
    const faulted = SOURCE.replace(/\n\s*min-width:\s*0;\n(\s*})/, "\n$1");
    const styleBlock = stripCssComments(faulted.slice(faulted.indexOf("<style>")));
    expect(styleBlock).not.toMatch(/\.col\s*{[^}]*min-width:\s*0\b/);
  });
});
