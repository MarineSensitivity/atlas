// atlas-3 step 3: the tool rail's data (spec.md §5.1), extracted out of Shell.svelte into a plain,
// exported module so the "five tools, this exact order, Flower fades in the Species lens" rule is
// callable from a test (CLAUDE.md: "keep core logic in an exported function under src/lib/ [or
// here, src/shell/]... a component only calls it"). Shell.svelte imports this; nothing here imports
// svelte. `RailItem` itself is NOT imported from src/lib/ui/Rail.svelte here: a plain `tsc` (not
// svelte-aware) cannot see a `.svelte` file's `<script module>` named exports the way svelte-check
// can -- see this file's git history for the error that caused this to be a plain, structurally-
// matching local type instead.
import type { IconName } from "../lib/ui/icon-paths";

export type ToolName = "layers" | "places" | "flower" | "table" | "report";

/** structurally identical to src/lib/ui/Rail.svelte's exported `RailItem` -- Svelte's prop typing
 * accepts this by shape, not by declaration identity. */
export interface ToolRailItem {
  name: ToolName;
  icon: IconName;
  label: string;
  inactive?: boolean;
  inactiveReason?: string;
}

/** spec.md §5.1: the tool rail is FIVE controls, the SAME five, in the SAME order, on every
 * viewport. This array's order IS that order -- `buildRailItems` below never reorders it. */
export const TOOL_ORDER: readonly ToolName[] = ["layers", "places", "flower", "table", "report"];

export const TOOL_LABEL: Record<ToolName, string> = {
  layers: "Layers",
  places: "Places",
  flower: "Flower plot",
  table: "Table",
  report: "Report",
};

// This exact sentence, for "layers" only, is duplicated in index.html's static skeleton body (a
// plain string there, since the skeleton predates any bundle) -- tests/shell/tools.test.ts asserts
// the two stay equal, and the CLS gate (e2e/shell.cls.spec.ts) is what proves that equal text also
// means equal painted height.
export const TOOL_BODY: Record<ToolName, string> = {
  layers: "Layers, palette and outline options arrive in a later phase.",
  places: "Select, draw and upload tools arrive in a later phase.",
  flower: "The flower plot arrives once a place is selected, in a later phase.",
  table: "The species and zone tables arrive in a later phase.",
  report: "The report builder arrives in a later phase.",
};

/** spec.md §5.2: the Flower control fades in place (`aria-disabled`, never removed) in the Species
 * lens; every other tool is always active. The return type annotation is what lets the literal
 * icon names below narrow to `IconName` without a cast. */
export function buildRailItems(lensIsSpecies: boolean): ToolRailItem[] {
  return TOOL_ORDER.map((name) => ({
    name,
    icon: name,
    label: TOOL_LABEL[name],
    ...(name === "flower" && lensIsSpecies
      ? { inactive: true, inactiveReason: "Flower plot — Scores only" }
      : {}),
  }));
}
