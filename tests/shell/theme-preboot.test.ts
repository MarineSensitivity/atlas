// atlas-3 step 3: index.html's pre-paint theme script sets `data-theme` before first paint, through
// the SAME rule as src/lib/state/types.ts's `resolveTheme` (dark -> navy, light -> paper, explicit
// "auto" -> prefers-color-scheme, falling back to navy when that signal is unavailable). U2a
// (round 2): DEFAULT_SEL.theme changed from "auto" to "dark", so an absent/malformed query value
// now resolves straight to navy -- prefers-color-scheme is consulted ONLY for an explicit
// `?theme=auto`. Like tests/release/inline-early-fetch.test.ts does for the early-fetch script,
// this extracts the REAL script text from index.html and runs it in a node:vm sandbox, driven
// through a matrix that also feeds the real `resolveTheme()` -- so the two cannot silently
// disagree, and "the pre-paint theme script removed" (the seeded fault) is red because
// `extractThemeScript` throws when the source no longer contains one.
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DEFAULT_SEL, resolveTheme, THEMES, type Theme } from "../../src/lib/state/types";

const INDEX_HTML = readFileSync("index.html", "utf8");

/** the bare `<script>...</script>` block that sets `dataset.theme` -- distinct from the early-fetch
 * script (which sets `VERSION_RE`) and from the `window.__t0` timing script. */
function extractThemeScript(html: string): string {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((b) => b.includes("dataset.theme"));
  if (!found) throw new Error("no inline script setting dataset.theme found in index.html");
  return found;
}

const script = extractThemeScript(INDEX_HTML);

/** codec.ts's `parseEnum(aliasTheme(params.get("theme")), THEMES, DEFAULT_SEL.theme)`, mirrored:
 * `navy`/`paper` alias to `dark`/`light` (atlas-8 fix, `THEME_ALIASES`); an explicit "auto" reads
 * back as "auto" (still a legal `THEMES` member); anything else -- absent, garbage -- clamps to
 * `DEFAULT_SEL.theme` (U2a: "dark", not "auto"). */
function themeFromQuery(q: string | undefined): Theme {
  const aliased = q === "navy" ? "dark" : q === "paper" ? "light" : q;
  if (aliased === "light" || aliased === "dark") return aliased;
  if (aliased === "auto") return "auto";
  return DEFAULT_SEL.theme;
}

function runThemeScript(search: string, prefersDark: boolean | null): string {
  const sandbox: Record<string, unknown> = {
    location: { search },
    URLSearchParams,
    matchMedia: (query: string) => {
      if (prefersDark === null) throw new Error("matchMedia unavailable");
      // the script only ever queries "(prefers-color-scheme: dark)".
      expect(query).toBe("(prefers-color-scheme: dark)");
      return { matches: prefersDark };
    },
    document: { documentElement: { dataset: {} as Record<string, string> } },
  };
  const ctx = createContext(sandbox);
  runInContext(script, ctx);
  return (sandbox.document as { documentElement: { dataset: Record<string, string> } })
    .documentElement.dataset.theme;
}

describe("the pre-paint theme script agrees with resolveTheme() on every case", () => {
  const queries: (string | undefined)[] = [
    undefined,
    "light",
    "dark",
    "auto",
    "garbage",
    "",
    "navy", // atlas-8 fix: aliases to "dark"
    "paper", // atlas-8 fix: aliases to "light"
  ];
  const prefersDarkCases: (boolean | null)[] = [true, false, null];

  for (const q of queries) {
    for (const prefersDark of prefersDarkCases) {
      const search = q === undefined ? "" : `?theme=${q}`;
      it(`?theme=${q ?? "(absent)"}, prefersDark=${prefersDark} -> resolveTheme's answer`, () => {
        const expected = resolveTheme(themeFromQuery(q), prefersDark);
        expect(runThemeScript(search, prefersDark)).toBe(expected);
      });
    }
  }

  it("every THEMES value the URL can carry is covered by the query matrix above", () => {
    expect(THEMES).toEqual(["light", "dark", "auto"]);
  });
});

describe("the pre-paint theme script reads/writes NOTHING but data-theme", () => {
  it("never touches localStorage, sessionStorage, cookies or the network", () => {
    expect(script).not.toMatch(/localStorage/);
    expect(script).not.toMatch(/sessionStorage/);
    expect(script).not.toMatch(/document\.cookie/);
    expect(script).not.toMatch(/\bfetch\s*\(/);
  });

  it("writes exactly one dataset key (theme), never a second one", () => {
    const assignments = [...script.matchAll(/\.dataset\.(\w+)\s*=/g)].map((m) => m[1]);
    expect(assignments).toEqual(["theme"]);
  });

  it("reads only location.search (never location.pathname/href/hash)", () => {
    expect(script).toMatch(/location\.search/);
    expect(script).not.toMatch(/location\.(pathname|href|hash)/);
  });
});

describe("removing the pre-paint theme script is the seeded fault (no flash)", () => {
  it("extraction throws when index.html has no such script (proves this gate can fail)", () => {
    const withoutIt = INDEX_HTML.replace(script, "/* removed */");
    expect(() => extractThemeScript(withoutIt)).toThrow(/no inline script setting/);
  });
});
