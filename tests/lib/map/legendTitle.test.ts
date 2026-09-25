// Ben's ask (round-3 review, folded in as UI-L2): the Legend should name which layer is displayed.
import { describe, expect, it } from "vitest";
import { legendChipTitle, legendTitle } from "../../../src/lib/map/legendTitle";

describe("legendTitle: scores, raster cells", () => {
  it("'Overall score' title, 'Raster cells · {zoom region} · {release}' subtitle", () => {
    expect(
      legendTitle({
        lens: "scores",
        branch: "raster",
        metricLabel: "Overall score",
        zoomRegionLabel: "All US waters",
        release: "v7",
      }),
    ).toEqual({ title: "Overall score", subtitle: "Raster cells · All US waters · v7" });
  });

  it("a rescaled component names the category, not the bare 'Raster cells' unit", () => {
    const t = legendTitle({
      lens: "scores",
      branch: "raster",
      metricLabel: "Bird: extinction risk",
      rescaledByEcoregion: true,
      release: "v7",
    });
    expect(t.title).toBe("Bird: extinction risk");
    expect(t.subtitle).toBe("Rescaled 0-100 by ecoregion · v7");
  });

  it("missing zoomRegionLabel/release: the subtitle just drops those clauses, never a blank one", () => {
    expect(legendTitle({ lens: "scores", branch: "raster", metricLabel: "Overall score" })).toEqual(
      {
        title: "Overall score",
        subtitle: "Raster cells",
      },
    );
  });

  it("no metricLabel at all: falls back to 'Score'", () => {
    expect(legendTitle({ lens: "scores", branch: "raster" }).title).toBe("Score");
  });
});

describe("legendTitle: scores, Program areas", () => {
  it("'{metric label} · Program Areas · {release}'", () => {
    expect(
      legendTitle({ lens: "scores", branch: "zone", metricLabel: "Overall score", release: "v7" }),
    ).toEqual({ title: "Overall score", subtitle: "Program Areas · v7" });
  });
});

describe("legendTitle: species", () => {
  it("'{common} ({sci})' title, 'input · representation · semantics' subtitle", () => {
    expect(
      legendTitle({
        lens: "species",
        commonName: "Leatherback turtle",
        scientificName: "Dermochelys coriacea",
        inputLabel: "Merged model",
        representation: "raster",
        valueSemantics: "habitat suitability 1-100",
      }),
    ).toEqual({
      title: "Leatherback turtle (Dermochelys coriacea)",
      subtitle: "Merged model · raster · habitat suitability 1-100",
    });
  });

  it("only a scientific name (no common name yet): title is the binomial alone", () => {
    expect(legendTitle({ lens: "species", scientificName: "Dermochelys coriacea" }).title).toBe(
      "Dermochelys coriacea",
    );
  });

  it("no name at all: a safe fallback, never a blank/undefined title", () => {
    expect(legendTitle({ lens: "species" }).title).toBe("Species");
  });

  it("no subtitle context at all: null, not an empty string", () => {
    expect(legendTitle({ lens: "species", commonName: "Walrus" }).subtitle).toBeNull();
  });
});

describe("legendChipTitle", () => {
  it("the title alone -- the chip's short form", () => {
    expect(
      legendChipTitle({
        lens: "scores",
        branch: "raster",
        metricLabel: "Overall score",
        release: "v7",
      }),
    ).toBe("Overall score");
  });
});
