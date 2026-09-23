// U6 (round 2): the tour's step DATA -- driver.js-free (tourRuntime.ts owns the runtime), so this
// runs under plain Node. One assertion per rule: step counts/order match docs/usability.md §5,
// every step has a real anchor selector + non-empty copy, and each `before()` hook calls exactly
// the TourActions it should.
import { describe, expect, it } from "vitest";
import {
  SCORES_TOUR_STEPS,
  SPECIES_TOUR_STEPS,
  tourStepsForLens,
  type TourActions,
} from "../../src/shell/tour";

function fakeActions(): TourActions & {
  calls: { setLens: string[]; selectTool: string[]; snapshot: number; restore: number };
} {
  const calls = { setLens: [] as string[], selectTool: [] as string[], snapshot: 0, restore: 0 };
  return {
    calls,
    getLens: () => "scores",
    setLens: (l) => calls.setLens.push(l),
    selectTool: (t) => calls.selectTool.push(t),
    snapshot: () => calls.snapshot++,
    restore: () => calls.restore++,
  };
}

describe("SCORES_TOUR_STEPS: 8 steps, docs/usability.md §5", () => {
  it("has exactly 8 steps, unique ids, in the documented order", () => {
    expect(SCORES_TOUR_STEPS).toHaveLength(8);
    expect(SCORES_TOUR_STEPS.map((s) => s.id)).toEqual([
      "map",
      "release",
      "lenses",
      "layers",
      "click",
      "table",
      "places",
      "report",
    ]);
    expect(new Set(SCORES_TOUR_STEPS.map((s) => s.id)).size).toBe(8);
  });

  it("every step has a non-empty selector, title and description (≤ 2 sentences)", () => {
    for (const step of SCORES_TOUR_STEPS) {
      expect(step.element.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
      const sentences = step.description.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, `${step.id}: "${step.description}"`).toBeLessThanOrEqual(2);
    }
  });

  it("the map/release/lenses/click/report steps have no before() -- their anchor is always mounted", () => {
    for (const id of ["release", "lenses", "click", "report"]) {
      expect(SCORES_TOUR_STEPS.find((s) => s.id === id)?.before).toBeUndefined();
    }
  });

  it("the layers/table/places steps each open exactly their own rail tool via selectTool()", () => {
    for (const [id, tool] of [
      ["layers", "layers"],
      ["table", "table"],
      ["places", "places"],
    ] as const) {
      const a = fakeActions();
      SCORES_TOUR_STEPS.find((s) => s.id === id)?.before?.(a);
      expect(a.calls.selectTool).toEqual([tool]);
      expect(a.calls.setLens).toEqual([]);
    }
  });

  it("the map step switches to the scores lens (a tour started from Species must land here)", () => {
    const a = fakeActions();
    SCORES_TOUR_STEPS[0]?.before?.(a);
    expect(a.calls.setLens).toEqual(["scores"]);
  });
});

describe("SPECIES_TOUR_STEPS: 5 steps, docs/usability.md §5", () => {
  it("has exactly 5 steps, unique ids, in the documented order", () => {
    expect(SPECIES_TOUR_STEPS).toHaveLength(5);
    expect(SPECIES_TOUR_STEPS.map((s) => s.id)).toEqual(["search", "card", "map", "legend", "back"]);
    expect(new Set(SPECIES_TOUR_STEPS.map((s) => s.id)).size).toBe(5);
  });

  it("every step has a non-empty selector, title and description", () => {
    for (const step of SPECIES_TOUR_STEPS) {
      expect(step.element.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
    }
  });

  it("the search step switches to the species lens", () => {
    const a = fakeActions();
    SPECIES_TOUR_STEPS[0]?.before?.(a);
    expect(a.calls.setLens).toEqual(["species"]);
  });

  it("the card step opens the layers tool (species' own card lives there)", () => {
    const a = fakeActions();
    SPECIES_TOUR_STEPS.find((s) => s.id === "card")?.before?.(a);
    expect(a.calls.selectTool).toEqual(["layers"]);
  });
});

describe("tourStepsForLens", () => {
  it("returns the species list for 'species' and the scores list otherwise", () => {
    expect(tourStepsForLens("species")).toBe(SPECIES_TOUR_STEPS);
    expect(tourStepsForLens("scores")).toBe(SCORES_TOUR_STEPS);
  });
});

// the seeded-fault property this file (plus tourRuntime.ts's own wiring) exists to guard: every
// anchor selector this module ships is a real, distinguishable `data-tour`/`data-testid` value --
// never a bare tag/class an ordinary layout change could silently repoint at the wrong element.
describe("anchors are attribute selectors, not bare tags or classes", () => {
  it("every element selector targets a data-tour or data-testid attribute", () => {
    for (const step of [...SCORES_TOUR_STEPS, ...SPECIES_TOUR_STEPS]) {
      expect(step.element, step.id).toMatch(/\[data-(tour|testid)="[a-z0-9-]+"\]/);
    }
  });
});
