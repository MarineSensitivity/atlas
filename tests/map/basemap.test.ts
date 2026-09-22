// One fixture per rule (CLAUDE.md "Testing pyramid"): the theme→basemap table, the tile template's
// shape, and the drift guard tying the WebGL background to the CSS token the page paints behind it.
import { describe, expect, it } from "vitest";
import tokens from "../../src/lib/brand/tokens.json";
import {
  BASEMAP_BY_THEME,
  GLYPHS_URL,
  MAP_BACKGROUND_BY_THEME,
  basemapForTheme,
} from "../../src/lib/map/layers/basemap";

describe("basemapForTheme (spec.md §3: navy → dark-matter, paper → positron)", () => {
  it("navy is CARTO dark-matter (dark_all)", () => {
    expect(BASEMAP_BY_THEME.navy).toBe("dark_all");
    expect(basemapForTheme("navy").tiles).toEqual([
      "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ]);
  });

  it("paper is CARTO positron (light_all)", () => {
    expect(BASEMAP_BY_THEME.paper).toBe("light_all");
    expect(basemapForTheme("paper").tiles).toEqual([
      "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    ]);
  });

  it("is a 256 px raster source with an attribution string and one absolute URL", () => {
    const b = basemapForTheme("navy");
    expect(b.tileSize).toBe(256);
    expect(b.attribution).toContain("OpenStreetMap");
    // plan D2 / CLAUDE.md "Relative base": a data or tile URL is never relative to the mount point.
    expect(b.tiles.every((t) => t.startsWith("https://"))).toBe(true);
  });

  it("the glyph endpoint is absolute and carries MapLibre's own placeholders", () => {
    expect(GLYPHS_URL).toMatch(/^https:\/\//);
    expect(GLYPHS_URL).toContain("{fontstack}");
    expect(GLYPHS_URL).toContain("{range}");
  });
});

describe("the map background equals the --surface-map token (drift guard)", () => {
  // a style is not CSS and cannot read a custom property, so the value is duplicated by necessity
  // — this is the gate that keeps the duplicate honest, in both themes.
  it.each(["navy", "paper"] as const)("%s", (theme) => {
    expect(MAP_BACKGROUND_BY_THEME[theme]).toBe(tokens[theme]["--surface-map"].toLowerCase());
  });
});
