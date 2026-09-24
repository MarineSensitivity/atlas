// atlas-3 spec.md §5.3/§10: the phone bottom sheet has THREE detents (peek / half / full),
// unlike Panel's two (half / full) plus a separate collapsed-to-a-pill boolean -- peek keeps the
// sheet's own header visible (grab handle, title), so it is a real third detent rather than a
// swap to a different component. Same persistence shape as src/lib/ui/panelGeometry.ts (chrome,
// per viewport size, never the URL), kept as its own small module so Sheet's three-state model
// never has to be shoehorned into Panel's two-state one.
export type SheetDetent = "peek" | "half" | "full";

export function sheetStorageKey(sheetId: string): string {
  // the sheet only ever exists below the phone breakpoint (spec.md §10), so unlike a panel's
  // geometry it needs no per-viewport-bucket key
  return `atlas.sheet.${sheetId}`;
}

export const DEFAULT_SHEET_DETENT: SheetDetent = "half";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function isSheetDetent(value: unknown): value is SheetDetent {
  return value === "peek" || value === "half" || value === "full";
}

/** Reads a sheet's remembered detent. Never throws: see panelGeometry.ts's twin for the same
 * fail-to-default rationale (chrome, not correctness). */
export function loadSheetDetent(
  storage: ReadableStorage | null | undefined,
  sheetId: string,
): SheetDetent {
  if (!storage) return DEFAULT_SHEET_DETENT;
  try {
    const raw = storage.getItem(sheetStorageKey(sheetId));
    return isSheetDetent(raw) ? raw : DEFAULT_SHEET_DETENT;
  } catch {
    return DEFAULT_SHEET_DETENT;
  }
}

export function saveSheetDetent(
  storage: WritableStorage | null | undefined,
  sheetId: string,
  detent: SheetDetent,
): void {
  if (!storage) return;
  try {
    storage.setItem(sheetStorageKey(sheetId), detent);
  } catch {
    // chrome, not correctness -- see panelGeometry.ts
  }
}

/** the sheet's current size, as Sheet.svelte reports it (`ongeometry`) -- `height` is the REAL
 * measured `offsetHeight` in px, not a detent-keyed constant, so a caller (Shell.svelte) never has
 * to duplicate `.sheet`'s own `--size-sheet-peek`/`--size-sheet-half`/`detent-full` CSS formula to
 * know where the sheet's top edge currently is. */
export interface SheetGeometry {
  detent: SheetDetent;
  height: number;
}

/** P1 fix (Ben's phone report, 2026-09-24): where the phone legend chip (LegendChip.svelte) should
 * render, given the sheet's current detent. At every detent EXCEPT "full" the chip floats over the
 * map, anchored just above the sheet's measured top edge (Shell.svelte turns `SheetGeometry.height`
 * into a CSS custom property the floating region's `bottom` reads) -- covers "peek" too, since a
 * fixed offset there used to land squarely on the sheet's own header controls (the bug: the chip
 * sat at a FIXED distance from the bottom regardless of detent, so it read as "above the tab bar"
 * only by coincidence at whatever detent was active when that offset was tuned). At "full" there is
 * no room above the sheet to float in (the sheet already reaches its own max height), so the chip
 * instead renders INSIDE the sheet's own header block (Shell.svelte passes it to Sheet's
 * `headerExtra` snippet) -- never over the scrolling body, never over the header buttons. */
export type LegendChipMode = "floating" | "inline";

export function legendChipMode(detent: SheetDetent): LegendChipMode {
  return detent === "full" ? "inline" : "floating";
}
