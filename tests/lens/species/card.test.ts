// card.ts: the species card view model (section 7.3) and the document title.
import { describe, expect, it } from "vitest";
import {
  documentTitle,
  esaListing,
  noSurfaceNotice,
  speciesCard,
  speciesCardErrorText,
  wormsUrl,
} from "../../../src/lens/species/data/card";
import { MERGED_IN } from "../../../src/lens/species/data/resolve";
import { CARDS, datasetsFor } from "./fixtures";

const v9 = () => ({ ver: "v9", selectedInput: MERGED_IN, datasets: datasetsFor("v9") });

describe("the facts list", () => {
  it("has common name, category, ESA, IUCN and the WoRMS link", () => {
    const card = speciesCard(CARDS.walrus(), v9());
    expect(card.sci).toBe("Odobenus rosmarus");
    expect(card.facts).toEqual([
      { label: "Common name", value: "Walrus" },
      // P round V5 fix: the facts list shows the DISPLAY category ("Mammal"), not the raw sp_cat
      // string categoryLabel() cleans up (Opus eyes-on desktop-18: "Category: mammal" lowercase).
      { label: "Category", value: "Mammal" },
      // UI-9 (round-3 review): "NMFS:LC" read as if LC were an ESA status (it is not one) --
      // the code is now mapped to a reviewer-legible label, the source named once, in the fact's
      // own LABEL rather than duplicated into the value.
      { label: "Listed under the ESA (NMFS)", value: "Not listed (LC)" },
      { label: "IUCN Red List", value: "Vulnerable (VU)" },
      {
        label: "WoRMS",
        value: "137077",
        href: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=137077",
      },
      { label: "MMPA", value: "Protected (20)" },
    ]);
  });

  it("title-cases the Category fact for every sp_cat (Opus eyes-on desktop-17: 'Category: turtle')", () => {
    const leatherback = speciesCard(CARDS.leatherback(), v9());
    expect(leatherback.facts).toContainEqual({ label: "Category", value: "Turtle" });
  });

  it("MBTA appears for a bird, and a botw authority gets NO WoRMS link", () => {
    const card = speciesCard(CARDS.auklet(), v9());
    expect(card.facts).toContainEqual({ label: "MBTA", value: "Protected (10)" });
    expect(card.facts.some((f) => f.label === "WoRMS")).toBe(false);
    expect(wormsUrl("botw", "22694915")).toBeNull();
    expect(wormsUrl("worms", null)).toBeNull();
  });
});

// UI-9 (round-3 review): a NOAA reviewer stops at "ESA Listing: FWS:LC" (LC is not an ESA status)
// and "ESA Listing: NMFS:EN (NMFS)" (the source named twice). The source lives in `esa.code`
// itself (`"{SOURCE}:{STATUS}"`) -- `esaListing()` reads it from there, never from the separate
// `esa.source` field (which duplicated it).
describe("the ESA line", () => {
  it("maps the status to a reviewer-legible label, code kept in parentheses; source named once, in the fact's label", () => {
    expect(esaListing("FWS:TN")).toEqual({
      label: "Listed under the ESA (FWS)",
      value: "Threatened (TN)",
    });
    // the same TN status code, sourced from a different prefix (the data-level IUCN:TN bug,
    // UI-L9, tracked separately) -- the source clause simply reflects whatever prefix the code
    // carries; TN still maps to "Threatened" either way.
    expect(esaListing("IUCN:TN")).toEqual({
      label: "Listed under the ESA (IUCN)",
      value: "Threatened (TN)",
    });
    const card = speciesCard(CARDS.murrelet(), { ...v9(), ver: "v7", datasets: datasetsFor("v7") });
    expect(card.facts).toContainEqual({
      label: "Listed under the ESA (FWS)",
      value: "Threatened (TN)",
    });
  });

  it("an unrecognized status code falls back to the bare code, never a blank label", () => {
    expect(esaListing("FWS:XX")).toEqual({ label: "Listed under the ESA (FWS)", value: "XX" });
  });

  it("LC maps to 'Not listed', not left as a bare, misleading status code", () => {
    expect(esaListing("NMFS:LC")).toEqual({
      label: "Listed under the ESA (NMFS)",
      value: "Not listed (LC)",
    });
  });

  it("a code with no ':' has no source clause in the label", () => {
    expect(esaListing("EN")).toEqual({ label: "Listed under the ESA", value: "Endangered (EN)" });
  });

  it("leatherback's FWS:EN code -> 'Listed under the ESA (FWS)' / 'Endangered (EN)'", () => {
    expect(speciesCard(CARDS.leatherback(), v9()).facts).toContainEqual({
      label: "Listed under the ESA (FWS)",
      value: "Endangered (EN)",
    });
  });

  it("with no code, the row is omitted entirely", () => {
    expect(esaListing(null)).toBeNull();
    expect(
      speciesCard(CARDS.whelk(), { ...v9(), ver: "v1", datasets: datasetsFor("v1") }).facts,
    ).not.toContainEqual(expect.objectContaining({ label: expect.stringContaining("ESA") }));
  });
});

describe("the Values tree", () => {
  it("is the merged node with '(IUCN masked)' and every input beneath it", () => {
    const card = speciesCard(CARDS.walrus(), v9());
    expect(card.iucnMasked).toBe(true);
    expect(card.values).toHaveLength(1);
    expect(card.values[0].label).toBe("Merged Model (IUCN masked)");
    expect(card.values[0].children?.map((c) => c.label)).toEqual([
      "AquaMaps SDM",
      "AquaX",
      "IUCN Range",
    ]);
    expect(card.values[0].children?.[1].info).toContain("habitat suitability");
  });

  it("drops '(IUCN masked)' when the taxon has no rng_iucn input", () => {
    const card = speciesCard(CARDS.leatherback(), v9());
    expect(CARDS.leatherback().inputs.some((i) => i.dsKey === "rng_iucn")).toBe(true);
    const auklet = speciesCard(CARDS.auklet(), v9());
    expect(auklet.iucnMasked).toBe(false);
    expect(card.iucnMasked).toBe(true);
  });

  it("collapses to ONE flat entry for a single model with no IUCN range", () => {
    const card = speciesCard(CARDS.auklet(), v9());
    expect(card.values).toHaveLength(1);
    expect(card.values[0].key).toBe("bl");
    expect(card.values[0].children).toBeUndefined();
    expect(card.mask).toBeNull();
  });

  it("marks the layer on screen active and an input with no surface as not-a-link", () => {
    const card = speciesCard(CARDS.walrusV7(), {
      ver: "v7",
      selectedInput: "am_0.05",
      datasets: datasetsFor("v7"),
    });
    const am = card.values[0].children?.find((c) => c.key === "am_0.05");
    expect(am?.active).toBe(true);
    expect(am?.hasSurface).toBe(false);
    expect(card.values[0].active).toBe(false);
  });
});

describe("the Mask section", () => {
  it("exists only when the taxon has an rng_iucn input, with (required) on it", () => {
    const card = speciesCard(CARDS.walrus(), v9());
    expect(card.mask?.map((m) => [m.key, m.required ?? false])).toEqual([["rng_iucn", true]]);
    expect(card.mask?.[0].info).toBeNull(); // the value_info line is for VALUE entries only
    expect(speciesCard(CARDS.auklet(), v9()).mask).toBeNull();
  });

  it("lists every mask input of the taxon", () => {
    const card = speciesCard(CARDS.leatherback(), v9());
    expect(card.mask?.map((m) => m.key)).toEqual([
      "ch_fws",
      "ch_nmfs",
      "rng_fws",
      "rng_iucn",
      "rng_turtle_swot_dps",
    ]);
  });
});

describe("no published surface", () => {
  it("is the notice production shows, and only for a taxon with merged: null", () => {
    const card = speciesCard(CARDS.whelk(), {
      ver: "v1",
      selectedInput: MERGED_IN,
      datasets: datasetsFor("v1"),
    });
    expect(card.noSurfaceNotice).toBe("No surface published for this taxon in v1");
    expect(noSurfaceNotice("v7b")).toBe("No surface published for this taxon in v7b");
    expect(speciesCard(CARDS.walrus(), v9()).noSurfaceNotice).toBeNull();
  });
});

describe("the document title", () => {
  it("names the taxon, its category, the key on screen and the layer", () => {
    const datasets = datasetsFor("v9");
    expect(documentTitle(CARDS.walrus(), { selectedInput: MERGED_IN, datasets })).toBe(
      "Odobenus rosmarus distribution (mammal: Walrus; ms_merge|WORMS:137077) from Merged Model | Marine Sensitivity",
    );
  });

  it("uses the INPUT's mdl_key and name when an input is on screen", () => {
    const datasets = datasetsFor("v9");
    expect(documentTitle(CARDS.walrus(), { selectedInput: "ax", datasets })).toBe(
      "Odobenus rosmarus distribution (mammal: Walrus; ax|137077) from AquaX | Marine Sensitivity",
    );
  });

  it("omits the common name when there is none", () => {
    expect(
      documentTitle(CARDS.globe(), { selectedInput: MERGED_IN, datasets: datasetsFor("v9") }),
    ).toBe(
      "Ubiquitous globalis distribution (fish; ms_merge|DERIVED:513) from Merged Model | Marine Sensitivity",
    );
  });
});

// UI-9 (round-3 review): the species card's load-error copy stopped printing the raw error kind.
describe("speciesCardErrorText", () => {
  it("not-found, with a release: names the release and points back at search", () => {
    expect(speciesCardErrorText("not-found", "v7")).toBe(
      "This species isn't in release v7. Search for another above.",
    );
  });

  it("not-found, no release resolved yet: a version-agnostic fallback, never 'release null'", () => {
    expect(speciesCardErrorText("not-found", null)).toBe(
      "This species isn't in this release. Search for another above.",
    );
  });

  it("every other kind (network/http/parse/schema): a plain retry hint, never the raw code", () => {
    for (const kind of ["network", "http", "parse", "schema"]) {
      expect(speciesCardErrorText(kind, "v7")).toBe(
        "Couldn't load this species. Please try again.",
      );
    }
  });
});
