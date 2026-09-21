// atlas-3: roving-tabindex math for a one-dimensional control group (the tool rail on desktop
// (vertical) and the phone bottom bar (horizontal) -- spec.md §5.1 says it is the SAME five
// controls in the SAME order on every viewport, only the orientation differs). Pure and DOM-free
// so the wrap-around rule is unit-tested directly (CLAUDE.md: core logic lives in an exported
// function; a component only calls it).
export type Orientation = "horizontal" | "vertical";

const NEXT_KEY: Record<Orientation, string> = { horizontal: "ArrowRight", vertical: "ArrowDown" };
const PREV_KEY: Record<Orientation, string> = { horizontal: "ArrowLeft", vertical: "ArrowUp" };

/**
 * The next roving-tabindex index for a key press, or `null` if the key does not move focus within
 * this group. Wraps at both ends. Every item stays a valid stop: an inactive control (e.g. the
 * Flower tool in the Species lens) is `aria-disabled`, never removed from the tab sequence
 * (spec.md §5.2), so this never skips an index for being "disabled".
 */
export function nextRovingIndex(
  current: number,
  count: number,
  key: string,
  orientation: Orientation,
): number | null {
  if (count <= 0) return null;
  if (key === NEXT_KEY[orientation]) return (current + 1) % count;
  if (key === PREV_KEY[orientation]) return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
