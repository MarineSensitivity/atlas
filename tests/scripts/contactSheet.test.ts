// R4-0: the pure tile-list -> HTML step behind eyes-shots.mjs's SHEET=1.
import { describe, expect, it } from "vitest";
import { contactSheetHtml, paginate, tilesPerRow } from "../../scripts/contact-sheet.mjs";

const mk = (n: number, missedAt = -1) =>
  Array.from({ length: n }, (_, i) => ({
    name: `${String(i + 1).padStart(2, "0")}-state${i === missedAt ? "-MISSED" : ""}`,
    src: `file:///x/${i}.png`,
  }));

describe("contact sheet html", () => {
  it("labels every tile with its state name", () => {
    const h = contactSheetHtml(mk(3), "desktop");
    for (const n of ["01-state", "02-state", "03-state"]) expect(h).toContain(`<figcaption>${n}`);
  });
  it("marks a -MISSED shot with a red-border class and a MISSED label, and only that one", () => {
    const h = contactSheetHtml(mk(3, 1), "phone");
    expect(h.match(/class="tile missed"/g)).toHaveLength(1);
    expect(h.match(/>MISSED</g)).toHaveLength(1);
  });
  it("wraps rows: a 2400px cap gives 4 desktop / 8 phone columns", () => {
    expect(tilesPerRow("desktop")).toBe(4);
    expect(tilesPerRow("phone")).toBe(8);
    expect(contactSheetHtml(mk(10), "desktop")).toContain('data-cols="4"');
    expect(contactSheetHtml(mk(2), "desktop")).toContain('data-cols="2"');
  });
  it("paginates past 24 tiles", () => {
    expect(paginate(mk(24))).toHaveLength(1);
    expect(paginate(mk(25)).map((p: unknown[]) => p.length)).toEqual([24, 1]);
  });
});
