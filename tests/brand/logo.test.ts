// R5 (docs/usability.md §7): the wave-in-hexagon mark. This pins the three things a design
// decision like this can silently regress on -- the file existing at all, the inline component
// staying token-only (scripts/check-hex-literals.mjs already scans src/lib/brand, but the rule
// deserves its own direct assertion here, named after what it protects), and every HTML entry
// point still linking a favicon -- rather than trusting a human to notice a dropped `<link>` or a
// hand-typed hex creeping back into the one component this repo inlines per page.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HEX_LITERAL_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

describe("the wave-in-hexagon mark (R5)", () => {
  it("exists as a static SVG under public/brand/", () => {
    expect(existsSync("public/brand/mark-wavehex.svg")).toBe(true);
    const svg = readFileSync("public/brand/mark-wavehex.svg", "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toMatch(/wave-in-hexagon|R5/); // provenance comment, not a bare untraceable asset
  });

  it("exists as an inline component for the top bar and report header", () => {
    expect(existsSync("src/lib/brand/WaveHexMark.svelte")).toBe(true);
  });

  it("the inline component uses no hex color literal -- fill/stroke are tokens or currentColor", () => {
    const src = readFileSync("src/lib/brand/WaveHexMark.svelte", "utf8");
    const hits = [...src.matchAll(HEX_LITERAL_RE)];
    expect(
      hits.map((m) => m[0]),
      "a hex literal in WaveHexMark.svelte",
    ).toEqual([]);
    // every paint declaration actually resolves through var(...) -- not just "no hex", which a
    // literal color KEYWORD (e.g. "white") would also satisfy without being a token.
    for (const prop of ["fill", "stroke"]) {
      const decls = [...src.matchAll(new RegExp(`${prop}:\\s*([^;]+);`, "g"))].map((m) =>
        m[1].trim(),
      );
      expect(decls.length, `no ${prop} declaration found at all`).toBeGreaterThan(0);
      for (const decl of decls) {
        expect(
          decl === "none" || /^var\(--[\w-]+\)$/.test(decl),
          `${prop}: ${decl} is neither "none" nor a bare var(--token)`,
        ).toBe(true);
      }
    }
  });

  it("favicon link is present in all three HTML entry points", () => {
    for (const file of ["index.html", "report.html", "gallery.html"]) {
      const html = readFileSync(file, "utf8");
      expect(html, `${file} has no favicon link`).toMatch(
        /<link\s+rel="icon"[^>]*href="\.\/favicon\.svg"/,
      );
    }
  });

  it("public/favicon.svg is the wave-in-hexagon mark, not the old placeholder hexagon", () => {
    const svg = readFileSync("public/favicon.svg", "utf8");
    // the placeholder was two flat polygons; the real mark is four paths (bg/wave/crest/ring).
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(svg).not.toContain("placeholder favicon");
  });
});
