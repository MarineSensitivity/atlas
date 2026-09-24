// THE ONLY place src/lib/feedback writes a colour literal.
//
// These are canvas colours, not a ramp and not brand chrome: the annotator draws directly onto a
// `<canvas>` 2D context (arrow/circle/rect/pen/text), which does not participate in the CSS
// cascade -- `ctx.strokeStyle` needs an actual resolved colour string, never a `var(--x)`
// reference. Same exception, same reasoning, as src/lib/map/colors.ts and src/report/colors.ts
// (both already named in tests/raster/ramps.wiring.test.ts's own exemption list) -- collected in
// ONE file so the "no hex literal outside tokens.css" rule stays mechanically checkable everywhere
// else under src/lib/feedback/, including FeedbackDialog.svelte's own <style> block.
//
// `tests/raster/ramps.wiring.test.ts` names this file (FEEDBACK_COLORS_FILE) as its third such
// exception; put a new feedback-module colour here or nowhere.

export interface AnnotateColorDef {
  id: string;
  hex: string;
  label: string;
}

// three colours that read on both a dark map and the light theme's paper background -- the same
// trio ../../CalCOFI/explore/src/annotate.tsx uses (a warm yellow, an accent blue, a hot pink no
// viridis dot wears). Deliberately theme-INVARIANT (unlike tokens.css's palette): a mark drawn in
// review needs to stay legible regardless of which theme the reviewer is in when they look at the
// screenshot later.
export const ANNOTATE_COLORS: AnnotateColorDef[] = [
  { id: "yellow", hex: "#ffd60a", label: "Yellow" },
  { id: "blue", hex: "#4dabf7", label: "Blue" },
  { id: "pink", hex: "#ff2d95", label: "Pink" },
];

export const DEFAULT_ANNOTATE_COLOR: string = ANNOTATE_COLORS[0].hex;

// capture.ts's html-to-image `backgroundColor` option needs a literal fallback for the (expected
// to be rare) case `--surface-map` cannot be read (no DOM, tokens.css not yet loaded) -- toCanvas
// takes a plain string, never a `var()` reference.
export const CAPTURE_BG_FALLBACK = "#ffffff";
