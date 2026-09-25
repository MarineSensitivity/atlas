// THE ONLY place src/lib/download writes a colour literal.
//
// These are canvas/SVG fallback colours, not a ramp and not brand chrome: `mapCapture.ts` draws
// directly onto a `<canvas>` 2D context and `mapSvgExport.ts` writes a plain SVG document -- neither
// participates in the CSS cascade, so each needs a resolved fallback string for the (expected to be
// rare) case its own `getComputedStyle(...).getPropertyValue(...)` read comes back empty (no DOM
// yet, tokens.css not loaded). Same exception, same reasoning, as `src/lib/map/colors.ts`,
// `src/report/colors.ts` and `src/lib/feedback/colors.ts` (all three already named in
// `tests/raster/ramps.wiring.test.ts`'s own exemption list) -- collected in ONE file, which that
// test now exempts by exact path too (`DOWNLOAD_COLORS_FILE`).
//
// The VALUES are the same navy-theme tokens `tokens.css` ships for `--surface-map`/
// `--surface-raised`/`--text-primary`/`--text-secondary`/`--border-control` -- a fallback that
// silently used a DIFFERENT palette would make a broken read look like a themed one.
export const DOWNLOAD_BG_FALLBACK = "#0b1635";
export const DOWNLOAD_FOOTER_BG_FALLBACK = "#1c2f57";
export const DOWNLOAD_FOOTER_FG_FALLBACK = "#ffffff";
export const DOWNLOAD_FOOTER_MUTED_FALLBACK = "#c7d2e8";
export const DOWNLOAD_FOOTER_BORDER_FALLBACK = "#8494bd";
