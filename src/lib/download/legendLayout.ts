// R3-W2 Deliverable 2: pure layout math for the legend gradient drawn onto a download figure
// (bottom-left, per the brief) -- separated from the actual canvas/SVG drawing (`mapPng.ts`/
// `svgWrapper.ts`) so the GEOMETRY is unit-testable without a DOM (CLAUDE.md).

export interface LegendLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  /** where the two endpoint labels sit, vertically centered under the gradient bar. */
  labelY: number;
}

export interface LegendLayoutOptions {
  /** the whole figure's pixel size (before any device-pixel-ratio scale the caller applies). */
  canvasWidth: number;
  canvasHeight: number;
  /** how far the legend's bottom edge sits above the canvas's own bottom edge -- the footer band
   * sits BELOW the map image (see `mapPng.ts`), so the legend (bottom-LEFT of the MAP, per the
   * brief) is measured up from the top of that footer band, not from the canvas's true bottom. */
  footerHeight: number;
  margin?: number;
  barWidth?: number;
  barHeight?: number;
}

const DEFAULT_MARGIN = 16;
const DEFAULT_BAR_WIDTH = 160;
const DEFAULT_BAR_HEIGHT = 10;
const LABEL_GAP = 14;

/** the gradient bar's box, inset `margin` from the map image's bottom-left corner (i.e. above the
 * footer band) -- deterministic given the figure size, so a test can assert exact pixel positions
 * without ever constructing a canvas. */
export function legendLayout(opts: LegendLayoutOptions): LegendLayout {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const width = opts.barWidth ?? DEFAULT_BAR_WIDTH;
  const height = opts.barHeight ?? DEFAULT_BAR_HEIGHT;
  const mapBottom = opts.canvasHeight - opts.footerHeight;
  const y = mapBottom - margin - height - LABEL_GAP;
  return { x: margin, y, width, height, labelY: y + height + LABEL_GAP - 3 };
}
