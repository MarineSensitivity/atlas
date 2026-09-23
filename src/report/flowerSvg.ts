// report/flowerSvg.ts -- a STANDALONE `<svg>` markup string for one place's flower, built from the
// SAME `FlowerGeometry` the on-screen figure draws (lib/ui/flowerGeometry.ts) -- never a second
// geometry computation. "Standalone" matters for two exports that render OUTSIDE this document's own
// CSS cascade: the DOCX exporter rasterizes this (svgToPng.ts) in a blank `<img>` context that
// cannot see this page's `var(--cat-*)` custom properties, and the self-contained HTML download
// re-parses the whole page in a browser with no stylesheet at all. `resolveColor` is the seam: the
// live document (Report.svelte) resolves each `--cat-*` token via `getComputedStyle`, and a test
// can pass a trivial identity/lookup function instead.
import type { FlowerGeometry } from "../lib/ui/flowerGeometry";
import {
  REPORT_FLOWER_HUB_FILL,
  REPORT_FLOWER_HUB_STROKE,
  REPORT_FLOWER_PETAL_STROKE,
  REPORT_FLOWER_TEXT,
} from "./colors";

export interface FlowerSvgOptions {
  size?: number;
  /** resolves a CSS custom-property NAME (e.g. "--cat-fish") to a concrete color the SVG can use
   * with no external stylesheet. */
  resolveColor: (cssVarName: string) => string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** the flower's standalone SVG, with `centre` overridden by the caller (model.ts: the table's
 * `Overall`, not the drawn petals' own mean -- see `ReportFlower.centre`'s header). */
export function flowerStandaloneSvg(
  title: string,
  geometry: FlowerGeometry,
  centre: number | null,
  opts: FlowerSvgOptions,
): string {
  const size = opts.size ?? 220;
  const petals = geometry.petals
    .map(
      (p) =>
        `<path d="${p.path}" fill="${opts.resolveColor(p.category.color)}" stroke="${REPORT_FLOWER_PETAL_STROKE}" stroke-width="1" opacity="0.92">` +
        `<title>${esc(p.category.label)}: ${p.score}</title></path>`,
    )
    .join("");
  const centreText = centre !== null ? String(Math.round(centre)) : "—";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" ` +
    `role="img" aria-label="${esc(title)} flower, centre ${centreText}">` +
    `${petals}` +
    `<circle cx="100" cy="100" r="24" fill="${REPORT_FLOWER_HUB_FILL}" stroke="${REPORT_FLOWER_HUB_STROKE}" stroke-width="1"/>` +
    `<text x="100" y="100" text-anchor="middle" dy="0.35em" font-family="sans-serif" ` +
    `font-size="28" font-weight="700" fill="${REPORT_FLOWER_TEXT}">${esc(centreText)}</text>` +
    `</svg>`
  );
}
