// atlas-8 fiddly bit: a single skip link to #panel-region jumped past the topbar AND the tool
// rail (the rail is a roving-tabindex toolbar with exactly one focusable stop, sitting immediately
// before #panel-region in DOM order) -- Tab from the skip link landed inside the panel, and the
// rail was reachable only by Shift+Tab backward from there. Fixed with a second skip link. Source
// scan of the real static skeleton, the same technique tests/shell/shell-invariants.test.ts and
// tests/shell/tools.test.ts already use for index.html-vs-real-DOM properties that need a real
// browser to observe directly (e2e/shell.a11y.spec.ts's own keyboard walk is the browser-level
// twin of this).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX_HTML = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

function skipLinkHrefs(html: string): string[] {
  return [...html.matchAll(/<a class="skip-link" href="(#[^"]+)"/g)].map((m) => m[1]);
}

describe("skip links reach both the rail and the panel, in DOM order", () => {
  it("there are two skip links: #rail-region then #panel-region", () => {
    expect(skipLinkHrefs(INDEX_HTML)).toEqual(["#rail-region", "#panel-region"]);
  });

  it("both targets exist as real ids in the skeleton", () => {
    expect(INDEX_HTML).toMatch(/id="rail-region"/);
    expect(INDEX_HTML).toMatch(/id="panel-region"/);
  });

  it("the skip links themselves precede both targets in the document (they are the first stops)", () => {
    const skipEnd = INDEX_HTML.indexOf('id="panel-region"'); // the later of the two skip <a>s
    const firstSkip = INDEX_HTML.indexOf('href="#rail-region"');
    const secondSkip = INDEX_HTML.indexOf('href="#panel-region"');
    expect(firstSkip).toBeGreaterThan(-1);
    expect(secondSkip).toBeGreaterThan(firstSkip);
    expect(INDEX_HTML.indexOf('id="rail-region"')).toBeGreaterThan(secondSkip);
    expect(skipEnd).toBeGreaterThan(secondSkip);
  });
});

describe("the gate can fail (seeded fault)", () => {
  it("catches the ORIGINAL single-skip-link regression", () => {
    const faulted = INDEX_HTML.replace(
      '<a class="skip-link" href="#rail-region">Skip to the tools</a>\n    ',
      "",
    );
    expect(skipLinkHrefs(faulted)).toEqual(["#panel-region"]);
  });
});
