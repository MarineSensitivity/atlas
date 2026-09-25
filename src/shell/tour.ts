// U6 (round 2): the guided tour's STEP DATA -- pure, driver.js-free, so it is testable under plain
// Node (CLAUDE.md's testing pyramid) without pulling the ~450 KB-budget-relevant driver.js chunk
// into this module's import graph. The RUNTIME (driver.js itself, the popover wiring) lives in
// `tourRuntime.ts`, which Shell.svelte reaches ONLY through a dynamic `import()` -- see that file's
// header. Anchors are the `data-tour="…"` attributes already stamped on the shell's controls
// (docs/usability.md "Take a tour", CalCOFI explore's `src/tour.ts` pattern) plus the two new ones
// this round adds: `rail-<tool>` (HexButton.svelte's `tourId` prop, via Rail.svelte) for a specific
// rail tool, and the species/scores legends' own `data-testid` (already unique, so no new attribute
// needed there).
import type { Lens } from "../lib/state/types";
import type { ToolName } from "./tools";

export interface TourActions {
  getLens(): Lens;
  /** switches the lens (Shell.svelte's own `onLensChange`, reused verbatim). */
  setLens(lens: Lens): void;
  /** opens a rail tool's panel (Shell.svelte's own `selectTool`, reused verbatim). */
  selectTool(name: ToolName): void;
  /** R3-W8 item 5: switches the Report pane's own tab ("places" | "report", Shell.svelte's
   * `activeReportTab`) -- a no-op on any other tool's own panel. */
  selectReportTab(tab: "places" | "report"): void;
  /** captures the CURRENT lens/tool before the tour starts, so `restore()` can put them back --
   * the tour must leave the view exactly as it found it (CalCOFI's `src/tour.ts` pattern). */
  snapshot(): void;
  restore(): void;
}

export interface TourStep {
  /** stable, used by analytics (`tour_step`) and by the e2e gate that asserts every anchor
   * actually exists on the lens it belongs to. */
  id: string;
  /** a CSS selector into the live DOM -- driver.js resolves it itself, once `before()` (below) has
   * had a chance to make the target exist/visible. */
  element: string;
  title: string;
  description: string;
  side?: "left" | "right" | "top" | "bottom";
  align?: "start" | "center" | "end";
  /** puts the app into the state this step needs (a lens switch, a rail tool opened) BEFORE
   * driver.js tries to find/highlight `element` -- tourRuntime.ts's `onNextClick`/`onPrevClick`
   * run this and wait a beat for Svelte to render, exactly as CalCOFI's tour does. */
  before?: (a: TourActions) => void;
}

// --- Scores (8 steps, docs/usability.md §5 "Take a tour", Scores) --------------------------------
export const SCORES_TOUR_STEPS: TourStep[] = [
  {
    id: "map",
    element: '[data-tour="map"]',
    side: "left",
    align: "start",
    title: "The map",
    description:
      "Colour is the combined sensitivity score for each 0.05° cell of US waters (red high, blue low).",
    // guarded (a tour started while ALREADY on the scores lens is the common case): calling
    // setLens() unconditionally re-set `sel.out` to its lens default even when the lens itself
    // was unchanged, which reset in-flight lens state for no reason -- measured on the species
    // side (see the species step below) as a legend that never resolved because its OWN
    // redundant setLens() call kept restarting the species data load underneath the walk.
    before: (a) => {
      if (a.getLens() !== "scores") a.setLens("scores");
    },
  },
  {
    id: "release",
    element: '[data-tour="version-chip"]',
    side: "bottom",
    align: "start",
    title: "The release",
    description: "You are looking at this release; every published release is here.",
  },
  {
    id: "lenses",
    element: '[data-tour="lens-switch"]',
    side: "bottom",
    title: "The lenses",
    description: "Scores ranks places; Species shows one species' distribution.",
  },
  {
    id: "layers",
    element: '[data-tour="rail-layers"]',
    side: "right",
    title: "Layers",
    description: "Choose the score layer, Program Areas or cells, and the colour ramp.",
    before: (a) => a.selectTool("layers"),
  },
  {
    id: "click",
    element: '[data-tour="map"]',
    side: "left",
    align: "start",
    title: "Click",
    description: "Click a cell or a Program Area for its score and its flower.",
  },
  {
    id: "table",
    element: '[data-tour="rail-table"]',
    side: "right",
    title: "Table",
    description: "Every Program Area ranked; tick some and report on them.",
    before: (a) => a.selectTool("table"),
  },
  {
    // R3-W8 item 5: "Places folds into the Report tool as its first tab" -- the rail no longer has
    // a "places" button (`[data-tour="rail-places"]` is gone with it); this step now opens the
    // Report tool and points at the pane's own tab switch (Shell.svelte's
    // `[data-tour="report-tabs"]`), landing on "Places" (the default tab).
    id: "places",
    element: '[data-tour="report-tabs"]',
    side: "right",
    title: "Places",
    description: "Draw your own area, enter coordinates or upload a file.",
    before: (a) => {
      a.selectTool("report");
      a.selectReportTab("places");
    },
  },
  {
    // owner review item 3 (live 0.10.62): the desktop topbar's own Report button was dropped
    // (duplicative with this exact rail tool -- TopBarActions.svelte/Shell.svelte's own header),
    // so this step now anchors the rail's Report tool instead of `[data-tour="report-top"]`, which
    // no longer exists -- same `before`/`side` convention as its "table"/"places" siblings above.
    // "Share" (still a topbar button) keeps no tour step of its own, same as before this fix.
    // R3-W8 item 5: also switches to the "Report" tab (the sibling "places" step above leaves the
    // pane on its default "places" tab) so this step's own anchor/description matches what's on
    // screen.
    id: "report",
    element: '[data-tour="rail-report"]',
    side: "right",
    title: "Report",
    description: "Build a printable, downloadable report for what you selected.",
    before: (a) => {
      a.selectTool("report");
      a.selectReportTab("report");
    },
  },
];

// --- Species (5 steps, docs/usability.md §5 "Take a tour", Species) -------------------------------
export const SPECIES_TOUR_STEPS: TourStep[] = [
  {
    id: "search",
    element: '[data-tour="search"]',
    side: "bottom",
    title: "Search",
    description: "Find a species by common or scientific name.",
    // guarded, same reason the scores "map" step's identical guard has: an UNCONDITIONAL
    // setLens("species") here, even when a `?sp=` deep link already put the shell on the species
    // lens, reset `sel.out` and restarted the reactive chain the species lens' own data load
    // depends on -- measured directly: the "legend" step's anchor (a REAL resolved species query)
    // never appeared, reproducibly, until this guard was added.
    before: (a) => {
      if (a.getLens() !== "species") a.setLens("species");
    },
  },
  {
    id: "card",
    element: '[data-tour="panel"]',
    side: "left",
    align: "start",
    title: "The card",
    description: "The merged model and the inputs it combines.",
    before: (a) => a.selectTool("layers"),
  },
  {
    id: "map",
    element: '[data-tour="map"]',
    side: "left",
    align: "start",
    title: "The map",
    description: "Click anywhere for the modelled value.",
  },
  {
    id: "legend",
    element: '[data-testid="species-legend"]',
    side: "top",
    title: "The legend",
    description: "What 1–100 means.",
  },
  {
    id: "back",
    element: '[data-tour="lens-switch"]',
    side: "bottom",
    title: "Back",
    description: "Switch to Scores to see how this species contributes.",
  },
];

export function tourStepsForLens(lens: Lens): TourStep[] {
  return lens === "species" ? SPECIES_TOUR_STEPS : SCORES_TOUR_STEPS;
}
