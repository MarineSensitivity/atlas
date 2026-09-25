import { describe, expect, it } from "vitest";
import { buildDownloadItems } from "../../src/lib/download/items";

describe("buildDownloadItems", () => {
  it("always offers Map PNG and Map SVG, enabled", () => {
    const items = buildDownloadItems({ cogUrl: null, hasPlacesSelection: false });
    const png = items.find((i) => i.id === "map-png")!;
    const svg = items.find((i) => i.id === "map-svg")!;
    expect(png.disabled).toBe(false);
    expect(svg.disabled).toBe(false);
  });

  it("enables the GeoTIFF item when a COG URL is present", () => {
    const items = buildDownloadItems({
      cogUrl: "https://cogs/x.tif",
      hasPlacesSelection: false,
    });
    const cog = items.find((i) => i.id === "cog-tif")!;
    expect(cog.disabled).toBe(false);
  });

  it("disables the GeoTIFF item with a reason when no COG is published", () => {
    const items = buildDownloadItems({
      cogUrl: null,
      cogDisabledReason: "no surface selected for this input",
      hasPlacesSelection: false,
    });
    const cog = items.find((i) => i.id === "cog-tif")!;
    expect(cog.disabled).toBe(true);
    expect(cog.hint).toBe("no surface selected for this input");
  });

  it("falls back to a generic reason when none is given", () => {
    const items = buildDownloadItems({ cogUrl: null, hasPlacesSelection: false });
    const cog = items.find((i) => i.id === "cog-tif")!;
    expect(cog.hint).toBe("no COG published for this view");
  });

  it("omits 'Selected places · GeoJSON' when there is no places selection", () => {
    const items = buildDownloadItems({ cogUrl: null, hasPlacesSelection: false });
    expect(items.find((i) => i.id === "places-geojson")).toBeUndefined();
  });

  it("includes 'Selected places · GeoJSON' when there is a places selection", () => {
    const items = buildDownloadItems({ cogUrl: null, hasPlacesSelection: true });
    const places = items.find((i) => i.id === "places-geojson")!;
    expect(places.disabled).toBe(false);
    expect(places.label).toBe("Selected places · GeoJSON");
  });

  it("never includes a Program Areas · GeoJSON item (no published complete geometry asset)", () => {
    const items = buildDownloadItems({ cogUrl: "https://cogs/x.tif", hasPlacesSelection: true });
    expect(items.some((i) => i.label.toLowerCase().includes("program area"))).toBe(false);
  });

  it("returns items in the brief's own order: PNG, SVG, GeoTIFF, [GeoJSON]", () => {
    const items = buildDownloadItems({ cogUrl: "x", hasPlacesSelection: true });
    expect(items.map((i) => i.id)).toEqual(["map-png", "map-svg", "cog-tif", "places-geojson"]);
  });
});
