// R3-W2 Deliverable 2, "Map view · SVG": an SVG DOCUMENT the same pixel size as the PNG, with the
// PNG embedded as `<image href="data:...">` and the footer text + legend gradient/labels as REAL
// vector elements (never rasterized) -- so a viewer/print tool can select the footer text and the
// legend still reads at any zoom, while the map imagery itself stays exactly what MapLibre painted
// (the brief: "raster map in an SVG wrapper -- nobody expects vector coastlines", stated as this
// item's own menu hint in `items.ts`). Pure string-building, no DOM (CLAUDE.md) -- `mapSvgExport.ts`
// is the thin DOM-touching caller that captures the PNG and hands this module plain data.
import { footerLines, shareUrlWithoutOrigin, type FooterInfo } from "./footer";
import { legendLayout } from "./legendLayout";

export interface LegendStopLike {
  color: string;
  value: number;
}

export interface MapSvgOptions {
  /** the map capture, already a `data:image/png;base64,...` URL (`mapCapture.ts`). */
  pngDataUrl: string;
  /** the PNG's own pixel size -- the SVG's `viewBox`/map `<image>` are sized from this, never
   * re-measured from the data URL itself (a `<img>` load round-trip this module has no DOM for). */
  mapWidth: number;
  mapHeight: number;
  footerHeight: number;
  footer: FooterInfo;
  /** the legend gradient stops (`LegendStop[]`, `raster/ramps.ts`) -- `[]`/omitted draws no legend
   * (a figure whose surface has no ramp, e.g. a categorical species layer). */
  legendStops?: readonly LegendStopLike[];
  formatValue?: (v: number) => string;
  backgroundColor: string;
  footerBg: string;
  footerFg: string;
  footerMuted: string;
  footerBorder: string;
  fontFamily?: string;
}

/** XML-escapes the five characters that would otherwise break a `<text>` node or an attribute
 * value -- footer text carries a species scientific name / URL, neither of which this app
 * controls the byte content of (an `&`-containing query string, an apostrophe in a common name). */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** the SVG document string -- `viewBox="0 0 W H"` where `H = mapHeight + footerHeight`, matching
 * the PNG composite's own total canvas height (`mapPng.ts`) so the two downloads frame identically. */
export function buildMapSvg(opts: MapSvgOptions): string {
  const font = (opts.fontFamily ?? "sans-serif").replace(/"/g, "'");
  const totalHeight = opts.mapHeight + opts.footerHeight;
  const [line1, line2] = footerLines(opts.footer);
  const footerY = opts.mapHeight;
  const pad = 12;

  const legend = opts.legendStops?.length
    ? renderLegend(opts.legendStops, opts, opts.mapWidth, opts.mapHeight, opts.footerHeight)
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.mapWidth}" height="${totalHeight}" viewBox="0 0 ${opts.mapWidth} ${totalHeight}">`,
    `<rect width="100%" height="100%" fill="${opts.backgroundColor}"/>`,
    `<image x="0" y="0" width="${opts.mapWidth}" height="${opts.mapHeight}" href="${opts.pngDataUrl}"/>`,
    legend,
    `<rect x="0" y="${footerY}" width="${opts.mapWidth}" height="${opts.footerHeight}" fill="${opts.footerBg}"/>`,
    `<rect x="0" y="${footerY}" width="${opts.mapWidth}" height="1" fill="${opts.footerBorder}"/>`,
    `<text x="${pad}" y="${footerY + 20}" font-family="${font}" font-size="12" fill="${opts.footerFg}">${escapeXml(line1)}</text>`,
    `<text x="${pad}" y="${footerY + 36}" font-family="${font}" font-size="11" fill="${opts.footerMuted}">${escapeXml(line2)}</text>`,
    `</svg>`,
  ].join("");
}

function renderLegend(
  stops: readonly LegendStopLike[],
  opts: MapSvgOptions,
  canvasWidth: number,
  mapHeight: number,
  footerHeight: number,
): string {
  const layout = legendLayout({
    canvasWidth,
    canvasHeight: mapHeight + footerHeight,
    footerHeight,
  });
  const gradId = "ms-download-legend-gradient";
  const stopEls = stops
    .map((s, i) => {
      const offset = stops.length > 1 ? (i / (stops.length - 1)) * 100 : 0;
      return `<stop offset="${offset}%" stop-color="${s.color}"/>`;
    })
    .join("");
  const fmt = opts.formatValue ?? ((v: number) => v.toFixed(2));
  const lo = escapeXml(fmt(stops[0].value));
  const hi = escapeXml(fmt(stops[stops.length - 1].value));
  const font = (opts.fontFamily ?? "sans-serif").replace(/"/g, "'");
  return [
    `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">${stopEls}</linearGradient></defs>`,
    `<rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="${layout.height / 2}" fill="url(#${gradId})"/>`,
    `<text x="${layout.x}" y="${layout.labelY}" font-family="${font}" font-size="10" fill="${opts.footerFg}">${lo}</text>`,
    `<text x="${layout.x + layout.width}" y="${layout.labelY}" font-family="${font}" font-size="10" fill="${opts.footerFg}" text-anchor="end">${hi}</text>`,
  ].join("");
}

// re-exported so a caller building only the footer (no legend) never has to reach into footer.ts
// separately just to strip the share URL's origin for its own toast/label text.
export { shareUrlWithoutOrigin };
