// Rule-level tests for the Table of Scores: the plain mean, the union of component columns, and
// D7b's coverage footnotes. The R-fixture gate lives in `numbers.test.ts`; this file pins the
// branches a real release happens not to exercise (a component absent from one place, a `null`
// coverage, an empty report).
import { describe, expect, it } from "vitest";
import {
  componentColumns,
  overallScore,
  scoresTable,
  type ReportComponent,
} from "../../../src/lib/report/scores";

const comp = (
  component: string,
  score: number,
  coverage: number | null = 1,
  mean: number | null = score,
): ReportComponent => ({
  metric_key: `extrisk_${component}_ecoregion_rescaled`,
  component,
  score,
  even: 1,
  coverage,
  mean_where_present: mean,
});

describe("overallScore -- msens::mean_score(), the PLAIN mean of the components present", () => {
  it("is the unweighted mean, whatever the coverages are", () => {
    expect(overallScore([comp("bird", 10, 0.1), comp("fish", 20, 1)])).toBe(15);
  });

  it("a component with no row is absent from the mean, never a zero in it", () => {
    // three components in the release, two scored: 30, not 20.
    expect(overallScore([comp("bird", 20), comp("fish", 40)])).toBe(30);
  });

  it("no component at all is null (R's NaN), not 0", () => {
    expect(overallScore([])).toBeNull();
  });

  it("a non-finite score is skipped rather than poisoning the mean", () => {
    expect(overallScore([comp("bird", Number.NaN), comp("fish", 40)])).toBe(40);
  });
});

describe("componentColumns", () => {
  it("is the union over the report's places, in first-seen order", () => {
    expect(
      componentColumns([
        { components: [comp("bird", 1), comp("fish", 2)] },
        { components: [comp("fish", 3), comp("turtle", 4)] },
      ]),
    ).toEqual(["bird", "fish", "turtle"]);
  });
});

describe("scoresTable", () => {
  const place = (name: string, components: ReportComponent[]) => ({
    name,
    areaKm2: 100,
    nCells: 10,
    components,
    overall: overallScore(components),
  });

  it("keeps the places in the order given -- no sorting, no row limit (report.qmd:326-349)", () => {
    const t = scoresTable([place("Zed", [comp("bird", 1)]), place("Alpha", [comp("bird", 2)])]);
    expect(t.rows.map((r) => r.name)).toEqual(["Zed", "Alpha"]);
  });

  it("a place missing a component gets a blank cell, and its own Overall never saw it", () => {
    const t = scoresTable([
      place("A", [comp("bird", 10), comp("fish", 30)]),
      place("B", [comp("bird", 50)]),
    ]);
    expect(t.components).toEqual(["bird", "fish"]);
    expect(t.rows[1].cells.map((c) => c.score)).toEqual([50, null]);
    expect(t.rows[1].overall).toBe(50);
  });

  it("footnotes every component below 100 % coverage, with its coverage and mean-where-present", () => {
    const t = scoresTable([place("GEO", [comp("turtle", 0.7, 0.0141, 49.6), comp("bird", 40)])]);
    expect(t.footnotes).toHaveLength(1);
    expect(t.footnotes[0]).toMatchObject({
      id: 1,
      place: "GEO",
      component: "turtle",
      coverage: 0.0141,
      meanWherePresent: 49.6,
    });
    expect(t.rows[0].cells[0].footnotes).toEqual([1]);
    expect(t.rows[0].cells[1].footnotes).toEqual([]);
  });

  it("a coverage of exactly 1 does NOT footnote", () => {
    expect(scoresTable([place("A", [comp("bird", 40, 1)])]).footnotes).toEqual([]);
  });

  it("99.87 % DOES footnote -- the epsilon is float slack, not a 'nearly complete' tolerance", () => {
    expect(scoresTable([place("A", [comp("bird", 40, 0.9987)])]).footnotes).toHaveLength(1);
  });

  it("a NULL coverage does NOT footnote: 'we cannot say' is not 'it is complete'", () => {
    expect(scoresTable([place("A", [comp("bird", 40, null, null)])]).footnotes).toEqual([]);
  });

  // fix round 2, item 4: the footnote text is a claim ("scored over X% of the place") -- a coverage
  // of 0.998740 rounds UP to "99.9%" (Math.round), which the place's actual 99.874% does not
  // exceed. The footnote must FLOOR instead, so "over 99.8%" is always true.
  it("never overstates the footnote's 'over X%' claim (0.998740 floors to 99.8%, not round()'s 99.9%)", () => {
    const t = scoresTable([place("A", [comp("bird", 40, 0.99874, 40.05)])]);
    expect(t.footnotes[0].text).toContain("over 99.8% of the place");
    expect(t.footnotes[0].text).not.toContain("99.9%");
  });

  it("footnote ids are assigned row-major, in reference order", () => {
    const t = scoresTable([
      place("A", [comp("bird", 1, 0.5), comp("fish", 2, 0.5)]),
      place("B", [comp("bird", 3, 0.5)]),
    ]);
    expect(t.footnotes.map((f) => [f.id, f.place, f.component])).toEqual([
      [1, "A", "bird"],
      [2, "A", "fish"],
      [3, "B", "bird"],
    ]);
  });

  it("the table's text equivalent names every place and its Overall", () => {
    const t = scoresTable([place("A", [comp("bird", 41)]), place("B", [comp("bird", 12)])]);
    expect(t.summary).toBe("Table of scores, 2 places, overall score: A 41; B 12.");
  });

  it("an empty report is an empty table, not a throw", () => {
    const t = scoresTable([]);
    expect(t.rows).toEqual([]);
    expect(t.summary).toBe("Table of scores: no places.");
  });
});
