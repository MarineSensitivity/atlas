// R4-C: the keyboard rule of `Tabs.svelte` (WAI-ARIA tabs pattern, automatic activation): Left/Right
// wrap, Home/End jump. A thin horizontal wrapper over `roving.ts` so the rule is unit-tested here
// and the component only calls it (CLAUDE.md: logic in an exported function).
import { nextRovingIndex } from "./roving";

/** the index a key press moves a tablist's selection to, or `null` when the key is not ours. */
export function tabsKeyTarget(current: number, count: number, key: string): number | null {
  return nextRovingIndex(current, count, key, "horizontal");
}
