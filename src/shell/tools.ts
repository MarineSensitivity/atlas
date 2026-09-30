// atlas-3 step 3: the tool rail's data (spec.md §5.1), extracted out of Shell.svelte into a plain,
// exported module so the rail's own order is callable from a test (CLAUDE.md: "keep core logic in
// an exported function under src/lib/ [or here, src/shell/]... a component only calls it").
// Shell.svelte imports this; nothing here imports svelte. `RailItem` itself is NOT imported from
// src/lib/ui/Rail.svelte here: a plain `tsc` (not svelte-aware) cannot see a `.svelte` file's
// `<script module>` named exports the way svelte-check can, so `ToolRailItem` is a plain,
// structurally-matching local type instead.
//
// R4-B (owner decision, 2026-09-30, control-grammar.md): the rail is the SPINE -- it changes the
// SURFACE, and it has FOUR entries, in this order, in both lenses and on every viewport:
// Layers - Details - Table - Report. "Details" holds the Flower plot (Scores lens) and the
// species information (Species lens), which used to be the Layers pane's second tab (R3-W8 item
// 4); neither lens needs its own entry (control-grammar rule 7). Every tool is active in both
// lenses, so `buildRailItems` needs no lens argument or inactive/inactiveReason concept.
import type { IconName } from "../lib/ui/icon-paths";

export type ToolName = "layers" | "details" | "table" | "report";

/** structurally identical to src/lib/ui/Rail.svelte's exported `RailItem` -- Svelte's prop typing
 * accepts this by shape, not by declaration identity. */
export interface ToolRailItem {
  name: ToolName;
  icon: IconName;
  label: string;
}

/** spec.md §5.1 / control-grammar.md: the spine is FOUR controls, the SAME four, in the SAME order,
 * on every viewport and every lens. This array's order IS that order -- `buildRailItems` below
 * never reorders it. */
export const TOOL_ORDER: readonly ToolName[] = ["layers", "details", "table", "report"];

export const TOOL_LABEL: Record<ToolName, string> = {
  layers: "Layers",
  details: "Details",
  table: "Table",
  report: "Report",
};

/** one icon per tool, the same in both lenses (R4-B: Details uses the info glyph in Scores and
 * Species alike). Only `layers`/`table`/`report` share their tool's own name as the icon name. */
export const TOOL_ICON: Record<ToolName, IconName> = {
  layers: "layers",
  details: "info",
  table: "table",
  report: "report",
};

// This exact sentence, for "layers" only, is duplicated in index.html's static skeleton body (a
// plain string there, since the skeleton predates any bundle) -- tests/shell/tools.test.ts asserts
// the two stay equal, and the CLS gate (e2e/shell.cls.spec.ts) is what proves that equal text also
// means equal painted height.
export const TOOL_BODY: Record<ToolName, string> = {
  layers: "Layers, palette and outline options arrive in a later phase.",
  details: "Select a cell or an area on the map to see its details.",
  table: "The species and zone tables arrive in a later phase.",
  report: "The report builder arrives in a later phase.",
};

/** every tool is always active, in both lenses, on every viewport. */
export function buildRailItems(): ToolRailItem[] {
  return TOOL_ORDER.map((name) => ({
    name,
    icon: TOOL_ICON[name],
    label: TOOL_LABEL[name],
  }));
}

/** R4-B: whether a tool takes the whole stage (control-grammar rule 5: "Layers, Details and Report
 * open as a side panel; Table takes the whole stage"). One rule, one place -- Shell.svelte hands
 * the result to Panel.svelte's `fullStage`. */
export function toolTakesFullStage(tool: ToolName): boolean {
  return tool === "table";
}

/** R4-B: the panel header names what is being SHOWN, not the spine entry beside it
 * (control-grammar rule 6). Every input is a plain string (or null while unknown) computed by
 * the shell from its own state; the fallbacks are the tool's own label so a header is never
 * blank. */
export interface PanelContext {
  /** Layers: the active layer's name and its unit, e.g. "Score" / "Raster cells". */
  layer: string | null;
  unit: string | null;
  /** Details: the clicked subject's label (Scores) or the species' name (Species). */
  subject: string | null;
  /** Table: its subject line. */
  tableSubject: string | null;
  /** Report: how many places are in the report (0 = none), and the last clicked place's label. */
  placeCount: number;
  lastClicked: string | null;
}

export function panelHeaderTitle(tool: ToolName, ctx: PanelContext): string {
  switch (tool) {
    case "layers":
      return ctx.layer && ctx.unit ? `${ctx.layer} · ${ctx.unit}` : (ctx.layer ?? TOOL_LABEL.layers);
    case "details":
      return ctx.subject ?? TOOL_LABEL.details;
    case "table":
      return ctx.tableSubject ?? TOOL_LABEL.table;
    case "report":
      if (ctx.placeCount > 0) return ctx.placeCount === 1 ? "1 place" : `${ctx.placeCount} places`;
      return ctx.lastClicked ? "Last clicked place" : TOOL_LABEL.report;
  }
}
