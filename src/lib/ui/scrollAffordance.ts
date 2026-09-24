// lib/ui/scrollAffordance.ts -- the report's species counts table (report/Report.svelte) hid its
// extinction-risk columns inside a horizontally-scrolling `.table-scroll` box with NO on-screen
// cue that more existed (Opus eyes-on, 2026-09-24: phone-15's cut fell exactly on a column edge,
// so "Total 25 / 11" under an 8-column header read as a COMPLETE table, not a truncated one;
// desktop-14 at least showed a cut header). The overflow test itself is pure and DOM-free (CLAUDE.md:
// core logic lives in an exported function, a component only calls it); `scrollAffordance` is the
// thin Svelte action that measures a real element and calls it.

/** true when a scroll container's content is wider than its own visible box -- the exact
 * condition a `.table-scroll` needs a fade/hint for. The 1px tolerance absorbs sub-pixel layout
 * rounding that would otherwise flip this on/off at an exact-fit width. */
export function isOverflowingX(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth + 1;
}

export interface ScrollAffordanceOptions {
  /** called once on mount and again whenever the measured overflow state changes. */
  onOverflow: (overflows: boolean) => void;
}

/**
 * Svelte action: watches a scroll container's own box for horizontal overflow and reports it via
 * `onOverflow`, so a caller can show a fade/hint ONLY when there is genuinely more to scroll to --
 * never a false affordance on a table that already fits (report.css's `data-scrollable` selectors
 * read the attribute this drives). A single `ResizeObserver` on the container covers both a
 * viewport resize (its `clientWidth` changing) and the table's own content growing/shrinking (its
 * `scrollWidth` changing) -- they are the same two numbers read on every resize entry.
 */
export function scrollAffordance(node: HTMLElement, opts: ScrollAffordanceOptions) {
  let last: boolean | null = null;
  const check = () => {
    const now = isOverflowingX(node.scrollWidth, node.clientWidth);
    if (now !== last) {
      last = now;
      opts.onOverflow(now);
    }
  };
  check();
  if (typeof ResizeObserver === "undefined") {
    // no DOM measurement environment (vitest runs `environment: "node"`, no jsdom) -- real
    // browsers and Playwright both have ResizeObserver, which is where this action is exercised.
    return { destroy() {} };
  }
  const ro = new ResizeObserver(check);
  ro.observe(node);
  return {
    destroy() {
      ro.disconnect();
    },
  };
}
