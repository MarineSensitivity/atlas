// U6 (round 2): the guided tour's RUNTIME. driver.js is a LAZY dependency (package.json's
// pinReasons, `scripts/size-budget-core.mjs`'s `FORBIDDEN_LAZY_MARKERS` now lists "driver") --
// Shell.svelte reaches this module ONLY through a dynamic `import()` (see its "lazy lens/panel
// chunks" section), never a static one, so the ~450 KB static critical-path budget (CLAUDE.md)
// never pays for it. `tour.ts` (the step DATA) stays driver.js-free on purpose, so it can be
// imported and asserted against under plain Node; this file is the one place driver.js itself is
// ever imported.
//
// Pattern ported from CalCOFI explore's `src/tour.ts` (round-2 plan §10): a step's `before()` hook
// puts the app in the state the NEXT step needs (a lens switch, a rail tool opened) before
// driver.js tries to find/highlight its anchor, so `onNextClick`/`onPrevClick` are overridden to
// run `before()` and wait a beat for Svelte to render before actually advancing -- driver.js's own
// per-step `element` resolution runs synchronously against whatever is in the DOM right now, and a
// tool panel opened this tick is not painted yet. `snapshot()`/`restore()` (Shell.svelte's own
// `TourActions` implementation) leave the view exactly as the tour found it on Esc/Done/overlay
// click (`onDestroyed`).
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { TourActions, TourStep } from "./tour";

/** ms to wait after a `before()` hook runs, for Svelte's reactive DOM update to land before
 * driver.js resolves the next step's `element` selector -- the same number CalCOFI's tour uses. */
const BEFORE_SETTLE_MS = 250;

export interface TourCallbacks {
  /** fired as each step becomes the active one (driver.js's own `onHighlightStarted`, which runs
   * AFTER the element is already resolved -- safe for tracking, unlike `before()`). */
  onStep?: (step: TourStep, index: number) => void;
  /** fired once, however the tour ends (Esc, the overlay, Done on the last step). `completed` is
   * true only when it ended by reaching past the last step. */
  onEnd?: (completed: boolean) => void;
}

/** starts the tour over `steps`, driving `actions` for each step's `before()` hook. Returns the
 * live `Driver` (also stashed on `window.__tourDriver` by the caller, the same automation seam
 * CalCOFI's `verify.mjs` uses) so a caller/e2e test can step it directly if it ever needs to. */
export function startTour(
  steps: TourStep[],
  actions: TourActions,
  callbacks: TourCallbacks = {},
): Driver {
  actions.snapshot();

  const d: Driver = driver({
    showProgress: true,
    allowClose: true,
    stagePadding: 6,
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    progressText: "{{current}} of {{total}}",
    steps: steps.map((s) => ({
      element: s.element,
      popover: { title: s.title, description: s.description, side: s.side, align: s.align },
    })),
    onHighlightStarted: (_el, _step, opts) => {
      const i = opts.driver.getActiveIndex() ?? 0;
      const step = steps[i];
      if (step) callbacks.onStep?.(step, i);
    },
    onNextClick: (_el, _step, opts) => {
      const i = opts.driver.getActiveIndex() ?? 0;
      const next = steps[i + 1];
      if (!next) {
        opts.driver.destroy();
        return;
      }
      next.before?.(actions);
      setTimeout(() => opts.driver.moveNext(), next.before ? BEFORE_SETTLE_MS : 0);
    },
    onPrevClick: (_el, _step, opts) => {
      const i = opts.driver.getActiveIndex() ?? 0;
      const prev = steps[i - 1];
      if (!prev) return;
      prev.before?.(actions);
      setTimeout(() => opts.driver.movePrevious(), prev.before ? BEFORE_SETTLE_MS : 0);
    },
    onDestroyed: (_el, _step, opts) => {
      const i = opts.driver.getActiveIndex() ?? 0;
      const completed = i >= steps.length - 1;
      actions.restore();
      callbacks.onEnd?.(completed);
    },
  });

  const first = steps[0];
  first?.before?.(actions);
  setTimeout(() => d.drive(), first?.before ? BEFORE_SETTLE_MS : 0);
  return d;
}
