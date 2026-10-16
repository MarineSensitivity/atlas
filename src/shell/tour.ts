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
  /** opens a specific tab of the Table tool (the panel opens on Species; the tour's "Table" step
   * describes the ranked Program Areas, which is the Zones tab). */
  selectTableTab(tab: "species" | "zones" | "composition"): void;
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

// --- Scores (9 steps, docs/usability.md §5 "Take a tour", Scores) --------------------------------
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
    description: "Click a cell or a Program Area for its score and a link to its details.",
  },
  {
    // R4-B: the Flower tab left the Layers pane and became the spine's own "Details" entry.
    id: "details",
    element: '[data-tour="rail-details"]',
    side: "right",
    title: "Details",
    description: "The flower for what you clicked; add it to your report or open its table.",
    before: (a) => a.selectTool("details"),
  },
  {
    id: "table",
    element: '[data-tour="rail-table"]',
    side: "right",
    title: "Table",
    description: "Every Program Area ranked; tick some and report on them.",
    // the Table tool opens on its Species tab; the ranked, tickable Program Areas are the Zones tab
    before: (a) => {
      a.selectTableTab("zones");
      a.selectTool("table");
    },
  },
  {
    // R4-D: the Report tool is one flow with no sub-tabs; this step opens it and points at its
    // "Places" heading (`Places.svelte`'s `[data-tour="places-heading"]`).
    id: "places",
    element: '[data-tour="places-heading"]',
    side: "right",
    title: "Places",
    description: "Draw your own area, enter coordinates or upload a file.",
    before: (a) => a.selectTool("report"),
  },
  {
    // owner review item 3 (live 0.10.62): the desktop topbar's own Report button was dropped
    // (duplicative with this exact rail tool -- TopBarActions.svelte/Shell.svelte's own header),
    // so this step now anchors the rail's Report tool instead of `[data-tour="report-top"]`, which
    // no longer exists -- same `before`/`side` convention as its "table"/"places" siblings above.
    // "Share" (still a topbar button) keeps no tour step of its own, same as before this fix.
    id: "report",
    element: '[data-tour="rail-report"]',
    side: "right",
    title: "Report",
    description: "Build a printable, downloadable report for what you selected.",
    before: (a) => a.selectTool("report"),
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
    side: "right", // R4-B: the panel docks left by default
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

/**
 * Resolve once a step's anchor exists, after at least `settleMs`: a fixed 250 ms beat is enough for
 * a rail tool that is already loaded, but not for one whose pane is a lazy chunk (the Report pane
 * behind the "Places" step): driver.js resolves a step's element synchronously when it advances, and
 * an anchor that has not mounted yet gives a popover floating with NO highlight. Polls every
 * `pollMs` up to `maxMs`, then resolves anyway (a missing anchor must not freeze the tour; the
 * e2e walk and tour-guide script assert the anchor separately). Pure: `exists` and `sleep` are
 * injected, so it is testable without a DOM or timers.
 */
export async function waitForAnchor(
  exists: () => boolean,
  opts: {
    settleMs?: number;
    pollMs?: number;
    maxMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const { settleMs = 0, pollMs = 50, maxMs = 4000 } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waited = 0;
  if (settleMs > 0) {
    await sleep(settleMs);
    waited += settleMs;
  }
  while (!exists()) {
    if (waited >= maxMs) return false;
    await sleep(pollMs);
    waited += pollMs;
  }
  return true;
}

export function tourStepsForLens(lens: Lens): TourStep[] {
  return lens === "species" ? SPECIES_TOUR_STEPS : SCORES_TOUR_STEPS;
}
