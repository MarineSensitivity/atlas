// R3-W2 Deliverable 2, "Map view · SVG": the DOM-touching half of the SVG export -- reads the raw
// (un-composited) map canvas as a PNG data URL and hands it to `svgWrapper.ts#buildMapSvg`, which
// draws the footer/legend as real vector elements around it. Deliberately does NOT reuse
// `mapCapture.ts#compositeMapFigure`'s OUTPUT canvas (that canvas has already rasterized the
// footer/legend into pixels) -- it reuses only `settleMapCanvas`, the shared repaint-and-wait step,
// so the two exports never race each other's `triggerRepaint()`.
import { settleMapCanvas, FOOTER_HEIGHT_PX, type MapLike, type LegendStopLike } from "./mapCapture";
import { buildMapSvg, type MapSvgOptions } from "./svgWrapper";
import type { FooterInfo } from "./footer";
import {
  DOWNLOAD_BG_FALLBACK,
  DOWNLOAD_FOOTER_BG_FALLBACK,
  DOWNLOAD_FOOTER_BORDER_FALLBACK,
  DOWNLOAD_FOOTER_FG_FALLBACK,
  DOWNLOAD_FOOTER_MUTED_FALLBACK,
} from "./colors";

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface BuildMapSvgFromMapOptions {
  footer: FooterInfo;
  legendStops?: readonly LegendStopLike[];
  formatValue?: (v: number) => string;
}

/** the SVG document string for the CURRENT map view -- theme colors read live (never transparent),
 * matching `compositeMapFigure`'s own PNG background rule. */
export async function buildMapSvgFromMap(
  map: MapLike,
  opts: BuildMapSvgFromMapOptions,
): Promise<string> {
  const canvas = await settleMapCanvas(map);
  const pngDataUrl = canvas.toDataURL("image/png");
  const width = canvas.width;
  const height = canvas.height;
  const footerHeight = Math.round(FOOTER_HEIGHT_PX * (width / (canvas.clientWidth || width)));

  const svgOpts: MapSvgOptions = {
    pngDataUrl,
    mapWidth: width,
    mapHeight: height,
    footerHeight,
    footer: opts.footer,
    legendStops: opts.legendStops,
    formatValue: opts.formatValue,
    backgroundColor: cssVar("--surface-map", DOWNLOAD_BG_FALLBACK),
    footerBg: cssVar("--surface-raised", DOWNLOAD_FOOTER_BG_FALLBACK),
    footerFg: cssVar("--text-primary", DOWNLOAD_FOOTER_FG_FALLBACK),
    footerMuted: cssVar("--text-secondary", DOWNLOAD_FOOTER_MUTED_FALLBACK),
    footerBorder: cssVar("--border-control", DOWNLOAD_FOOTER_BORDER_FALLBACK),
  };
  return buildMapSvg(svgOpts);
}
