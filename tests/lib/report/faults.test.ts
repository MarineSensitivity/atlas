// The seeded faults, proven RED against the same R fixtures the real implementation is held to.
//
// Each case does two things: it shows the real rule agreeing with R, and it shows the deliberately
// wrong one DISAGREEING by more than the gate's own tolerance. The second half is what makes the
// corresponding assertion in `numbers.test.ts` a check rather than a tautology -- and it is
// permanent, so a future "simplification" that reintroduces one of these six mistakes goes red here
// with the fault's own name on it (CLAUDE.md: "a check that cannot fail is not a check").
import { describe, expect, it } from "vitest";
import { buildReport, type ReportPlaceInput } from "../../../src/lib/report/model";
import { erConsolidate, speciesCounts } from "../../../src/lib/report/er";
import { overallScore, scoresTable } from "../../../src/lib/report/scores";
import { rampDomain } from "../../../src/lib/report/ramp";
import { topSpecies } from "../../../src/lib/report/species";
import {
  bypassD7bClip,
  countsWithFaultyEr,
  erConsolidateFaulty,
  footnotesFaulty,
  overallScoreFaulty,
  rampDomainFaulty,
  topSpeciesFaulty,
} from "./faults";
import { bootFor, everyFixture, loadFixture, speciesRows } from "./fixtures";
import type { Place } from "../../../src/lib/geo/placeCodec";

const TOL = 1e-9;
const NOW = new Date("2026-09-22T18:04:05Z");

describe("fault 1 -- er_consolidate maps one code wrong (IUCN:VU -> IUCN:NT(2))", () => {
  it("the real rule answers IUCN:VU(5); the fault answers IUCN:NT(2)", () => {
    expect(erConsolidate("IUCN:VU")).toBe("IUCN:VU(5)");
    expect(erConsolidateFaulty("IUCN:VU")).toBe("IUCN:NT(2)");
  });

  // v9's Aleutian box has no IUCN:VU species at all, so it cannot see this fault -- which is the
  // point of naming the cells: the gate is exercised by the five fixtures that CAN see it, and the
  // sixth is listed as skipped rather than silently passing on an empty column.
  const withVu = everyFixture().filter((f) =>
    speciesCounts(speciesRows(f.fx)).columns.includes("IUCN:VU(5)"),
  );

  it("at least one fixture carries an IUCN:VU species (the gate is not vacuous)", () => {
    expect(withVu.length).toBeGreaterThan(0);
  });

  it.each(withVu)(
    "$ver/$place: the counts table goes RED -- the VU and NT column totals both move",
    ({ fx }) => {
      const rows = speciesRows(fx);
      const real = speciesCounts(rows);
      const faulty = countsWithFaultyEr(rows);
      const iReal = real.columns.indexOf("IUCN:VU(5)");
      // the fault empties the VU column entirely and inflates NT by exactly that many
      expect(faulty.columns).not.toContain("IUCN:VU(5)");
      const vuTotal = real.totalRow.counts[iReal];
      const ntReal = real.totalRow.counts[real.columns.indexOf("IUCN:NT(2)")];
      const ntFaulty = faulty.totals[faulty.columns.indexOf("IUCN:NT(2)")];
      expect(vuTotal).toBeGreaterThan(0);
      expect(ntFaulty).toBe(ntReal + vuTotal);
    },
  );
});

describe("fault 2 -- the ramp is not widened when every place agrees", () => {
  it("one place: the real domain is ±0.5 wide, the fault's is zero-width", () => {
    expect(rampDomain([42.3])).toEqual([41.8, 42.8]);
    expect(rampDomainFaulty([42.3])).toEqual([42.3, 42.3]);
  });

  it("two places that round to the same tenth: still widened, still zero-width under the fault", () => {
    expect(rampDomain([12.5, 12.5])).toEqual([12, 13]);
    expect(rampDomainFaulty([12.5, 12.5])).toEqual([12.5, 12.5]);
  });

  it.each(everyFixture())("$ver/$place: the single-place report's ramp goes RED", ({ fx }) => {
    const s = Math.round(fx.expected.composite * 10) / 10;
    const real = rampDomain([s]) as [number, number];
    const faulty = rampDomainFaulty([s]) as [number, number];
    expect(real[1] - real[0]).toBe(1);
    expect(faulty[1] - faulty[0]).toBe(0);
  });

  it("a real spread is left alone by BOTH -- the widening only fires on equality", () => {
    expect(rampDomain([10, 40])).toEqual([10, 40]);
    expect(rampDomainFaulty([10, 40])).toEqual([10, 40]);
  });
});

describe("fault 3 -- Overall as a weighted mean (by coverage) instead of a plain one", () => {
  it.each(everyFixture())(
    "$ver/$place: the plain mean matches R; the weighted one does not",
    ({ fx }) => {
      const comps = fx.input.components;
      const real = overallScore(comps) as number;
      const faulty = overallScoreFaulty(comps) as number;
      expect(Math.abs(real - fx.expected.composite)).toBeLessThan(TOL);
      expect(Math.abs(faulty - fx.expected.composite)).toBeGreaterThan(TOL);
    },
  );
});

describe("fault 4 -- the top 20 sorted by the wrong column (avg_suit, not suit_er_area)", () => {
  it.each(everyFixture())("$ver/$place: the real order is R's; the fault's is not", ({ fx }) => {
    const rows = speciesRows(fx);
    const real = topSpecies(rows).map((r) => r.mdl_key);
    const faulty = topSpeciesFaulty(rows);
    expect(real).toEqual(fx.expected.top20.map((r) => r.mdl_key));
    expect(faulty).not.toEqual(fx.expected.top20.map((r) => r.mdl_key));
  });
});

describe("fault 5 -- a coverage footnote is suppressed (threshold 90 % instead of 100 %)", () => {
  it.each(everyFixture())(
    "$ver/$place: every partial component footnotes; the fault emits none",
    ({ fx }) => {
      const place = {
        name: fx.name,
        areaKm2: fx.input.area_km2,
        nCells: fx.input.n_cells,
        components: fx.input.components,
        overall: overallScore(fx.input.components),
      };
      const partial = fx.input.components.filter(
        (c) => c.coverage !== null && c.coverage < 1 - 1e-9,
      );
      expect(partial.length, "every fixture has at least one partial component").toBeGreaterThan(0);
      expect(scoresTable([place]).footnotes.length).toBe(partial.length);
      // the fault's threshold is above every coverage in these fixtures, so it prints nothing --
      // the table then implies each score holds over the whole place, which is the D7b claim the
      // footnote exists to refuse.
      expect(footnotesFaulty([place]).length).toBeLessThan(partial.length);
    },
  );

  it("the suppressed footnote is exactly the sentence a reader loses", () => {
    const place = {
      name: "GEO",
      areaKm2: 1000,
      nCells: 10,
      components: [
        {
          metric_key: "extrisk_turtle_ecoregion_rescaled",
          component: "turtle",
          score: 0.7,
          even: 1,
          coverage: 0.0141,
          mean_where_present: 49.6,
        },
      ],
      overall: 0.7,
    };
    expect(scoresTable([place]).footnotes[0].text).toBe(
      "GEO, turtle: scored over 1.4% of the place, where its mean is 50.",
    );
  });
});

describe("fault 6 -- the D7b clip bypassed for a custom place", () => {
  const fx = loadFixture("v9", "gulf_rectangle");
  const place: Place = {
    kind: "geom",
    name: fx.name,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-93.5, 26.5],
          [-88.5, 26.5],
          [-88.5, 29.5],
          [-93.5, 29.5],
          [-93.5, 26.5],
        ],
      ],
    },
  };

  function build(scores: ReportPlaceInput["scores"]) {
    return buildReport({
      ver: "v9",
      boot: bootFor(fx),
      places: [{ place, token: "t", name: fx.name, scores }],
      tables: ["cell"],
      now: NOW,
      appSha: "sha",
    });
  }

  it("the clipped set gives R's N cells and R's share inside the study area", () => {
    const m = build({
      components: fx.input.components,
      nCells: fx.input.n_cells,
      areaKm2: fx.input.area_km2,
      nCellsTouched: fx.input.n_cells_touched ?? null,
    });
    expect(m.parameters[0].nCells).toBe(fx.input.n_cells);
    expect(
      Math.abs((m.parameters[0].studyAreaPct as number) - fx.input.study_area_pct),
    ).toBeLessThan(TOL);
  });

  it("bypassing it goes RED: N cells becomes the touched count and the share claims 100 %", () => {
    const bypassed = bypassD7bClip({
      nCells: fx.input.n_cells,
      nCellsTouched: fx.input.n_cells_touched ?? null,
      areaKm2: fx.input.area_km2,
    });
    const m = build({
      components: fx.input.components,
      nCells: bypassed.nCells,
      areaKm2: fx.input.area_km2,
      nCellsTouched: bypassed.nCellsTouched,
    });
    expect(m.parameters[0].nCells).not.toBe(fx.input.n_cells);
    expect(m.parameters[0].nCells).toBe(fx.input.n_cells_touched);
    expect(m.parameters[0].studyAreaPct).toBe(100);
    // and 100 % is a FALSE claim: 219 of the 6,000 touched cells are outside the study area
    expect(fx.input.study_area_pct).toBeLessThan(100);
  });
});
