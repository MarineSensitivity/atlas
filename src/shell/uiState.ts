// R3-W8 item 3 (Ben, 2026-09-25): "when clicking Share, the link should include all the same UI
// elements in their arrangement, eg on Layers pane." Most of what Ben means is already URL state
// (`Sel`'s own `unit`/`lyr`/`pal`/`sp`/`in`/`rep`/`zl`/`out` etc.) — this module covers only the
// remaining CHROME pieces that `panelGeometry.ts`'s own U1 rule ("layout is chrome, never the
// URL") deliberately keeps out of `Sel`/`history.replaceState`: which tool is open, the desktop
// panel's dock+size (or the phone sheet's detent), the Layers pane's own expanded row, and (item 4)
// which of the Layers pane's own two TABS is showing.
//
// This is a SEPARATE token (`ui=`), written ONLY when Share builds its link (Shell.svelte's
// `onShare`) and read ONLY once, at boot (Shell.svelte's own mount) — never through
// `formatSel`/`parseSel`/`history.replaceState`, so U1's rule holds exactly as before: an ordinary
// panel drag, dock change or tab switch never touches the URL. Versioned like the places codec
// (`g1`, plan D8): `ui=2.<tool>.<dock>.<size>.<detent>.<expandedRow>.<tab>`. Unknown/malformed
// (wrong version, wrong field count, an out-of-range value, an unrecognized code) is ignored
// ENTIRELY — never a partial apply, matching `codec.ts`'s own "clamp to absent, never throw" rule.
//
// R3-W8 item 4: "an old `?tool=flower` ... must still open the Layers pane on the Flower tab" --
// the only place a "tool" was EVER encoded in a link is this very token (item 3's own `tool` field;
// `activeTool` itself has never been ordinary `Sel`/URL-query state, so there never was a real
// `?tool=flower` query key to rewrite in `src/lib/state/legacy.ts`, which only ever rewrites `Sel`
// keys). A version-1 token built before this item landed could still name the now-retired "flower"
// rail tool as its `tool` code (`f`) -- `parseUi` keeps a SEPARATE, version-1-only decode path
// (`parseUiV1`) that recognizes that one legacy code and maps it to `{tool: "layers", tab: "info"}`
// (any other v1 tool code maps normally, with `tab` defaulting to "layers" -- there was no tab
// concept in v1 at all). A v2 token is decoded structurally instead (7 fields, `tab` explicit).
//
// Plain, Node-testable module (no svelte, no DOM) — `tests/state/invariants.test.ts`'s "no module
// in src/lib imports svelte" gate does not reach `src/shell/` (this file is a sibling of
// `tools.ts`, which is the same kind of plain data module for the same reason).
import type { Dock } from "../lib/ui/panelGeometry";
import { PANEL_SIZE_MAX, PANEL_SIZE_MIN, clampPanelSize } from "../lib/ui/panelGeometry";
import type { SheetDetent } from "../lib/ui/sheetGeometry";
import type { ToolName } from "./tools";

export const UI_TOKEN_VERSION = "2";

/** the Layers pane's own two expandable rows (`LayersPanel.svelte`'s `DATA_ROW_ID`/`ZONES_ROW_ID`
 * string literals, duplicated here rather than imported — importing a `.svelte` file's module
 * script from a plain `.ts` file is the same friction `shell/tools.ts`'s own header already
 * documents for `RailItem`). `null` = neither row expanded. */
export type UiExpandedRow = "data-raster" | "data-zones" | null;

/** R3-W8 item 4: the Layers pane's own two TABS -- "layers" (the interactive controls) and "info"
 * (the Scores lens' Flower plot / the Species lens' Species info — `LayersPanel.svelte`'s
 * `infoTab`). Only meaningful while `tool === "layers"`, but carried unconditionally (like `size`/
 * `detent` above) so a recipient who opens the link on a different tool, then clicks Layers, still
 * lands on the tab the sharer had open. */
export type UiTab = "layers" | "info";

export interface UiState {
  tool: ToolName;
  dock: Dock;
  /** desktop panel size, in px (`PANEL_SIZE_MIN`..`PANEL_SIZE_MAX`) — carried even when the viewer
   * shares from the phone, so a recipient who opens the link on desktop still gets a real size,
   * not just the default. Symmetric with `detent` below. */
  size: number;
  /** phone sheet detent — carried even when the viewer shares from desktop, for the same reason. */
  detent: SheetDetent;
  expandedRow: UiExpandedRow;
  tab: UiTab;
}

const TOOL_CODE: Record<ToolName, string> = {
  layers: "l",
  places: "p",
  table: "t",
  report: "r",
};
const CODE_TOOL: Partial<Record<string, ToolName>> = Object.fromEntries(
  Object.entries(TOOL_CODE).map(([tool, code]) => [code, tool as ToolName]),
);

const DOCK_CODE: Record<Dock, string> = { left: "l", right: "r", bottom: "b" };
const CODE_DOCK: Partial<Record<string, Dock>> = { l: "left", r: "right", b: "bottom" };

const DETENT_CODE: Record<SheetDetent, string> = { peek: "p", half: "h", full: "f" };
const CODE_DETENT: Partial<Record<string, SheetDetent>> = { p: "peek", h: "half", f: "full" };

const ROW_CODE: Record<Exclude<UiExpandedRow, null>, string> = {
  "data-raster": "d",
  "data-zones": "z",
};
const CODE_ROW: Partial<Record<string, UiExpandedRow>> = {
  d: "data-raster",
  z: "data-zones",
  n: null,
};

const TAB_CODE: Record<UiTab, string> = { layers: "l", info: "i" };
const CODE_TAB: Partial<Record<string, UiTab>> = { l: "layers", i: "info" };

const INT_RE = /^\d+$/;

function parsePanelSize(sizeStr: string): number | null {
  if (!INT_RE.test(sizeStr)) return null;
  const size = Number(sizeStr);
  return size < PANEL_SIZE_MIN || size > PANEL_SIZE_MAX ? null : size;
}

/** Serialize a `UiState` to the `ui=` token's own value (no leading `ui=`, no `?`/`&`). Every
 * field is a fixed-position code — there is no "omit the default" rule here (unlike `formatSel`):
 * the token is only ever built once, at Share time, from the FULL live state, so there is nothing
 * to compare against a default. Always writes the CURRENT version (2) — only `parseUi` keeps a
 * read path for the retired version 1. */
export function formatUi(ui: UiState): string {
  const size = clampPanelSize(ui.size);
  const row = ui.expandedRow ? ROW_CODE[ui.expandedRow] : "n";
  return [
    UI_TOKEN_VERSION,
    TOOL_CODE[ui.tool],
    DOCK_CODE[ui.dock],
    size,
    DETENT_CODE[ui.detent],
    row,
    TAB_CODE[ui.tab],
  ].join(".");
}

/** version-2 decode: 7 fields, structural — see `formatUi`. */
function parseUiV2(parts: string[]): UiState | null {
  if (parts.length !== 7) return null;
  const [, toolCode, dockCode, sizeStr, detentCode, rowCode, tabCode] = parts;
  const tool = CODE_TOOL[toolCode];
  const dock = CODE_DOCK[dockCode];
  const detent = CODE_DETENT[detentCode];
  const tab = CODE_TAB[tabCode];
  if (!tool || !dock || !detent || !tab) return null;
  if (!(rowCode in CODE_ROW)) return null;
  const size = parsePanelSize(sizeStr);
  if (size === null) return null;
  return { tool, dock, size, detent, expandedRow: CODE_ROW[rowCode] ?? null, tab };
}

/** version-1 decode (retired by item 4, kept read-only): 6 fields, and the tool code "f" named the
 * since-removed "flower" rail tool — mapped forward to `{tool: "layers", tab: "info"}` so an old
 * link keeps opening the SAME thing it used to (the flower plot), just through today's shape (the
 * Layers pane's second tab, not its own rail tool). Every other v1 tool code maps straight across,
 * with `tab` defaulting to "layers" (v1 had no tab concept). */
function parseUiV1(parts: string[]): UiState | null {
  if (parts.length !== 6) return null;
  const [, toolCode, dockCode, sizeStr, detentCode, rowCode] = parts;
  const dock = CODE_DOCK[dockCode];
  const detent = CODE_DETENT[detentCode];
  if (!dock || !detent) return null;
  if (!(rowCode in CODE_ROW)) return null;
  const size = parsePanelSize(sizeStr);
  if (size === null) return null;
  const expandedRow = CODE_ROW[rowCode] ?? null;
  if (toolCode === "f") return { tool: "layers", dock, size, detent, expandedRow, tab: "info" };
  const tool = CODE_TOOL[toolCode];
  if (!tool) return null;
  return { tool, dock, size, detent, expandedRow, tab: "layers" };
}

/** Parse a `ui=` value. `null` (never a partial `UiState`) on ANY malformed input — wrong version,
 * wrong field count, an unrecognized code, an out-of-range size — so a caller never has to guess
 * which fields are trustworthy; it is all or nothing, the same shape `parseMapView`'s own "any
 * non-numeric field is malformed, clamp the WHOLE field to undefined" rule follows one level up. */
export function parseUi(v: string | null | undefined): UiState | null {
  if (v === null || v === undefined) return null;
  const parts = v.split(".");
  const version = parts[0];
  if (version === UI_TOKEN_VERSION) return parseUiV2(parts);
  if (version === "1") return parseUiV1(parts);
  return null;
}
