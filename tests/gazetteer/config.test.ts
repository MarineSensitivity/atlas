import { describe, expect, it } from "vitest";
import {
  GAZETTEER_BUCKET_BASE,
  GAZETTEER_ROOT,
  GENERIC_ATTRIBUTION,
  PLACES_ATTRIBUTION,
  authorityOf,
  fallbackAttribution,
  gazetteerDataBase,
  joinCredits,
  layersManifestUrl,
  placesTilesUrl,
  toDataUrl,
} from "../../src/lib/gazetteer/config";

describe("bases", () => {
  it("the published root is storage.oceanmetrics.io/gazetteer/", () => {
    expect(GAZETTEER_ROOT).toBe("https://storage.oceanmetrics.io/gazetteer/");
  });
  it("data is read from the bucket (the canonical host 302s the Range preflight), same tree", () => {
    expect(gazetteerDataBase()).toBe(GAZETTEER_BUCKET_BASE);
    expect(placesTilesUrl()).toBe(`${GAZETTEER_BUCKET_BASE}places/places.pmtiles`);
    expect(layersManifestUrl()).toBe(`${GAZETTEER_BUCKET_BASE}index/layers.json`);
  });
  it("an override gets a trailing slash", () => {
    expect(gazetteerDataBase("https://staging.example/gaz")).toBe("https://staging.example/gaz/");
  });
  it("toDataUrl re-bases only URLs under the canonical root", () => {
    expect(toDataUrl(`${GAZETTEER_ROOT}boem/places.pmtiles`)).toBe(
      `${GAZETTEER_BUCKET_BASE}boem/places.pmtiles`,
    );
    expect(toDataUrl("https://elsewhere.example/x.pmtiles")).toBe(
      "https://elsewhere.example/x.pmtiles",
    );
  });
});

describe("credits", () => {
  it("authorityOf reads the prefix before the first colon", () => {
    expect(authorityOf("BOEM:OCS-P 0562")).toBe("BOEM");
    expect(authorityOf("NMS:CINMS")).toBe("NMS");
  });
  it("built-in credit: the places collection's providers for NMS/MRGID/PSGID, generic otherwise", () => {
    for (const id of ["NMS:CINMS", "MRGID:8439", "PSGID:939"]) {
      expect(fallbackAttribution(id)).toBe(PLACES_ATTRIBUTION);
    }
    expect(fallbackAttribution("BOEM:OCS-P 0562")).toBe(GENERIC_ATTRIBUTION);
  });
  it("joinCredits dedupes, keeps order, says 'Processed by Ocean Metrics.' once at the end", () => {
    expect(
      joinCredits([
        "BOEM, via MarineCadastre. Processed by Ocean Metrics.",
        "NOAA AOA program. Processed by Ocean Metrics.",
        "BOEM, via MarineCadastre. Processed by Ocean Metrics.",
        "",
        undefined,
      ]),
    ).toBe("BOEM, via MarineCadastre; NOAA AOA program. Processed by Ocean Metrics.");
  });
  it("joinCredits: nothing in, nothing out; a credit without the suffix gets none", () => {
    expect(joinCredits([])).toBe("");
    expect(joinCredits(["Someone."])).toBe("Someone.");
    expect(joinCredits(["Processed by Ocean Metrics."])).toBe("Processed by Ocean Metrics.");
  });
});
