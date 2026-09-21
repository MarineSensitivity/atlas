// atlas-3: the rules Ben's review turned into requirements, asserted against the mockups so the
// component build inherits them rather than re-deciding them:
//   - the rail is the SAME five tools in the SAME order on every viewport (desktop rail = phone
//     bottom bar); Help is top-bar only; there is no species/fish rail button
//   - every floating panel and the phone sheet carry collapse · half · full in the upper right
//   - the Flower control is inactive, not absent, in the Species lens
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RAIL = ["Layers", "Places", "Flower plot", "Table", "Report"];

const SURFACES = {
  "scores-desktop": "docs/design/mockups/scores-desktop.html",
  "species-desktop": "docs/design/mockups/species-desktop.html",
  "phone-sheet-half": "docs/design/mockups/phone-sheet-half.html",
} as const;

const html = (file: string) => readFileSync(file, "utf8");

/** the rail/bottom-bar buttons, in document order */
function railLabels(source: string): string[] {
  return [...source.matchAll(/<button[^>]*class="hexbtn[^"]*"[^>]*>/g)].map((m) => {
    const label = m[0].match(/aria-label="([^"]+)"/);
    return label ? label[1] : "(unlabelled)";
  });
}

/** attributes of one button, by its accessible name */
function buttonAttrs(source: string, label: string): string {
  const m = source.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
  if (!m) throw new Error(`no button labelled "${label}"`);
  return m[0];
}

describe("the rail is five tools, the same five everywhere", () => {
  for (const [name, file] of Object.entries(SURFACES)) {
    it(`${name}: ${RAIL.join(" · ")}`, () => {
      expect(railLabels(html(file))).toEqual(RAIL);
    });
  }

  it("has no Help button in the rail — Help lives in the top bar only", () => {
    for (const file of Object.values(SURFACES)) {
      const source = html(file);
      expect(railLabels(source)).not.toContain("Help");
      // ...and the two desktop surfaces do offer it in the top bar
      if (file.includes("desktop")) expect(source).toMatch(/aria-label="Help[^"]*"/);
    }
  });

  it("has no species/fish rail button (the lens switch and search carry that)", () => {
    for (const file of Object.values(SURFACES)) {
      expect(railLabels(html(file))).not.toContain("Species info");
      expect(html(file)).not.toMatch(/id="i-species"/);
    }
  });
});

describe("the Flower control is inactive in the Species lens, never removed", () => {
  const species = html(SURFACES["species-desktop"]);

  it("is still present, in its usual third position", () => {
    expect(railLabels(species)[2]).toBe("Flower plot");
  });

  it("is aria-disabled but still focusable (no `disabled`, no tabindex=-1)", () => {
    const btn = buttonAttrs(species, "Flower plot");
    expect(btn).toMatch(/aria-disabled="true"/);
    expect(btn).not.toMatch(/\sdisabled/);
    expect(btn).not.toMatch(/tabindex="-1"/);
  });

  it("says why, in a tooltip", () => {
    expect(species).toMatch(/Flower plot — Scores only/);
  });

  it("is NOT disabled in the Scores lens", () => {
    expect(buttonAttrs(html(SURFACES["scores-desktop"]), "Flower plot")).not.toMatch(
      /aria-disabled/,
    );
  });
});

describe("every floating surface has collapse · half · full in its upper right", () => {
  for (const [name, file] of Object.entries(SURFACES)) {
    it(`${name} carries the three size controls, wired to the body it hides`, () => {
      const source = html(file);
      const start = source.indexOf('class="panel-controls"');
      expect(start, `${name} has no .panel-controls group`).toBeGreaterThan(-1);
      const g = source.slice(
        start,
        source.indexOf("</div>", source.lastIndexOf("</button>", start + 2000)) + 6,
      );
      // exactly three controls, in order: collapse, then half, then full
      const buttons = [...g.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) => m[0]);
      expect(buttons).toHaveLength(3);
      const labels = buttons.map((b) => b.match(/aria-label="([^"]+)"/)![1]);
      expect(labels[0]).toMatch(/^Collapse to a (pill|peek)$/);
      expect(labels[1]).toBe("Half height");
      expect(labels[2]).toBe("Full height");
      // the collapse control is the disclosure: it owns aria-expanded + aria-controls
      expect(g).toMatch(/aria-expanded="true"/);
      const controls = g.match(/aria-controls="([^"]+)"/);
      expect(controls, `${name}: the collapse control names no region`).not.toBeNull();
      expect(source).toMatch(new RegExp(`id="${controls![1]}"`));
      // exactly one detent is current
      expect([...g.matchAll(/aria-pressed="true"/g)]).toHaveLength(1);
    });
  }
});

describe("the protection chips read correctly for the species on the card", () => {
  it("shows MMPA as not applicable for a turtle, like MBTA (Ben, 2026-09-21)", () => {
    const species = html(SURFACES["species-desktop"]);
    expect(species).toMatch(/MMPA · not applicable/);
    expect(species).toMatch(/MBTA · not applicable/);
    expect(species).not.toMatch(/MMPA · floor/);
  });
});
