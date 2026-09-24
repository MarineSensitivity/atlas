// atlas-3 spec.md §5.3 / R1 (docs/usability.md §7, the owner's 2026-09-24 decision): a panel's
// dock side, size and collapsed/maximized state are chrome, not view state -- remembered per
// VIEWPORT SIZE in localStorage, never the URL (this repo's URL-is-the-view rule in CLAUDE.md,
// which this deliberately does NOT feed into). Pure and storage-injectable so the persistence rule
// is unit-tested without a real browser.
//
// R1 replaced the old three-button "collapse / half / full" model (0.10.28 and earlier: `detent:
// "half" | "full"`) with one dockable panel: dock left/right/bottom, drag-resize on the map-facing
// edge (320-720 px), and maximize-to-stage (Esc restores). `detent` is gone; `dock`/`size`/
// `maximized` replace it. Every caller of the old shape (Panel.svelte, the shell, the e2e specs)
// moved together in the same change -- there is no migration path for an old stored value, it just
// fails the shape check below and falls back to the default (the same "chrome, not correctness"
// rule this module has always followed for a malformed value).
export type Dock = "left" | "right" | "bottom";
export type ViewportBucket = "phone" | "desktop";

/** spec.md §10: the one `matchMedia("(max-width: 899px)")` switch the whole app uses. */
export function viewportBucket(widthPx: number): ViewportBucket {
  return widthPx < 900 ? "phone" : "desktop";
}

export function panelStorageKey(panelId: string, bucket: ViewportBucket): string {
  return `atlas.panel.${panelId}.${bucket}`;
}

/** the panel's map-facing edge may be dragged/arrow-keyed between these, in CSS px (R1). */
export const PANEL_SIZE_MIN = 320;
export const PANEL_SIZE_MAX = 720;

/** arrow-key resize step, and the Shift-accelerated step (R1: "10 px steps, Shift = 50"). */
export const PANEL_RESIZE_STEP = 10;
export const PANEL_RESIZE_STEP_FAST = 50;

export interface PanelGeometry {
  collapsed: boolean;
  /** true while the panel fills the whole stage (R1 "maximize"); Esc restores it to `dock`/`size`. */
  maximized: boolean;
  dock: Dock;
  /** width in px when `dock` is "left"/"right"; height in px when `dock` is "bottom". */
  size: number;
}

export const DEFAULT_PANEL_GEOMETRY: PanelGeometry = {
  collapsed: false,
  maximized: false,
  dock: "right",
  size: 380,
};

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function isDock(value: unknown): value is Dock {
  return value === "left" || value === "right" || value === "bottom";
}

/** clamps a candidate size into the allowed range -- used both when loading a stored geometry and
 * when resizing live, so a value can never escape the range through either path. */
export function clampPanelSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_PANEL_GEOMETRY.size;
  return Math.min(PANEL_SIZE_MAX, Math.max(PANEL_SIZE_MIN, Math.round(size)));
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
    if (
      parsed &&
      typeof parsed.collapsed === "boolean" &&
      typeof parsed.maximized === "boolean" &&
      isDock(parsed.dock) &&
      typeof parsed.size === "number"
    ) {
      return {
        collapsed: parsed.collapsed,
        maximized: parsed.maximized,
        dock: parsed.dock,
        size: clampPanelSize(parsed.size),
      };
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
