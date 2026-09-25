// atlas-3 step 3: the tool rail's data (spec.md §5.1), extracted out of Shell.svelte into a plain,
// exported module so the rail's own order is callable from a test (CLAUDE.md: "keep core logic in
// an exported function under src/lib/ [or here, src/shell/]... a component only calls it").
// Shell.svelte imports this; nothing here imports svelte. `RailItem` itself is NOT imported from
// src/lib/ui/Rail.svelte here: a plain `tsc` (not svelte-aware) cannot see a `.svelte` file's
// `<script module>` named exports the way svelte-check can -- see this file's git history for the
// error that caused this to be a plain, structurally-matching local type instead.
//
// R3-W8 item 4 (Ben, 2026-09-25): "drop the Flower plot from the toolbar (which only applies to
// the Scores lens)." The Flower plot moved INTO the Layers pane as its second tab (Scores lens:
// "Flower plot"; Species lens: "Species info", same tab slot -- `src/lib/ui/LayersPanel.svelte`'s
// `infoTab` prop) -- the rail dropped from five tools to four.
//
// R3-W8 item 5 (Ben, 2026-09-25, proposed by him and not objected to): "Places folds into the
// Report tool as its first tab." The rail drops to THREE tools -- Places moved INTO the Report
// pane as its own first tab (Shell.svelte's `activeReportTab`), the same two-tab shape item 4 gave
// the Layers pane. Every remaining tool (Layers, Table, Report) stays active in both lenses, so
// `buildRailItems` still needs no lens argument or inactive/inactiveReason concept.
import type { IconName } from "../lib/ui/icon-paths";

export type ToolName = "layers" | "table" | "report";

/** structurally identical to src/lib/ui/Rail.svelte's exported `RailItem` -- Svelte's prop typing
 * accepts this by shape, not by declaration identity. */
export interface ToolRailItem {
  name: ToolName;
  icon: IconName;
  label: string;
}

/** spec.md §5.1: the tool rail is THREE controls, the SAME three, in the SAME order, on every
 * viewport and every lens (R3-W8 item 5 -- was four after item 4, then Places folded into the
 * Report pane as its own first tab). This array's order IS that order -- `buildRailItems` below
 * never reorders it. */
export const TOOL_ORDER: readonly ToolName[] = ["layers", "table", "report"];

export const TOOL_LABEL: Record<ToolName, string> = {
  layers: "Layers",
  table: "Table",
  report: "Report",
};

// This exact sentence, for "layers" only, is duplicated in index.html's static skeleton body (a
// plain string there, since the skeleton predates any bundle) -- tests/shell/tools.test.ts asserts
// the two stay equal, and the CLS gate (e2e/shell.cls.spec.ts) is what proves that equal text also
// means equal painted height.
export const TOOL_BODY: Record<ToolName, string> = {
  layers: "Layers, palette and outline options arrive in a later phase.",
  table: "The species and zone tables arrive in a later phase.",
  report: "The report builder arrives in a later phase.",
};

/** every tool is always active, in both lenses, on every viewport (R3-W8 item 4/5). */
export function buildRailItems(): ToolRailItem[] {
  return TOOL_ORDER.map((name) => ({
    name,
    icon: name,
    label: TOOL_LABEL[name],
  }));
}
