// R3-W2 Deliverable 2, "Map view · PNG"/"Map view · SVG": the DOM-touching half -- reads the live
// MapLibre canvas and composites it with the footer band + legend onto a fresh 2D canvas. The
// brief's own recipe: "`preserveDrawingBuffer` is already set (`src/lib/map/map.ts`);
// `map.triggerRepaint()` then two rAFs, then `canvas.toDataURL`" -- the SAME two-rAF settle
// `report/reportMap.ts#captureMapPng` already uses for the report's own map capture (not imported
// from here: that module pulls in `composeStyle`/`zones.ts` for building a SECOND map from scratch,
// which this feature does not need -- it reads the shell's own, already-live map). Pure geometry
// (`footer.ts`/`legendLayout.ts`) stays unit-tested without a DOM; this file is exercised by
// `e2e/download.spec.ts` (a real browser, a real canvas).
import { footerLines, type FooterInfo } from "./footer";
import { legendLayout, type LegendLayout } from "./legendLayout";
import {
  DOWNLOAD_BG_FALLBACK,
  DOWNLOAD_FOOTER_BG_FALLBACK,
  DOWNLOAD_FOOTER_BORDER_FALLBACK,
  DOWNLOAD_FOOTER_FG_FALLBACK,
  DOWNLOAD_FOOTER_MUTED_FALLBACK,
} from "./colors";

export interface MapLike {
  triggerRepaint(): void;
  getCanvas(): HTMLCanvasElement;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** forces a repaint and waits two animation frames (the brief's own recipe) before reading the
 * canvas back -- `preserveDrawingBuffer` (already set, `map/map.ts`) makes the readback safe. */
export async function settleMapCanvas(map: MapLike): Promise<HTMLCanvasElement> {
  map.triggerRepaint();
  await nextFrame();
  await nextFrame();
  return map.getCanvas();
}

export interface LegendStopLike {
  color: string;
  value: number;
}

export const FOOTER_HEIGHT_PX = 46;

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  stops: readonly LegendStopLike[],
  layout: LegendLayout,
  fg: string,
  formatValue: (v: number) => string,
) {
  if (stops.length === 0) return;
  const grad = ctx.createLinearGradient(layout.x, 0, layout.x + layout.width, 0);
  stops.forEach((s, i) =>
    grad.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, s.color),
  );
  ctx.fillStyle = grad;
  const r = layout.height / 2;
  ctx.beginPath();
  // a rounded-pill bar (matches Legend.svelte's own `--radius-pill` ramp) -- `roundRect` is
  // supported in every browser this app already targets (chromium/webkit/firefox, e2e's own matrix).
  ctx.roundRect(layout.x, layout.y, layout.width, layout.height, r);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = "10px sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(formatValue(stops[0].value), layout.x, layout.labelY);
  ctx.textAlign = "right";
  ctx.fillText(formatValue(stops[stops.length - 1].value), layout.x + layout.width, layout.labelY);
}

export interface CompositeMapPngOptions {
  footer: FooterInfo;
  legendStops?: readonly LegendStopLike[];
  formatValue?: (v: number) => string;
  scale?: number;
}

/** the finished figure: the live map canvas + an opaque theme background (never transparent, per
 * the brief) + the footer band + the legend gradient bottom-left -- returns a canvas so PNG (this
 * module, `toBlob`) and SVG (`mapSvgExport.ts`, which reads the RAW map canvas separately, never
 * this composited one -- see that module's own header) share the exact same layout math. */
export async function compositeMapFigure(
  map: MapLike,
  opts: CompositeMapPngOptions,
): Promise<HTMLCanvasElement> {
  const mapCanvas = await settleMapCanvas(map);
  const scale = opts.scale ?? 1;
  const width = mapCanvas.width;
  const height = mapCanvas.height;
  const footerHeight = Math.round(FOOTER_HEIGHT_PX * (width / (mapCanvas.clientWidth || width)));
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height + footerHeight;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("compositeMapFigure: 2D canvas context unavailable");

  const bg = cssVar("--surface-map", DOWNLOAD_BG_FALLBACK);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(mapCanvas, 0, 0);

  const footerBg = cssVar("--surface-raised", DOWNLOAD_FOOTER_BG_FALLBACK);
  const footerBorder = cssVar("--border-control", DOWNLOAD_FOOTER_BORDER_FALLBACK);
  const footerFg = cssVar("--text-primary", DOWNLOAD_FOOTER_FG_FALLBACK);
  const footerMuted = cssVar("--text-secondary", DOWNLOAD_FOOTER_MUTED_FALLBACK);
  ctx.fillStyle = footerBg;
  ctx.fillRect(0, height, out.width, footerHeight);
  ctx.fillStyle = footerBorder;
  ctx.fillRect(0, height, out.width, Math.max(1, scale));

  const [line1, line2] = footerLines(opts.footer);
  ctx.font = "12px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = footerFg;
  ctx.fillText(line1, 12, height + footerHeight * 0.32);
  ctx.fillStyle = footerMuted;
  ctx.font = "11px sans-serif";
  ctx.fillText(line2, 12, height + footerHeight * 0.72);

  if (opts.legendStops?.length) {
    const layout = legendLayout({ canvasWidth: out.width, canvasHeight: out.height, footerHeight });
    drawLegend(ctx, opts.legendStops, layout, footerFg, opts.formatValue ?? ((v) => v.toFixed(2)));
  }

  return out;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob produced no PNG blob"))),
      "image/png",
    );
  });
}
