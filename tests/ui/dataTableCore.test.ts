// atlas-3 step 2b: DataTable's pure sorting/filtering/virtualization/navigation math. Each describe
// block is the seeded-fault gate for one named rule: stable sort, null ordering, locale-independent
// numeric sort ("10" before "9"), and filtering on the formatted vs. raw value.
import { describe, expect, it } from "vitest";
import {
  compareValues,
  computeVisibleWindow,
  type DataTableColumn,
  filterRows,
  formatRowCountAnnouncement,
  gridRowCount,
  gridRowIndex,
  HEADER_ROW_COUNT,
  nextCellPosition,
  scrollTopForRow,
  sortRows,
} from "../../src/lib/ui/dataTableCore";

interface Row {
  id: number;
  name: string;
  score: number | null;
  pct: number; // raw fraction, e.g. 0.5 -- displayed as "50%"
}

const nameCol: DataTableColumn<Row> = { key: "name", label: "Name", value: (r) => r.name };
const scoreCol: DataTableColumn<Row> = {
  key: "score",
  label: "Score",
  value: (r) => r.score,
  numeric: true,
};
const pctCol: DataTableColumn<Row> = {
  key: "pct",
  label: "Percent",
  value: (r) => r.pct,
  format: (r) => `${Math.round(r.pct * 100)}%`,
  numeric: true,
};

describe("compareValues: locale-independent numeric sort (the seeded fault: '10' before '9')", () => {
  it("compares numeric columns by plain subtraction, not string order", () => {
    expect(compareValues(9, 10, true)).toBeLessThan(0);
    expect(compareValues("9", "10", true)).toBeLessThan(0); // even as strings, numeric flag wins
  });

  it("string comparison of '9' vs '10' would give the WRONG answer -- this is the fault itself", () => {
    expect("9" < "10").toBe(false); // '9' > '1' lexicographically -- the bug the numeric flag avoids
  });

  it("non-numeric columns compare ordinally, independent of runtime locale", () => {
    expect(compareValues("a", "b", false)).toBeLessThan(0);
    expect(compareValues("b", "a", false)).toBeGreaterThan(0);
    expect(compareValues("a", "a", false)).toBe(0);
  });
});

describe("sortRows: stability", () => {
  it("rows with equal sort-key values keep their original relative order", () => {
    const rows: Row[] = [
      { id: 1, name: "a", score: 5, pct: 0 },
      { id: 2, name: "b", score: 5, pct: 0 },
      { id: 3, name: "c", score: 5, pct: 0 },
    ];
    const sorted = sortRows(rows, scoreCol, "asc");
    expect(sorted.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("stability holds under desc too", () => {
    const rows: Row[] = [
      { id: 1, name: "a", score: 5, pct: 0 },
      { id: 2, name: "b", score: 5, pct: 0 },
    ];
    expect(sortRows(rows, scoreCol, "desc").map((r) => r.id)).toEqual([1, 2]);
  });

  it("no column / no direction returns a fresh copy in the original order", () => {
    const rows: Row[] = [
      { id: 2, name: "b", score: 1, pct: 0 },
      { id: 1, name: "a", score: 2, pct: 0 },
    ];
    const copy = sortRows(rows, undefined, null);
    expect(copy).toEqual(rows);
    expect(copy).not.toBe(rows);
  });
});

describe("sortRows: null ordering (nulls always last, regardless of direction)", () => {
  const rows: Row[] = [
    { id: 1, name: "a", score: 3, pct: 0 },
    { id: 2, name: "b", score: null, pct: 0 },
    { id: 3, name: "c", score: 1, pct: 0 },
    { id: 4, name: "d", score: null, pct: 0 },
    { id: 5, name: "e", score: 2, pct: 0 },
  ];

  it("ascending: non-null values ascending, nulls at the end (in original relative order)", () => {
    const sorted = sortRows(rows, scoreCol, "asc");
    expect(sorted.map((r) => r.score)).toEqual([1, 2, 3, null, null]);
    expect(sorted.map((r) => r.id)).toEqual([3, 5, 1, 2, 4]);
  });

  it("descending: non-null values descending, nulls STILL at the end (the seeded fault: nulls flip to the top)", () => {
    const sorted = sortRows(rows, scoreCol, "desc");
    expect(sorted.map((r) => r.score)).toEqual([3, 2, 1, null, null]);
    expect(sorted.map((r) => r.id)).toEqual([1, 5, 3, 2, 4]);
  });
});

describe("sortRows: numeric columns never sort as strings", () => {
  it("[9, 10, 2] ascending sorts numerically, not lexicographically", () => {
    const rows: Row[] = [9, 10, 2].map((score, i) => ({ id: i, name: String(i), score, pct: 0 }));
    expect(sortRows(rows, scoreCol, "asc").map((r) => r.score)).toEqual([2, 9, 10]);
  });

  it("a non-numeric column WOULD put '10' before '9' -- confirms the column-level flag is what fixes it", () => {
    const asStrings: DataTableColumn<Row> = { key: "s", label: "s", value: (r) => String(r.score) };
    const rows: Row[] = [9, 10].map((score, i) => ({ id: i, name: String(i), score, pct: 0 }));
    expect(sortRows(rows, asStrings, "asc").map((r) => r.score)).toEqual([10, 9]);
  });
});

describe("filterRows: matches the FORMATTED display value, not the raw value", () => {
  const rows: Row[] = [
    { id: 1, name: "alpha", score: 1, pct: 0.5 },
    { id: 2, name: "beta", score: 2, pct: 0.9 },
  ];

  it("filtering by what the user SEES ('50%') matches the formatted cell", () => {
    expect(filterRows(rows, [pctCol], { pct: "50%" }).map((r) => r.id)).toEqual([1]);
  });

  it("filtering by the RAW underlying value ('0.5') does NOT match -- it is never shown", () => {
    expect(filterRows(rows, [pctCol], { pct: "0.5" })).toEqual([]);
  });

  it("a column with no format() falls back to String(value)", () => {
    expect(filterRows(rows, [nameCol], { name: "alp" }).map((r) => r.id)).toEqual([1]);
  });

  it("is case-insensitive and matches substrings", () => {
    expect(filterRows(rows, [nameCol], { name: "ETA" }).map((r) => r.id)).toEqual([2]);
  });

  it("ANDs multiple active column filters together", () => {
    expect(filterRows(rows, [nameCol, pctCol], { name: "a", pct: "90%" }).map((r) => r.id)).toEqual(
      [2],
    );
  });

  it("no active filters returns a fresh copy of every row", () => {
    const out = filterRows(rows, [nameCol], { name: "" });
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });
});

describe("computeVisibleWindow", () => {
  it("at scrollTop 0, starts at row 0 (never negative)", () => {
    const w = computeVisibleWindow({
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 32,
      totalRows: 10000,
      overscan: 4,
    });
    expect(w.startIndex).toBe(0);
    expect(w.paddingTop).toBe(0);
  });

  it("scrolled deep into 10k rows: window tracks scrollTop, with overscan on both sides", () => {
    const w = computeVisibleWindow({
      scrollTop: 3200, // row 100
      viewportHeight: 320, // 10 rows visible
      rowHeight: 32,
      totalRows: 10000,
      overscan: 4,
    });
    expect(w.startIndex).toBe(100 - 4);
    expect(w.endIndex).toBe(100 - 4 + 10 + 4 * 2);
    expect(w.paddingTop).toBe(w.startIndex * 32);
    expect(w.paddingBottom).toBe((10000 - w.endIndex) * 32);
  });

  it("fewer rows than the viewport: the whole set renders, paddingBottom is 0", () => {
    const w = computeVisibleWindow({
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 32,
      totalRows: 5,
      overscan: 4,
    });
    expect(w.endIndex).toBe(5);
    expect(w.paddingBottom).toBe(0);
  });

  it("scrolled to the very end: endIndex never exceeds totalRows, paddingBottom is 0", () => {
    const w = computeVisibleWindow({
      scrollTop: 10000 * 32 - 320,
      viewportHeight: 320,
      rowHeight: 32,
      totalRows: 10000,
      overscan: 4,
    });
    expect(w.endIndex).toBe(10000);
    expect(w.paddingBottom).toBe(0);
  });

  it("zero rows renders nothing, without dividing by zero", () => {
    const w = computeVisibleWindow({
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 32,
      totalRows: 0,
    });
    expect(w).toEqual({ startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 });
  });
});

describe("scrollTopForRow", () => {
  it("a row already fully visible needs no scroll change", () => {
    expect(scrollTopForRow(5, 0, 320, 32, 1000)).toBe(0); // row 5 at y=160..192, viewport 0..320
  });

  it("a row above the viewport scrolls up to the row's top", () => {
    expect(scrollTopForRow(2, 500, 320, 32, 1000)).toBe(64); // row 2 top = 64
  });

  it("a row below the viewport scrolls down to the row's bottom minus the viewport height", () => {
    expect(scrollTopForRow(20, 0, 320, 32, 1000)).toBe(20 * 32 + 32 - 320);
  });

  it("clamps at the top", () => {
    expect(scrollTopForRow(0, 500, 320, 32, 1000)).toBe(0);
  });

  it("clamps at the maximum scroll (never scrolls past the last row)", () => {
    const totalRows = 10;
    const max = totalRows * 32 - 320 > 0 ? totalRows * 32 - 320 : 0;
    expect(scrollTopForRow(9, 0, 320, 32, totalRows)).toBe(max);
  });
});

describe("nextCellPosition: keyboard cell navigation", () => {
  it("arrow keys move by one cell, clamped at the grid edges (no wrap)", () => {
    expect(nextCellPosition({ row: 2, col: 2 }, "ArrowUp", 5, 5)).toEqual({ row: 1, col: 2 });
    expect(nextCellPosition({ row: 2, col: 2 }, "ArrowDown", 5, 5)).toEqual({ row: 3, col: 2 });
    expect(nextCellPosition({ row: 2, col: 2 }, "ArrowLeft", 5, 5)).toEqual({ row: 2, col: 1 });
    expect(nextCellPosition({ row: 2, col: 2 }, "ArrowRight", 5, 5)).toEqual({ row: 2, col: 3 });
    expect(nextCellPosition({ row: 0, col: 0 }, "ArrowUp", 5, 5)).toEqual({ row: 0, col: 0 });
    expect(nextCellPosition({ row: 4, col: 4 }, "ArrowDown", 5, 5)).toEqual({ row: 4, col: 4 });
  });

  it("Home/End move within the current row to the first/last column", () => {
    expect(nextCellPosition({ row: 2, col: 3 }, "Home", 5, 8)).toEqual({ row: 2, col: 0 });
    expect(nextCellPosition({ row: 2, col: 3 }, "End", 5, 8)).toEqual({ row: 2, col: 7 });
  });

  it("PageUp/PageDown move by the page size, clamped", () => {
    expect(nextCellPosition({ row: 5, col: 0 }, "PageDown", 100, 3, 10)).toEqual({
      row: 15,
      col: 0,
    });
    expect(nextCellPosition({ row: 5, col: 0 }, "PageUp", 100, 3, 10)).toEqual({ row: 0, col: 0 });
  });

  it("an unrecognized key returns null (caller lets the event fall through)", () => {
    expect(nextCellPosition({ row: 0, col: 0 }, "Tab", 5, 5)).toBeNull();
  });

  it("an empty grid returns null for every key", () => {
    expect(nextCellPosition({ row: 0, col: 0 }, "ArrowDown", 0, 0)).toBeNull();
  });
});

describe("formatRowCountAnnouncement", () => {
  it("names its subject on the initial load, with a thousands separator, locale-fixed to en-US", () => {
    expect(formatRowCountAnnouncement(1234, "loaded", "Species table")).toBe(
      "Species table loaded, 1,234 rows",
    );
  });

  it("singular for exactly 1 row, loaded", () => {
    expect(formatRowCountAnnouncement(1, "loaded", "Species table")).toBe(
      "Species table loaded, 1 row",
    );
  });

  it("a filter re-announcement does not repeat the subject (the seeded fault: a bare '0 rows')", () => {
    expect(formatRowCountAnnouncement(0, "filtered", "Species table")).toBe("Filtered to 0 rows");
  });

  it("singular for exactly 1 row, filtered", () => {
    expect(formatRowCountAnnouncement(1, "filtered", "Species table")).toBe("Filtered to 1 row");
  });
});

describe("gridRowCount / gridRowIndex (SC 1.3.1 / 4.1.2: count and index include BOTH header rows)", () => {
  it("HEADER_ROW_COUNT is 2 (the label row, then the filter row)", () => {
    expect(HEADER_ROW_COUNT).toBe(2);
  });

  it("aria-rowcount is data rows PLUS the two header rows -- the seeded fault: data rows alone", () => {
    expect(gridRowCount(10_000)).toBe(10_002);
    expect(gridRowCount(0)).toBe(2); // still both header rows, even with zero data rows
  });

  it("the first data row's aria-rowindex is 3, after both header rows -- the seeded fault: 1", () => {
    expect(gridRowIndex(0)).toBe(3);
  });

  it("aria-rowindex increases one-for-one with the data row index", () => {
    expect(gridRowIndex(1)).toBe(4);
    expect(gridRowIndex(9)).toBe(12);
  });
});
