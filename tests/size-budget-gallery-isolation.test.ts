// atlas-3 step 2, Deliverable 3: gallery.html must build through its OWN, separate Rollup graph
// (vite.gallery.config.ts), never as a third entry in vite.config.ts's rollupOptions.input.
// Discovered the hard way: adding gallery there once grew index.html's static graph from the
// committed ~11.5 KB gzip baseline to ~14.9 KB, because Rollup shares a chunk (the Svelte runtime)
// between any two entry points that both reach it -- gallery reaches far more of it than
// index.html's one VersionBadge ever did. This is a cheap, fast mechanical guard against that
// regression re-appearing; `node scripts/size-budget.mjs` against a real `npm run build` is the
// gate that proves the actual byte count (see the Gates section of the atlas-3 step 2 report).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN_CONFIG = readFileSync("vite.config.ts", "utf8");
const GALLERY_CONFIG = readFileSync("vite.gallery.config.ts", "utf8");

describe("gallery.html builds through its own Vite config, isolated from index.html", () => {
  it("vite.config.ts's rollupOptions.input never names gallery.html", () => {
    const inputBlock = MAIN_CONFIG.match(/rollupOptions:\s*\{\s*input:\s*\{([^}]*)\}/s);
    expect(inputBlock, "vite.config.ts has no rollupOptions.input block").not.toBeNull();
    expect(inputBlock![1]).not.toMatch(/gallery/i);
  });

  it("vite.config.ts's rollupOptions.input still builds index.html and report.html", () => {
    const inputBlock = MAIN_CONFIG.match(/rollupOptions:\s*\{\s*input:\s*\{([^}]*)\}/s)![1];
    expect(inputBlock).toMatch(/index\.html/);
    expect(inputBlock).toMatch(/report\.html/);
  });

  it("vite.gallery.config.ts builds ONLY gallery.html", () => {
    const inputBlock = GALLERY_CONFIG.match(/rollupOptions:\s*\{\s*input:\s*\{([^}]*)\}/s)![1];
    expect(inputBlock).toMatch(/gallery\.html/);
    expect(inputBlock).not.toMatch(/index\.html/);
    expect(inputBlock).not.toMatch(/report\.html/);
  });

  it("vite.gallery.config.ts writes into the same dist/ WITHOUT emptying it (emptyOutDir: false)", () => {
    expect(GALLERY_CONFIG).toMatch(/outDir:\s*"dist"/);
    expect(GALLERY_CONFIG).toMatch(/emptyOutDir:\s*false/);
  });

  it("vite.gallery.config.ts writes its own manifest file, not dist/.vite/manifest.json", () => {
    // scripts/size-budget.mjs only ever reads dist/.vite/manifest.json for entry "index.html" --
    // a same-named manifest here would risk one build's write racing the other's read
    expect(GALLERY_CONFIG).toMatch(/manifest:\s*"gallery-manifest\.json"/);
  });

  it("package.json's build script runs the main build, then the gallery build, in that order", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const build: string = pkg.scripts.build;
    const mainIndex = build.indexOf("vite build");
    const galleryIndex = build.indexOf("vite.gallery.config.ts");
    expect(mainIndex).toBeGreaterThanOrEqual(0);
    expect(galleryIndex).toBeGreaterThan(mainIndex);
  });
});
