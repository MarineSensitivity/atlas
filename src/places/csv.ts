// places/csv.ts -- P8 item 4: the Places results' "Export CSV" button did nothing.
// `lib/ui/DataTable.svelte` always renders the button and calls `onExport?.(sortedRows)` on click
// (its own `onExport` prop doc: "the component EMITS the current filtered+sorted rows; it never
// writes a file itself"), but `ResultsPanel.svelte` rendered two DataTables (Components, Species)
// and passed NEITHER an `onExport` -- so the always-visible button was silently a no-op (Opus docs
// review, app finding #5: "`DataTable.svelte:153-162` always renders it, and `ResultsPanel` passes
// no `onExport`"). Fixed here rather than removed: the Table tool's own species CSV
// (`lens/scores/species.ts#toCsv`, out of P8's scope, `src/lens/**`) covers the RELEASE's zone
// species list -- it has no access to a drawn/entered PLACE's own components or species, which
// exist only inside this panel, so there is no other CSV that already covers this data.
//
// RFC 4180 quoting -- the SAME rule `lens/scores/species.ts#toCsv` uses for that other CSV,
// duplicated in miniature here (not imported: this module stays inside `src/places/**`, and P8
// stays out of `src/lens/**` entirely, which another round is actively changing) -- so a
// Places-results export reads exactly like every other CSV this app produces: the RAW value a
// column reports, never its formatted display string, `\r\n` line endings.

/** the minimal shape `toCsv` needs from a `DataTable` column -- `label`/`format`/`numeric`/
 * `sortable` (DataTableColumn's other fields) are simply ignored, so a panel's existing column
 * array can be passed straight through with no second, parallel column list to keep in sync. */
export interface CsvColumn<T> {
  key: string;
  value: (row: T) => unknown;
}

function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** header + one row per record, the RAW (unformatted) value of each column -- pure, so this half
 * is testable without a DOM. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => csvField(c.key)).join(",");
  const lines = rows.map((r) => columns.map((c) => csvField(c.value(r))).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** a filesystem-safe filename stem from free text (a place's own name) -- lowercase, non-alphanumeric
 * runs collapsed to one `-`, no leading/trailing `-`; `"place"` for a name that yields nothing
 * (blank, or entirely punctuation/emoji). */
export function slugStem(name: string, fallback = "place"): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** browser-only side effect (an anchor click) -- the SAME pattern `download.ts#downloadGeoJson`
 * uses, kept separate from the pure builders above so they stay Node-testable. `"{stem}_{YYYY-MM-DD}.csv"`
 * matches `lens/scores/species.ts#csvFilename`'s own convention, so every CSV this app produces
 * names itself the same way. */
export function downloadCsv(csv: string, stem: string, now: Date = new Date()): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stem}_${isoDate(now)}.csv`;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
