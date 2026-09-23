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
