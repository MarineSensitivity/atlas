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
