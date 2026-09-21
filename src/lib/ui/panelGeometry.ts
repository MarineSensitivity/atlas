// atlas-3 spec.md §5.3: a panel/sheet's collapse state and half/full detent are chrome, not view
// state -- remembered per VIEWPORT SIZE in localStorage, never the URL (spec.md §5.3, and this
// repo's URL-is-the-view rule in CLAUDE.md, which this deliberately does NOT feed into). Pure and
// storage-injectable so the persistence rule is unit-tested without a real browser.
export type Detent = "half" | "full";
export type ViewportBucket = "phone" | "desktop";

/** spec.md §10: the one `matchMedia("(max-width: 899px)")` switch the whole app uses. */
export function viewportBucket(widthPx: number): ViewportBucket {
  return widthPx < 900 ? "phone" : "desktop";
}

export function panelStorageKey(panelId: string, bucket: ViewportBucket): string {
  return `atlas.panel.${panelId}.${bucket}`;
}

export interface PanelGeometry {
  collapsed: boolean;
  detent: Detent;
}

export const DEFAULT_PANEL_GEOMETRY: PanelGeometry = { collapsed: false, detent: "half" };

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function isDetent(value: unknown): value is Detent {
  return value === "half" || value === "full";
}

/** Reads a panel's remembered geometry. Never throws: a missing key, malformed JSON, a storage
 * that is unavailable (private mode, SSR, quota) or a value that fails the shape check all fall
 * back to the default geometry -- this is chrome, so losing it is never a correctness bug. */
export function loadPanelGeometry(
  storage: ReadableStorage | null | undefined,
  panelId: string,
  bucket: ViewportBucket,
): PanelGeometry {
  if (!storage) return DEFAULT_PANEL_GEOMETRY;
  try {
    const raw = storage.getItem(panelStorageKey(panelId, bucket));
    if (!raw) return DEFAULT_PANEL_GEOMETRY;
    const parsed = JSON.parse(raw) as Partial<PanelGeometry> | null;
    if (parsed && typeof parsed.collapsed === "boolean" && isDetent(parsed.detent)) {
      return { collapsed: parsed.collapsed, detent: parsed.detent };
    }
    return DEFAULT_PANEL_GEOMETRY;
  } catch {
    return DEFAULT_PANEL_GEOMETRY;
  }
}

/** Saves a panel's geometry. Never throws (localStorage can throw under quota or private mode --
 * this is chrome-only convenience, never required for correctness). */
export function savePanelGeometry(
  storage: WritableStorage | null | undefined,
  panelId: string,
  bucket: ViewportBucket,
  geometry: PanelGeometry,
): void {
  if (!storage) return;
  try {
    storage.setItem(panelStorageKey(panelId, bucket), JSON.stringify(geometry));
  } catch {
    // chrome, not correctness -- see above
  }
}
