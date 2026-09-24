// U3 "Send feedback": the hand-rolled screenshot annotator's pure drawing logic -- arrow / circle
// / rectangle / pen / text over the captured screenshot, three colours that read on both a dark
// map and the light theme. Ported from ../../CalCOFI/explore/src/annotate.tsx (React); this file
// holds only the FRAMEWORK-FREE canvas math (CLAUDE.md: "keep core logic in an exported function
// under src/lib/ ... a component calls it") -- FeedbackDialog.svelte owns the pointer-event wiring
// and the `$state` shapes array, and calls `drawShape`/`paintAll` from its own canvas effect.
//
// Hand-rolled, not a library: marker.js is commercial, fabric.js and tldraw ship hundreds of KB for
// far more than five tools need -- and it is a dynamic import() either way
// (tests/feedback/lazy.test.ts), so the size argument is moot; the maintenance one (three colours,
// five tools, undo/clear) is small enough that a dependency would cost more than it saves.
//
// The colour VALUES live in ./colors.ts, not here (tests/raster/ramps.wiring.test.ts's "no hex
// literal outside tokens.css" rule, extended to this directory -- ./colors.ts's own header
// explains the exemption); re-exported here so a caller that only needs drawing logic can still
// import everything from this one module.
export { ANNOTATE_COLORS, DEFAULT_ANNOTATE_COLOR, type AnnotateColorDef } from "./colors";

export type AnnotateTool = "arrow" | "circle" | "rect" | "pen" | "text";

export interface AnnotateShape {
  tool: AnnotateTool;
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** `pen` only: every point visited, in image-pixel coordinates. */
  path?: [number, number][];
  /** `text` only: the committed string. */
  text?: string;
}

export interface AnnotateToolDef {
  id: AnnotateTool;
  label: string;
}

export const ANNOTATE_TOOLS: AnnotateToolDef[] = [
  { id: "arrow", label: "Arrow" },
  { id: "circle", label: "Circle" },
  { id: "rect", label: "Rectangle" },
  { id: "pen", label: "Pen" },
  { id: "text", label: "Text" },
];

export const DEFAULT_ANNOTATE_TOOL: AnnotateTool = "arrow";

/** draws one shape onto `ctx`, at line-width scale `k` (a screenshot captured at 2x
 * devicePixelRatio needs proportionally thicker strokes to read the same as one at 1x -- callers
 * pass `Math.max(1, imageWidth / 1400)`, matching CalCOFI's own annotator). */
export function drawShape(ctx: CanvasRenderingContext2D, s: AnnotateShape, k = 1): void {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = 3 * k;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 2 * k;
  const { x0, y0, x1, y1 } = s;
  if (s.tool === "pen" && s.path) {
    ctx.beginPath();
    s.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  } else if (s.tool === "rect") {
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  } else if (s.tool === "circle") {
    ctx.beginPath();
    ctx.ellipse(
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      Math.max(2, Math.abs(x1 - x0) / 2),
      Math.max(2, Math.abs(y1 - y0) / 2),
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else if (s.tool === "arrow") {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const headLen = 14 * k;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - headLen * Math.cos(angle - 0.45), y1 - headLen * Math.sin(angle - 0.45));
    ctx.lineTo(x1 - headLen * Math.cos(angle + 0.45), y1 - headLen * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
  } else if (s.tool === "text" && s.text) {
    ctx.font = `600 ${16 * k}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    const w = ctx.measureText(s.text).width + 10 * k;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x0 - 5 * k, y0 - 3 * k, w, 22 * k);
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, x0, y0);
  }
  ctx.shadowBlur = 0;
}

/** redraws the base image plus every shape (and one optional in-progress `extra` shape, the one
 * still under the pointer) onto a `w`x`h` canvas -- the annotator's whole repaint, called on every
 * shapes-array change. */
export function paintAll(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  shapes: AnnotateShape[],
  extra: AnnotateShape | null,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  const k = strokeScale(w);
  for (const s of shapes) drawShape(ctx, s, k);
  if (extra) drawShape(ctx, extra, k);
}

/** the stroke-width scale factor for an image of the given pixel width. */
export function strokeScale(imageWidth: number): number {
  return Math.max(1, imageWidth / 1400);
}

/** image-pixel coordinates from a pointer event's client position and the canvas' CSS-scaled
 * bounding box (the canvas element is drawn at image resolution; CSS scales it down to fit the
 * dialog, so a raw clientX/clientY needs rescaling back to image space). */
export function pointerToImageCoords(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } {
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: ((clientX - rect.left) / width) * imageWidth,
    y: ((clientY - rect.top) / height) * imageHeight,
  };
}
