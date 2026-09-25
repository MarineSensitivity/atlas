// atlas-4/5 fix round 3: ONE themed popup, shared by both lenses (owner screenshot: MapLibre's own
// unthemed Popup painted white-on-white in the navy theme). This is the unit half of the fix's
// test plan — "the popup HTML/classes reference the theme tokens and never a literal colour"; the
// e2e half (`e2e/species-popup.spec.ts`) measures the REAL computed contrast in both themes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPopup, POPUP_CLASS_NAME } from "../../src/lib/map/popup";

const POPUP_CSS = readFileSync(
  fileURLToPath(new URL("../../src/lib/map/popup.css", import.meta.url)),
  "utf8",
);

// #rgb | #rgba | #rrggbb | #rrggbbaa — the same shape scripts/check-hex-literals-core.mjs scans
// for, applied here to a directory that checker's own SCAN_ROOTS does not cover (src/lib/map holds
// deliberate DATA-color literals elsewhere, e.g. colors.ts's `SELECTION_COLOR` — see that file's
// header — so this test targets popup.css/popup.ts specifically, not the whole directory).
const HEX_LITERAL_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/;

describe("createPopup", () => {
  it("always carries the theming class", () => {
    const popup = createPopup();
    expect(popup.options.className).toBe(POPUP_CLASS_NAME);
  });

  it("appends a caller's own className rather than dropping the theming", () => {
    const popup = createPopup({ className: "species-popup-wrap" });
    expect(popup.options.className).toBe(`${POPUP_CLASS_NAME} species-popup-wrap`);
  });

  it("a caller cannot opt out of closeButton/closeOnClick by omission — the defaults are themed too", () => {
    const popup = createPopup();
    expect(popup.options.closeButton).toBe(true);
    expect(popup.options.closeOnClick).toBe(true);
  });
});

describe("popup.css", () => {
  it("scopes every rule under the theming class", () => {
    const rules = POPUP_CSS.split("}").filter((r) => r.trim() && !r.trim().startsWith("/*"));
    for (const rule of rules) {
      const selector = rule.split("{")[0];
      if (!selector.trim()) continue;
      expect(selector, selector).toContain(`.${POPUP_CLASS_NAME}`);
    }
  });

  it("themes background, text and the close button from custom properties, never a literal colour", () => {
    expect(POPUP_CSS).toContain("var(--surface-panel)");
    expect(POPUP_CSS).toContain("var(--text-primary)");
    expect(POPUP_CSS).toContain("var(--surface-panel-basis)"); // the tip
    expect(POPUP_CSS).toContain("var(--focus-ring)"); // the close button's focus ring
    expect(HEX_LITERAL_RE.test(POPUP_CSS)).toBe(false);
  });

  it("SEEDED FAULT: the same scan flags a literal planted in a copy of this file", () => {
    const withFault = POPUP_CSS.replace("var(--text-primary)", "#ffffff");
    expect(HEX_LITERAL_RE.test(withFault)).toBe(true);
  });
});

// Ben's ask (round-3 review, 2026-09-25): the ONE colour-coded value popup template + its
// sparkline builder, shared by the scores cell/zone popups and the species popup.
import { popupSparkline, valuePopupAnnounceText, valuePopupHtml } from "../../src/lib/map/popup";

describe("valuePopupHtml", () => {
  it("subject, value row with swatch, no sparkline/unit when omitted", () => {
    const html = valuePopupHtml({
      subject: "Cell 3350704 · 28.625° N, 90.575° W",
      valueLine: "Score 44",
      swatchColor: "#abcdef",
      textColor: "black",
    });
    expect(html).toContain("Cell 3350704");
    expect(html).toContain("Score 44");
    expect(html).toContain("background:#abcdef;color:black");
    expect(html).not.toContain("atlas-popup-sparkline");
    expect(html).not.toContain("atlas-popup-unit");
  });

  it("null swatchColor draws a neutral grey swatch, never an invented colour", () => {
    const html = valuePopupHtml({
      subject: "All US waters",
      valueLine: "No scored cell here",
      swatchColor: null,
      textColor: null,
    });
    expect(html).toContain("background:grey");
  });

  it("a unitLabel renders a third line", () => {
    const html = valuePopupHtml({
      subject: "Walrus",
      valueLine: "Suitability 71",
      swatchColor: "#112233",
      textColor: "white",
      unitLabel: "Merged model",
    });
    expect(html).toContain('<div class="atlas-popup-unit">Merged model</div>');
  });

  it("escapes untrusted subject/value/unit text -- a release-bundle string is never markup", () => {
    const html = valuePopupHtml({
      subject: "<script>alert(1)</script>",
      valueLine: "Score 1",
      swatchColor: null,
      textColor: null,
      unitLabel: "<b>x</b>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("sparkline: 'loading' renders the skeleton block, not the SVG", () => {
    const html = valuePopupHtml({
      subject: "s",
      valueLine: "v",
      swatchColor: null,
      textColor: null,
      sparkline: "loading",
    });
    expect(html).toContain("atlas-popup-sparkline--loading");
    expect(html).not.toContain("<svg");
  });

  it("sparkline: a resolved SparklineContent renders the SVG with a gradient and a marker line", () => {
    const sparkline = popupSparkline({ binCount: 3, counts: [1, 5, 1], min: 0, max: 100 }, 44, [
      "#000000",
      "#ffffff",
    ]);
    const html = valuePopupHtml({
      subject: "s",
      valueLine: "Score 44",
      swatchColor: "#808080",
      textColor: "white",
      sparkline,
    });
    expect(html).toContain("<svg");
    expect(html).toContain("linearGradient");
    expect(html).toContain("<line");
  });

  it("sparkline: null renders neither the skeleton nor the SVG", () => {
    const html = valuePopupHtml({
      subject: "s",
      valueLine: "v",
      swatchColor: null,
      textColor: null,
      sparkline: null,
    });
    expect(html).not.toContain("atlas-popup-sparkline");
  });
});

describe("valuePopupAnnounceText", () => {
  it("plain text, subject: value, unit appended when present", () => {
    expect(
      valuePopupAnnounceText({
        subject: "Cell 42",
        valueLine: "Score 44",
        swatchColor: null,
        textColor: null,
        unitLabel: "Overall score",
      }),
    ).toBe("Cell 42: Score 44, Overall score");
  });

  it("no unitLabel: no trailing comma clause", () => {
    expect(
      valuePopupAnnounceText({
        subject: "Cell 42",
        valueLine: "Score 44",
        swatchColor: null,
        textColor: null,
      }),
    ).toBe("Cell 42: Score 44");
  });
});

describe("popupSparkline", () => {
  it("builds gradient stops from the palette, evenly spaced offsets", () => {
    const s = popupSparkline({ binCount: 2, counts: [1, 1], min: 0, max: 10 }, 5, [
      "#111111",
      "#222222",
      "#333333",
    ]);
    expect(s.gradientStops).toEqual([
      { offset: 0, color: "#111111" },
      { offset: 0.5, color: "#222222" },
      { offset: 1, color: "#333333" },
    ]);
  });

  it("the marker sits at the clicked value's position within [min, max]", () => {
    const s = popupSparkline({ binCount: 2, counts: [1, 1], min: 0, max: 100 }, 50, ["#000"]);
    expect(s.markerX).toBe(s.width / 2);
  });

  it("default label formatter rounds to an integer", () => {
    const s = popupSparkline({ binCount: 2, counts: [1, 1], min: 0.4, max: 99.6 }, 50, ["#000"]);
    expect(s.minLabel).toBe("0");
    expect(s.maxLabel).toBe("100");
  });
});
