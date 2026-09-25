// popup.ts: §6.5's swatch/luminance/text rules, generalized to the asset's own rescale (not a
// hard-coded [1,100]) so an AquaX Delivered click (raw band [0,1000]) still picks the right bin.
import { describe, expect, it } from "vitest";
import {
  luminance,
  popupAnnounceText,
  popupContent,
  popupHtml,
  roundValue,
  textColorFor,
} from "../../../src/lens/species/popup";
import { RANGE_FILL_COLOR } from "../../../src/lib/map/colors";
import { createTitilerValueSource, type PointJsonFetcher } from "../../../src/lib/raster/point";

// 11 stops, min->black-ish (dark) at index 0, max->white-ish (light) at index 10, so the bin math
// is easy to eyeball: this is a TEST fixture ramp, never a second app-wide palette.
const STOPS = [
  "#000000",
  "#191919",
  "#333333",
  "#4c4c4c",
  "#666666",
  "#7f7f7f",
  "#999999",
  "#b2b2b2",
  "#cccccc",
  "#e5e5e5",
  "#ffffff",
];

describe("luminance / textColorFor", () => {
  it("R's own weights, 0.299/0.587/0.114 — black on white, white on black", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(textColorFor("#ffffff")).toBe("black");
    expect(textColorFor("#000000")).toBe("white");
  });

  it("the exact 0.5 threshold, PAIRED on both sides (fix round 3 #3)", () => {
    // a lone one-sided fixture (only #808080 -> black) cannot tell "threshold is 0.5" apart from
    // "threshold is anywhere below 0.502" — a reviewer's fault lowering it to 0.35 stayed GREEN
    // against it. #7f7f7f sits on the OTHER side, close enough (0.498) that only the real 0.5
    // threshold gets it right.
    expect(luminance("#808080")).toBeCloseTo(0.502, 3); // (128,128,128)/255 ≈ 0.502 > 0.5 -> black
    expect(textColorFor("#808080")).toBe("black");
    expect(luminance("#7f7f7f")).toBeCloseTo(0.498, 3); // (127,127,127)/255 ≈ 0.498 <= 0.5 -> white
    expect(textColorFor("#7f7f7f")).toBe("white");
  });
});

describe("roundValue", () => {
  it("half-to-even at 3 decimals", () => {
    expect(roundValue(1.2345, 3)).toBeCloseTo(1.234, 5); // 1.2345*1000=1234.5 -> even 1234
    expect(roundValue(1.2335, 3)).toBeCloseTo(1.234, 5); // 1233.5 -> even 1234
  });
});

describe("popupContent", () => {
  it("a numeric value bins against the asset's OWN rescale, not a hard-coded [1,100]", () => {
    // AquaX Delivered: raw band [0,1000]; a value near the top should land near the light end
    const near1000 = popupContent({
      sci: "Dermochelys coriacea",
      lon: -70,
      lat: 30,
      cellId: 12345,
      kind: "value",
      value: 950,
      rescale: [0, 1000],
      stops: STOPS,
    });
    expect(near1000.pinColor).toBe("#ffffff");
    expect(near1000.textColor).toBe("black");
    expect(near1000.text).toBe("Value: 950");
    expect(near1000.displayValue).toBe(950);
  });

  it("the default [1,100] case (everything but AquaX Delivered)", () => {
    const p = popupContent({
      sci: "x",
      lon: 1,
      lat: 2,
      cellId: 1,
      kind: "value",
      value: 1,
      rescale: [1, 100],
      stops: STOPS,
    });
    expect(p.pinColor).toBe("#000000");
    expect(p.textColor).toBe("white");
  });

  it("no boot.palettes yet: the value still shows, with a neutral grey pin (no invented ramp)", () => {
    const p = popupContent({
      sci: "x",
      lon: 1,
      lat: 2,
      cellId: 1,
      kind: "value",
      value: 42.5,
      rescale: [1, 100],
      stops: null,
    });
    expect(p.pinColor).toBe("grey");
    expect(p.textColor).toBeNull();
    expect(p.text).toBe("Value: 42.5");
  });

  it("a range click reports 'presence only', swatch = the range fill color", () => {
    const p = popupContent({ sci: "x", lon: 1, lat: 2, cellId: 1, kind: "presence" });
    expect(p.text).toBe("presence only");
    expect(p.pinColor).toBe(RANGE_FILL_COLOR);
    expect(p.displayValue).toBeNull();
  });

  it("no value (a nodata COG pixel, or outside the grid): grey pin + 'No scored cell here'", () => {
    const p = popupContent({ sci: "x", lon: 1, lat: 2, cellId: null, kind: "no-value" });
    expect(p.text).toBe("No scored cell here");
    expect(p.pinColor).toBe("grey");
    expect(p.textColor).toBeNull();
  });

  it("kind 'value' with a missing value/rescale degrades to 'No scored cell here' rather than throwing", () => {
    const p = popupContent({ sci: "x", lon: 1, lat: 2, cellId: 1, kind: "value" });
    expect(p.kind).toBe("no-value");
    expect(p.text).toBe("No scored cell here");
  });
});

// D3 fold-in (orchestrator round 2, 2026-09-24): the SAME rule the scores lens already got
// (`src/lens/scores/popup.ts#noScoredCellText`) — a no-value click must never show an internal
// `cellId`, even when `mapClick` DID resolve one (the grid still has a cell there; the asset's own
// COG pixel is just nodata). Showing "Cell ID: 5" beside "no value" reads as a data/lookup bug, not
// as "you clicked outside where this model has data."
describe("D3 fold-in: the no-value popup never shows a cell id", () => {
  it("popupHtml omits the 'Cell ID' line entirely for kind 'no-value', even with a real cellId", () => {
    const html = popupHtml(popupContent({ sci: "x", lon: 1, lat: 2, cellId: 5, kind: "no-value" }));
    expect(html).not.toContain("Cell ID");
    expect(html).toContain("No scored cell here");
  });

  it("popupAnnounceText never mentions a cell for kind 'no-value'", () => {
    const withCell = popupContent({ sci: "x", lon: 1, lat: 2, cellId: 5, kind: "no-value" });
    const withoutCell = popupContent({ sci: "x", lon: 1, lat: 2, cellId: null, kind: "no-value" });
    expect(popupAnnounceText(withCell)).not.toContain("cell 5");
    expect(popupAnnounceText(withoutCell)).not.toContain("no cell");
    expect(popupAnnounceText(withCell)).toContain("No scored cell here");
  });

  it("a 'value'/'presence' popup still shows its Cell ID line unchanged (only 'no-value' drops it)", () => {
    const value = popupHtml(
      popupContent({
        sci: "x",
        lon: 1,
        lat: 2,
        cellId: 7,
        kind: "value",
        value: 1,
        rescale: [1, 100],
        stops: STOPS,
      }),
    );
    expect(value).toContain("Cell ID: 7");
    const presence = popupHtml(
      popupContent({ sci: "x", lon: 1, lat: 2, cellId: 7, kind: "presence" }),
    );
    expect(presence).toContain("Cell ID: 7");
  });
});

describe("popupHtml", () => {
  it("§6.5's name/cell/lon/lat/value shape, swatch colored, text contrast applied", () => {
    const html = popupHtml(
      popupContent({
        sci: "Dermochelys coriacea",
        lon: -70.1234,
        lat: 30.5678,
        cellId: 12345,
        kind: "value",
        value: 1,
        rescale: [1, 100],
        stops: STOPS,
      }),
    );
    expect(html).toContain("<i>Dermochelys coriacea</i>");
    expect(html).toContain("Cell ID: 12345");
    expect(html).toContain("Lon: -70.123");
    expect(html).toContain("Lat: 30.568");
    expect(html).toContain("background:#000000;color:white");
    expect(html).toContain("Value: 1");
  });

  it("no cell id renders an em dash, never 'null' (kind 'value'/'presence' — 'no-value' omits the line entirely, see the D3 fold-in describe below)", () => {
    const html = popupHtml(
      popupContent({
        sci: "x",
        lon: 1,
        lat: 2,
        cellId: null,
        kind: "value",
        value: 1,
        rescale: [1, 100],
        stops: STOPS,
      }),
    );
    expect(html).toContain("Cell ID: —");
    expect(html).not.toContain("null");
  });

  it("a species/common name is escaped, never raw markup, in a Popup#setHTML string", () => {
    const html = popupHtml(
      popupContent({
        sci: "<img src=x onerror=alert(1)>",
        lon: 1,
        lat: 2,
        cellId: 1,
        kind: "no-value",
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

// atlas-5's own gate: "click value equals /cog/point at five probe points per layer type." Each
// probe here goes through the REAL `createTitilerValueSource` (raster/point.ts) with a routed
// (fake, injected) fetchJson standing in for the network — never a live request — then feeds the
// resolved value into `popupContent`, so this pins the WHOLE click pipeline, not just the swatch
// math above.
describe("the five /cog/point probes -> popupContent.displayValue", () => {
  const COG_URL = "https://s3.example/v9/native/merged/ms_merge_WORMS_137209.tif";
  const AQUAX_URL = "https://s3.example/v9/native/ax_native/ax_137209.tif";

  // `titilerPointUrl` builds `{host}/cog/point/{lon},{lat}?url={encoded cogUrl}` — the fake
  // "route" below matches on the cogUrl actually embedded in that query string (percent-encoded,
  // like a real request), not a bare prefix, so it fails the same way a real 404 would if the
  // point sampler ever asked for the WRONG asset's url.
  function fetcherFor(byCogUrl: Record<string, unknown>): PointJsonFetcher {
    return async (url: string) => {
      for (const [cogUrl, body] of Object.entries(byCogUrl)) {
        if (url.includes(encodeURIComponent(cogUrl))) return body;
      }
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    };
  }

  it("probe 1 — cog (merged, 1-100 band): a plain numeric value", async () => {
    const source = createTitilerValueSource(fetcherFor({ [COG_URL]: { values: [42] } }));
    const value = await source.pointValue({
      domain: "species",
      lon: -70,
      lat: 30,
      cogUrl: COG_URL,
    });
    const content = popupContent({
      sci: "x",
      lon: -70,
      lat: 30,
      cellId: 1,
      kind: "value",
      value: value!,
      rescale: [1, 100],
      stops: STOPS,
    });
    expect(content.displayValue).toBe(42);
  });

  it("probe 2 — aquax-delivered (0-1000 band): NOT rescaled into 1-100", async () => {
    const source = createTitilerValueSource(fetcherFor({ [AQUAX_URL]: { values: [850] } }));
    const value = await source.pointValue({
      domain: "species",
      lon: -70,
      lat: 30,
      cogUrl: AQUAX_URL,
    });
    const content = popupContent({
      sci: "x",
      lon: -70,
      lat: 30,
      cellId: 1,
      kind: "value",
      value: value!,
      rescale: [0, 1000],
      stops: STOPS,
    });
    expect(content.displayValue).toBe(850);
  });

  it("probe 3 — pmtiles presence: no /cog/point call at all, no numeric value", () => {
    // a range asset has no `/cog/point` URL to sample in the first place (mapInputs.ts never
    // builds one for a pmtiles asset) — the probe here IS the absence of a fetch.
    const content = popupContent({ sci: "x", lon: -70, lat: 30, cellId: 1, kind: "presence" });
    expect(content.displayValue).toBeNull();
    expect(content.text).toBe("presence only");
  });

  it("probe 4 — nodata: /cog/point answers with no value (a nodata pixel)", async () => {
    const source = createTitilerValueSource(fetcherFor({ [COG_URL]: { values: [null] } }));
    const value = await source.pointValue({ domain: "species", lon: 0, lat: 0, cogUrl: COG_URL });
    expect(value).toBeNull();
    const content = popupContent({
      sci: "x",
      lon: 0,
      lat: 0,
      cellId: 5,
      kind: value === null ? "no-value" : "value",
      value: value ?? undefined,
      rescale: [1, 100],
      stops: STOPS,
    });
    expect(content.displayValue).toBeNull();
    expect(content.text).toBe("No scored cell here");
  });

  it("probe 5 — off-grid: the click never resolved a cell id, so no /cog/point call is made", () => {
    // `mapClick`'s own `cellId: null` (map/interaction.ts) for a click outside the release's
    // grid — the caller (state.svelte.ts) never even reaches the ValueSource in that branch.
    const content = popupContent({ sci: "x", lon: 200, lat: 89, cellId: null, kind: "no-value" });
    expect(content.displayValue).toBeNull();
    expect(content.cellId).toBeNull();
    expect(content.text).toBe("No scored cell here");
  });
});

// Ben's ask (round-3 review, 2026-09-25): the species popup gets the SAME distribution sparkline
// the scores lens' popup renders (`lib/map/popup.ts#sparklineBlock`), appended optionally.
describe("popupHtml: sparkline (Ben's ask, round-3 review)", () => {
  it("no sparkline argument: no sparkline markup at all (backward compatible)", () => {
    const html = popupHtml(
      popupContent({
        sci: "x",
        lon: 1,
        lat: 2,
        cellId: 1,
        kind: "value",
        value: 1,
        rescale: [1, 100],
        stops: STOPS,
      }),
    );
    expect(html).not.toContain("atlas-popup-sparkline");
  });

  it("'loading': renders the skeleton block", () => {
    const html = popupHtml(
      popupContent({
        sci: "x",
        lon: 1,
        lat: 2,
        cellId: 1,
        kind: "value",
        value: 1,
        rescale: [1, 100],
        stops: STOPS,
      }),
      "loading",
    );
    expect(html).toContain("atlas-popup-sparkline--loading");
  });

  it("a resolved SparklineContent renders the SVG", () => {
    const html = popupHtml(
      popupContent({
        sci: "x",
        lon: 1,
        lat: 2,
        cellId: 1,
        kind: "value",
        value: 1,
        rescale: [1, 100],
        stops: STOPS,
      }),
      {
        pathD: "M0,28 L120,28 Z",
        gradientStops: [{ offset: 0, color: "#000000" }],
        markerX: 60,
        width: 120,
        height: 28,
        minLabel: "1",
        maxLabel: "100",
      },
    );
    expect(html).toContain("<svg");
  });
});
