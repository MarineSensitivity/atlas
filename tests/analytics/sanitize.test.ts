import { describe, expect, it } from "vitest";
import { sanitizeParams } from "../../src/lib/analytics/sanitize";

describe("sanitizeParams — strips pl/t from any event params (defense in depth)", () => {
  it("passes ordinary params through untouched", () => {
    expect(sanitizeParams({ area: "GEO", n_rows: 5 })).toEqual({ area: "GEO", n_rows: 5 });
  });

  // seeded fault: `pl` or `t` leaking into any analytics payload via the event params.
  it("seeded fault: strips a 'pl' param (a place codec value) even when mixed with legitimate ones", () => {
    const out = sanitizeParams({ pl: "z.pa.1,2,3", area_type: "draw" });
    expect(out).toEqual({ area_type: "draw" });
    expect(out).not.toHaveProperty("pl");
  });

  it("seeded fault: strips a 't' param (a report title) too", () => {
    const out = sanitizeParams({ t: "Sensitive Report Title", format: "pdf" });
    expect(out).toEqual({ format: "pdf" });
    expect(out).not.toHaveProperty("t");
  });

  it("strips both at once and keeps everything else", () => {
    const out = sanitizeParams({ pl: "z.pa.1", t: "title", n_areas: 2 });
    expect(out).toEqual({ n_areas: 2 });
  });

  it("does not mutate the input object", () => {
    const input = { pl: "z.pa.1", ok: true };
    sanitizeParams(input);
    expect(input).toEqual({ pl: "z.pa.1", ok: true });
  });

  it("leaves an object with no forbidden keys equal by value, not by reference", () => {
    const input = { area: "GEO" };
    const out = sanitizeParams(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});
