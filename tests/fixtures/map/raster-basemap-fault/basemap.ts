// Seeded fault (tests/fixtures/map/faults.ts's FAULT 4): a reinstated CARTO RASTER basemap —
// the exact literal that shipped the "API KEY REQUIRED" watermark (owner report, 2026-09-23).
// tests/map/no-raster-basemap.test.ts's scanner must flag this file; it is never imported by src/.
export const CARTO_RASTER_BASE = "https://basemaps.cartocdn.com";

export function basemapForTheme(theme: "navy" | "paper") {
  const name = theme === "navy" ? "dark_all" : "light_all";
  return { tiles: [`${CARTO_RASTER_BASE}/${name}/{z}/{x}/{y}.png`] };
}
