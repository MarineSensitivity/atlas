import { describe, expect, it } from "vitest";
import { slugStem, toCsv } from "../../src/places/csv";

// P8 item 4: `DataTable.svelte` always renders "Export CSV" and calls `onExport?.(rows)`, but
// `ResultsPanel.svelte` used to pass NEITHER of its two DataTables an `onExport` -- the button was
// silently dead (Opus docs review, app finding #5). This file proves the pure half (`toCsv`,
// `slugStem`); the wiring itself (the button now actually triggers a download in the real panel)
// is `e2e/places.spec.ts`'s job -- a hook that exists but is never called cannot be caught by a
// unit test of the hook alone.
describe("toCsv", () => {
  interface Row {
    name: string;
    score: number;
  }
  const columns = [
    { key: "name", value: (r: Row) => r.name },
    { key: "score", value: (r: Row) => r.score },
  ];

  it("header + one row per record, RAW values (never a formatted display string)", () => {
    const rows: Row[] = [
      { name: "gull", score: 27.842 },
      { name: "cod", score: 12 },
    ];
    expect(toCsv(rows, columns)).toBe("name,score\r\ngull,27.842\r\ncod,12\r\n");
  });

  it("quotes a field containing a comma, a quote, or a newline (RFC 4180), doubling embedded quotes", () => {
    const rows = [{ name: 'Gulf "of" America, allegedly', score: 1 }];
    expect(toCsv(rows, columns)).toBe('name,score\r\n"Gulf ""of"" America, allegedly",1\r\n');
  });

  it("null/undefined values become an empty field, not the literal string 'null'", () => {
    const rows = [{ name: "x", score: Number.NaN }];
    const cols = [
      { key: "name", value: () => null },
      { key: "score", value: () => undefined },
    ];
    expect(toCsv(rows, cols)).toBe("name,score\r\n,\r\n");
  });

  it("an empty row set is still the header line alone", () => {
    expect(toCsv([], columns)).toBe("name,score\r\n");
  });
});

describe("slugStem", () => {
  it("lowercases and hyphenates a normal place name", () => {
    expect(slugStem("My Draw 1")).toBe("my-draw-1");
  });

  it("collapses a run of non-alphanumeric characters to one hyphen, trims leading/trailing ones", () => {
    expect(slugStem("  Gulf of America / Study Box!!  ")).toBe("gulf-of-america-study-box");
  });

  it("falls back to the default for a name that yields nothing at all", () => {
    expect(slugStem("")).toBe("place");
    expect(slugStem("   ")).toBe("place");
    expect(slugStem("★★★")).toBe("place");
  });

  it("a caller-chosen fallback is honoured", () => {
    expect(slugStem("", "species")).toBe("species");
  });
});
