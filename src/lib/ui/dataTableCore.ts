// atlas-3 step 2b: DataTable's pure logic -- sorting, filtering and the virtualization window's
// arithmetic -- kept out of the component so each rule has its own unit test (CLAUDE.md: core
// logic lives in an exported function; a component only calls it).
export interface DataTableColumn<T> {
  key: string;
  label: string;
  /** the raw underlying value (may be a number, a string, null, ...) */
  value: (row: T) => unknown;
  /** the DISPLAY string for this cell -- what the user actually reads. Optional; defaults to
   * `String(value(row))`. See `filterRows()`'s header comment for why this is what filtering
   * matches against, not the raw value. */
  format?: (row: T) => string;
  sortable?: boolean;
  /** numeric columns compare with plain subtraction (never string/locale compare -- see
   * `compareValues()`), so "10" never sorts before "9". */
  numeric?: boolean;
}

export type SortDirection = "asc" | "desc" | null;

export interface SortState {
  columnKey: string | null;
  direction: SortDirection;
}

/**
 * Compares two already-known-non-null values. Numeric columns use plain subtraction -- not
 * `localeCompare` or string comparison -- so the result never depends on the runtime's locale and
 * never sorts "10" before "9" (both seeded faults this function exists to make impossible).
 * Non-numeric columns compare ordinally (`<`/`>`), also locale-independent.
 */
export function compareValues(a: unknown, b: unknown, numeric: boolean | undefined): number {
  if (numeric) {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
    if (Number.isNaN(an)) return 1;
    if (Number.isNaN(bn)) return -1;
    return an - bn;
  }
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/**
 * PURE, STABLE sort. `direction === null` (or no sortable column) returns the rows in their
 * original order (a fresh copy). Null/undefined VALUES always sort to the end, in EITHER
 * direction -- a deliberate, tested rule (not merely "whatever falls out of the comparator"), so a
 * later edit cannot silently flip nulls to the top under `desc`. Ties (including ties among
 * multiple nulls) keep their original relative order.
 */
export function sortRows<T>(
  rows: readonly T[],
  column: DataTableColumn<T> | undefined,
  direction: SortDirection,
): T[] {
  if (!column || !direction) return [...rows];
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const av = column.value(a.row);
    const bv = column.value(b.row);
    const aNull = av === null || av === undefined;
    const bNull = bv === null || bv === undefined;
    if (aNull || bNull) {
      if (aNull && bNull) return a.index - b.index; // stable among nulls
      return aNull ? 1 : -1; // nulls last, regardless of direction
    }
    const cmp = compareValues(av, bv, column.numeric);
    const signed = direction === "asc" ? cmp : -cmp;
    return signed !== 0 ? signed : a.index - b.index; // stable tie-break
  });
  return indexed.map((w) => w.row);
}

export type FilterState = Readonly<Record<string, string>>;

/**
 * PURE filter. Matches against each column's FORMATTED display value (`format(row)`, falling back
 * to `String(value(row))`), NOT the raw underlying value -- a user filters on what they can see on
 * screen ("50%"), not on a raw fraction they never see (0.5). This is a deliberate, documented
 * choice (not an accident of implementation), and `dataTableCore.test.ts` has a regression case
 * proving it: filtering by the formatted text matches, filtering by the raw value does not.
 * Case-insensitive substring match; multiple active column filters are ANDed together.
 */
export function filterRows<T>(
  rows: readonly T[],
  columns: readonly DataTableColumn<T>[],
  filters: FilterState,
): T[] {
  const active = columns
    .map((col) => ({ col, needle: (filters[col.key] ?? "").trim().toLowerCase() }))
    .filter((f) => f.needle.length > 0);
  if (active.length === 0) return [...rows];
  return rows.filter((row) =>
    active.every(({ col, needle }) => {
      const display = (col.format ? col.format(row) : String(col.value(row) ?? "")).toLowerCase();
      return display.includes(needle);
    }),
  );
}

export interface VisibleWindow {
  /** first row index to render (inclusive) */
  startIndex: number;
  /** one past the last row index to render (exclusive) */
  endIndex: number;
  /** px of blank space above the rendered rows, standing in for the rows scrolled past */
  paddingTop: number;
  /** px of blank space below the rendered rows, standing in for the rows not yet reached */
  paddingBottom: number;
}

/**
 * PURE virtualization-window arithmetic: which row indices to actually render for a given scroll
 * position, plus the top/bottom spacer heights that keep the scrollbar's total size correct. This
 * is what makes 10k rows smooth -- only `endIndex - startIndex` rows (viewport height / row height,
 * plus overscan on both sides) are ever in the DOM at once.
 */
export function computeVisibleWindow(opts: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  totalRows: number;
  overscan?: number;
}): VisibleWindow {
  const { scrollTop, viewportHeight, rowHeight, totalRows, overscan = 4 } = opts;
  if (totalRows <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const rawStart = Math.floor(scrollTop / rowHeight) - overscan;
  const startIndex = Math.max(0, rawStart);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(totalRows, startIndex + visibleCount);
  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: (totalRows - endIndex) * rowHeight,
  };
}

/**
 * PURE: the scrollTop that brings `row` into view (the minimal scroll adjustment -- "scroll into
 * view, nearest edge" semantics), clamped to the scrollable range. Used by keyboard cell navigation
 * so PageUp/PageDown/arrow-key moves that leave the rendered window still land the newly-active
 * cell somewhere visible.
 */
export function scrollTopForRow(
  row: number,
  currentScrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
): number {
  const rowTop = row * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const maxScroll = Math.max(0, totalRows * rowHeight - viewportHeight);
  let next = currentScrollTop;
  if (rowTop < currentScrollTop) next = rowTop;
  else if (rowBottom > currentScrollTop + viewportHeight) next = rowBottom - viewportHeight;
  return Math.min(maxScroll, Math.max(0, next));
}

export interface CellPosition {
  row: number;
  col: number;
}

/**
 * PURE roving-cell-navigation math: the next active cell for a keydown, or `null` if the key does
 * not move the active cell (the caller lets the event fall through). Clamps at the grid's edges
 * (never wraps) for arrows/PageUp/PageDown; Home/End move within the CURRENT row only (first/last
 * column), matching the common data-grid convention.
 */
export function nextCellPosition(
  current: CellPosition,
  key: string,
  rowCount: number,
  colCount: number,
  pageSize = 10,
): CellPosition | null {
  if (rowCount <= 0 || colCount <= 0) return null;
  const clampRow = (r: number) => Math.min(rowCount - 1, Math.max(0, r));
  const clampCol = (c: number) => Math.min(colCount - 1, Math.max(0, c));
  switch (key) {
    case "ArrowUp":
      return { row: clampRow(current.row - 1), col: current.col };
    case "ArrowDown":
      return { row: clampRow(current.row + 1), col: current.col };
    case "ArrowLeft":
      return { row: current.row, col: clampCol(current.col - 1) };
    case "ArrowRight":
      return { row: current.row, col: clampCol(current.col + 1) };
    case "Home":
      return { row: current.row, col: 0 };
    case "End":
      return { row: current.row, col: colCount - 1 };
    case "PageUp":
      return { row: clampRow(current.row - pageSize), col: current.col };
    case "PageDown":
      return { row: clampRow(current.row + pageSize), col: current.col };
    default:
      return null;
  }
}

// atlas-3 step 4 fix round 1 (SC 1.3.1 / 4.1.2): the grid has TWO header rows in the DOM (the
// sortable column-label row, then the per-column filter row) -- aria-rowcount/aria-rowindex must
// count both, or a screen reader's row-position announcement ("row 1 of 10,000") is off by two
// for every data row and never accounts for the headers at all. The seeded fault this replaces:
// aria-rowcount was `sortedRows.length` (data rows only) and the first data row's aria-rowindex
// was 1 (as if it were the very first row in the grid, ahead of both header rows).
export const HEADER_ROW_COUNT = 2;

/** the grid's aria-rowcount: every header row plus every (filtered) data row. */
export function gridRowCount(dataRowCount: number): number {
  return dataRowCount + HEADER_ROW_COUNT;
}

/** a data row's aria-rowindex (1-based, header rows first): data row 0 is index 3 (1: the label
 * row, 2: the filter row, 3: the first data row). */
export function gridRowIndex(dataRowIndex: number): number {
  return dataRowIndex + HEADER_ROW_COUNT + 1;
}

/**
 * The text `announce()` (src/lib/ui/announcer.ts) is given for a row count, locale-fixed to
 * "en-US" so it (and its tests) never depend on the runtime's locale. Names its SUBJECT on the
 * initial load ("Species table loaded, 1,234 rows") -- with several tables and other live
 * components sharing ONE region (spec.md §11), a bare "0 rows" is meaningless without knowing
 * which table. A later filter re-announces without repeating the subject ("Filtered to 0 rows"),
 * matching how a live region is read: the FIRST announcement after mount is the one moment a
 * listener has no other context for what just finished loading.
 */
export function formatRowCountAnnouncement(
  count: number,
  mode: "loaded" | "filtered",
  subject: string,
): string {
  const rows = `${count.toLocaleString("en-US")} row${count === 1 ? "" : "s"}`;
  return mode === "loaded" ? `${subject} loaded, ${rows}` : `Filtered to ${rows}`;
}
