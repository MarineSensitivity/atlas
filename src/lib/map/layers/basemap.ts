// The basemap, picked by theme — spec.md §3: `navy` → dark-matter, `paper` → positron.
//
// WHY RASTER, not the CARTO vector style (`.../gl/dark-matter-gl-style/style.json`, which the Shiny
// app's `carto_style("dark-matter")` uses): the vector style is a 70 KB style.json whose own
// `sources.carto` then pulls a TileJSON, vector tiles, a sprite sheet AND a glyph range before a
// single basemap pixel appears — four extra round trips on the first-paint path, and a second style
// object that would have to be merged into ours (CLAUDE.md: there is exactly ONE composed style).
// The raster endpoints below are the same two CARTO basemaps rendered server-side: one source, one
// layer, no sprite, no TileJSON, no key, and zero added JS. That makes them the smallest option that
// works, and the only one a hermetic `page.route` can serve offline with a single PNG fixture.
//
// Glyphs are still needed for the zone LABEL layers (layers/zones.ts) — that one URL is CARTO's own
// font endpoint, read from the same style.json (verified 2026-09-22), and is only fetched when a
// symbol layer actually exists.
import { MAP_BACKGROUND_NAVY, MAP_BACKGROUND_PAPER } from "../colors";
import type { BasemapSpec, ResolvedTheme } from "../types";

/** CARTO's keyless raster basemap host (`dark_all` = dark-matter, `light_all` = positron). */
export const CARTO_RASTER_BASE = "https://basemaps.cartocdn.com";

/** CARTO's glyph endpoint, verbatim from `dark-matter-gl-style/style.json`'s `glyphs` key. Only a
 * symbol layer fetches it; a style with no labels never touches it. */
export const GLYPHS_URL = "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf";

/** the font stack every label layer names — one stack, so one glyph range is fetched, not four. */
export const LABEL_FONT: readonly string[] = ["Open Sans Regular"];

export const BASEMAP_ATTRIBUTION = "© OpenStreetMap contributors © CARTO";

/** theme → CARTO basemap name. `navy` is dark-matter and `paper` is positron (spec.md §3); this is
 * the ONE table that mapping lives in. */
export const BASEMAP_BY_THEME: Record<ResolvedTheme, string> = {
  navy: "dark_all",
  paper: "light_all",
};

/**
 * The `--surface-map` token of each theme, as a plain hex the WebGL background layer can take (a
 * style is not CSS and cannot read a custom property). `tests/map/basemap.test.ts` asserts these
 * equal `src/lib/brand/tokens.json`'s `--surface-map` in both themes, so the map's background can
 * never drift from the page background the shell paints behind it.
 */
export const MAP_BACKGROUND_BY_THEME: Record<ResolvedTheme, string> = {
  navy: MAP_BACKGROUND_NAVY,
  paper: MAP_BACKGROUND_PAPER,
};

/** the basemap source+layer spec for a theme. */
export function basemapForTheme(theme: ResolvedTheme): BasemapSpec {
  const name = BASEMAP_BY_THEME[theme];
  return {
    id: "basemap",
    tiles: [`${CARTO_RASTER_BASE}/${name}/{z}/{x}/{y}.png`],
    tileSize: 256,
    maxzoom: 20,
    attribution: BASEMAP_ATTRIBUTION,
  };
}
