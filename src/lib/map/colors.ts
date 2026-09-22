// THE ONLY place the map module writes a colour literal.
//
// These are DATA colours, and they are not a ramp: they are the `zone_style` table msens publishes
// (`zone_line_args()` / `zone_label_args()`, zone_style.R:22-55), the selection highlight
// (atlas-4 §6.6), the binary-mask overlay's RGBA (`cog_tile_url(color = "#222222")`,
// viz.R:412-420), and the two `--surface-map` values a WebGL background layer needs but cannot read
// from CSS. Every one of them is fixed by a parity reference or a design token, none of them
// encodes a value, and none may move into `src/lib/brand/tokens.css` — that file's rule is that a
// token is CHROME (spec.md §2: "brand colors are chrome; data colors are data").
//
// Two gates meet here. `scripts/check-hex-literals.mjs` does not scan this directory at all
// (tokens are a brand rule). `tests/raster/ramps.wiring.test.ts` — "ramps.ts is the only ramp or
// palette definition under src/" — DOES, and it names this one file as its single map-side
// exception, with a companion assertion that nothing ramp-shaped (five or more stops) is ever
// defined here. Put a new map colour in this file or nowhere.

/** `--surface-map` per theme, as a plain hex. `tests/map/basemap.test.ts` asserts these equal
 * `src/lib/brand/tokens.json`'s value in both themes, so the map background cannot drift from the
 * page background the shell paints behind it. */
export const MAP_BACKGROUND_NAVY = "#0b1635";
export const MAP_BACKGROUND_PAPER = "#eaeef3";

// --- the zone_style table's colours ------------------------------------------------------------

/** programarea / planarea outlines, and the "anything else" fallback row. */
export const ZONE_LINE_WHITE = "#ffffff";
/** ecoregion outlines. */
export const ZONE_LINE_BLACK = "#000000";
/** subregion outlines (dashed). */
export const ZONE_LINE_GREY = "#d9d9d9";

/** programarea / planarea labels: white glyph on a dark halo. */
export const ZONE_LABEL_WHITE = "#ffffff";
export const ZONE_LABEL_HALO_DARK = "rgba(0,0,0,0.75)";
/** ecoregion labels: black glyph on a light halo. */
export const ZONE_LABEL_BLACK = "#000000";
export const ZONE_LABEL_HALO_LIGHT = "rgba(255,255,255,0.85)";

// --- selection and overlays ---------------------------------------------------------------------

/** the selection highlight — a cell ring, a zone outline, a drawn place (atlas-4 §6.6/§7.1-7.3). */
export const SELECTION_COLOR = "#ff00aa";

/** `manifest.overlays._outside_pra`'s explicit colormap, `{"1":[34,34,34,255]}` (atlas-4 §6.3). */
export const OUTSIDE_PRA_RGBA: readonly [number, number, number, number] = [34, 34, 34, 255];
