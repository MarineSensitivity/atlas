// atlas-3 step 3: repo-shaped invariants for the shell that can't be expressed as an ordinary
// input/output unit test -- the same source-scanning technique tests/state/invariants.test.ts
// already uses for sel.svelte.ts (a real `history.pushState` call can't be observed by invoking
// code under vitest's node environment; reading whether the source calls it is the available
// proxy, and e2e/shell.url-state.spec.ts covers the real-browser version of the same rule).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX_HTML = readFileSync("index.html", "utf8");
const MAIN_TS = readFileSync("src/main.ts", "utf8");
const SHELL_SVELTE = readFileSync("src/shell/Shell.svelte", "utf8");
const TOOLS_TS = readFileSync("src/shell/tools.ts", "utf8");
// R2 (docs/usability.md §7, U1): About/Feedback/the phone ⋯ menu live in their OWN component, not
// inline in Shell.svelte (this round's own instructions: a new file so U5/U6 stay additive) --
// its data-control/data-tour anchors are still part of "the shell", so the round-trip check below
// reads it alongside Shell.svelte, never JUST Shell.svelte on its own.
const TOP_BAR_ACTIONS_SVELTE = readFileSync("src/shell/TopBarActions.svelte", "utf8");

describe('the shell never calls history.pushState -- only src/lib/state\'s replaceState does (CLAUDE.md "URL-is-the-view")', () => {
  it("src/main.ts never calls .pushState(", () => {
    expect(MAIN_TS).not.toMatch(/\.pushState\s*\(/);
  });

  it("src/shell/Shell.svelte never calls .pushState( -- every write goes through selStore", () => {
    expect(SHELL_SVELTE).not.toMatch(/\.pushState\s*\(/);
  });

  it("index.html's inline scripts never call .pushState(", () => {
    expect(INDEX_HTML).not.toMatch(/\.pushState\s*\(/);
  });

  it("Shell.svelte writes view state only through selStore.set/.replace, never history.* directly", () => {
    expect(SHELL_SVELTE).not.toMatch(/\bhistory\.(replaceState|pushState)\s*\(/);
  });
});

describe("src/main.ts and src/shell/* stay out of the directories this step must not edit", () => {
  // this step imports src/lib/ui/* components and src/lib/state/* -- never src/lib/release
  // directly (the shell reads the release resolution result off window.__early instead, the same
  // global VersionBadge.svelte already reads, so the early-fetch script stays the one place that
  // logic runs before any bundle parses).
  it("Shell.svelte does not import from src/lib/release", () => {
    expect(SHELL_SVELTE).not.toMatch(/from\s+["']\.\.\/lib\/release/);
  });

  it("tools.ts does not import from src/lib/release, geo, grid, engine, raster or analytics", () => {
    expect(TOOLS_TS).not.toMatch(
      /from\s+["']\.\.\/lib\/(release|geo|grid|engine|raster|analytics)/,
    );
  });
});

describe("Shell.svelte owns no scoped <style> of its own for shell layout", () => {
  // every geometry value the CLS gate depends on lives in ONE file, src/shell/shell.css, imported
  // as a plain global stylesheet by both index.html's inline critical CSS and this component --
  // a component-scoped <style> block here would be a second place a shell layout value could be
  // typed, and could silently drift from the skeleton's copy.
  it("has no <style> block", () => {
    expect(SHELL_SVELTE).not.toMatch(/<style[\s>]/);
  });
});

function dataAttrValues(source: string, attr: string): string[] {
  return [...source.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]);
}

describe("the skeleton and the hydrated shell agree on every data-control/data-tour anchor", () => {
  it("every data-control in the skeleton also appears in Shell.svelte + TopBarActions.svelte, and vice versa", () => {
    const skeleton = new Set(dataAttrValues(INDEX_HTML, "data-control"));
    const hydrated = new Set([
      ...dataAttrValues(SHELL_SVELTE, "data-control"),
      ...dataAttrValues(TOP_BAR_ACTIONS_SVELTE, "data-control"),
    ]);
    expect([...skeleton].sort()).toEqual([...hydrated].sort());
    expect(skeleton.size).toBeGreaterThan(0);
  });

  it("every data-tour anchor in the skeleton also appears in Shell.svelte + TopBarActions.svelte, and vice versa", () => {
    const skeleton = new Set(dataAttrValues(INDEX_HTML, "data-tour"));
    const hydrated = new Set([
      ...dataAttrValues(SHELL_SVELTE, "data-tour"),
      ...dataAttrValues(TOP_BAR_ACTIONS_SVELTE, "data-tour"),
    ]);
    expect([...skeleton].sort()).toEqual([...hydrated].sort());
    expect(skeleton.size).toBeGreaterThan(0);
  });
});

// Q1 follow-up (coordinator, 2026-09-24): state.svelte.ts's showCellPopup shipped two DIAG2
// console.log calls to production, one on every scores-lens cell click -- a shipped app must not
// log diagnostics on every click. Removed; this scan is what keeps it removed.
describe("src/lens/** never ships a console.log(", () => {
  it("no console.log( appears in any src/lens/**/*.{ts,svelte} file", () => {
    const files = (readdirSync("src/lens", { recursive: true }) as string[]).filter((f) =>
      /\.(ts|svelte)$/.test(f),
    );
    const offenders = files.filter((f) =>
      /console\.log\(/.test(readFileSync(`src/lens/${f}`, "utf8")),
    );
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(4); // not vacuous
  });
});
