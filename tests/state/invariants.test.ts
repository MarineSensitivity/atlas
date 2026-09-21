// Repo-shaped invariants for state/ that can't be expressed as an ordinary input/output unit test —
// each is a seeded-fault gate named in the atlas-2 Step 2 orchestration: "pushState used instead of
// replaceState" and the svelte-import boundary ("no module in src/lib imports svelte except state/").
// Source-scanning is the same technique tests/release/inline-early-fetch.test.ts and
// tests/pins.test.ts already use in this repo for a rule that has no other executable form (there is
// no DOM harness here — vitest.config.ts runs environment: "node" — so a real `history.replaceState`
// call can't be observed by invoking code; reading whether the source calls it is the available
// proxy, and a real browser-level check belongs to a later UI phase's Playwright spec).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SEL_STORE_PATH = join(ROOT, "src/lib/state/sel.svelte.ts");
const SEL_STORE_SRC = readFileSync(SEL_STORE_PATH, "utf8");

describe("sel.svelte.ts writes the URL with history.replaceState, never pushState", () => {
  it("calls .replaceState( somewhere in the module", () => {
    expect(SEL_STORE_SRC).toMatch(/\.replaceState\s*\(/);
  });

  it("never calls .pushState( — the seeded fault: pushState used instead of replaceState", () => {
    expect(SEL_STORE_SRC).not.toMatch(/\.pushState\s*\(/);
  });
});

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listFiles(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

describe("no module in src/lib imports svelte, except state/ (Gate: keeps the runtime Node-testable)", () => {
  const LIB_DIR = join(ROOT, "src/lib");
  const SVELTE_IMPORT_RE = /from\s+["']svelte(\/[^"']*)?["']/;

  it('every .ts/.js file under src/lib OUTSIDE state/ has no `from "svelte..."` import', () => {
    const offenders: string[] = [];
    for (const file of listFiles(LIB_DIR, [".ts", ".js"])) {
      const rel = relative(LIB_DIR, file).split("\\").join("/"); // normalize on Windows too
      if (rel.startsWith("state/")) continue;
      const src = readFileSync(file, "utf8");
      if (SVELTE_IMPORT_RE.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  // Svelte 5 runes ($state, $derived, ...) are ambient compiler intrinsics, not imported from
  // "svelte" — sel.svelte.ts uses $state() but has no `from "svelte"` import at all, which is
  // correct and exactly why the boundary check above cannot be vacuous by accident: prove
  // "meaningful" via rune USAGE (the actual svelte-ness) rather than an import statement that a
  // runes-only file would never have.
  const RUNE_USE_RE = /\$state\s*(<[^>]*>)?\s*\(/; // allows `$state<Sel>(...)`'s generic type arg

  it("state/ itself uses a Svelte rune somewhere (proves the check above is not vacuous)", () => {
    const stateFiles = listFiles(join(LIB_DIR, "state"), [".ts", ".js"]);
    const anyUsesRunes = stateFiles.some((f) => RUNE_USE_RE.test(readFileSync(f, "utf8")));
    expect(anyUsesRunes).toBe(true);
  });

  it("sel.svelte.ts itself is the file using the rune (correctly named .svelte.ts)", () => {
    expect(RUNE_USE_RE.test(SEL_STORE_SRC)).toBe(true);
  });
});

describe("preview mode's only door is session.preview===true — release/*.ts never reads localStorage or compares hostname", () => {
  const RELEASE_DIR = join(ROOT, "src/lib/release");

  it("no file under src/lib/release references localStorage/sessionStorage", () => {
    const offenders: string[] = [];
    for (const file of listFiles(RELEASE_DIR, [".ts"])) {
      const src = readFileSync(file, "utf8");
      if (/\blocalStorage\b|\bsessionStorage\b/.test(src)) offenders.push(relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it("no file under src/lib/release compares location.host/location.hostname to decide preview", () => {
    const offenders: string[] = [];
    for (const file of listFiles(RELEASE_DIR, [".ts"])) {
      const src = readFileSync(file, "utf8");
      if (/location\.host(name)?\s*(===|==|!==|!=)/.test(src)) offenders.push(relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});
