// R3-W2: `MenuItem`'s own plain module, separate from `Menu.svelte`. A type re-exported from a
// `.svelte` file's instance script is compiler-dependent (this repo has no existing precedent for
// `import { type X } from "./Component.svelte"` -- `Select.svelte`'s own `SelectOption` is never
// imported anywhere, only the component default is) -- keeping the shape here, a plain `.ts` file,
// is the same "core logic/types live under `src/lib/`, a component only calls it" rule CLAUDE.md
// already states, applied to a type instead of a function.
import type { IconName } from "./icon-paths";

export interface MenuItem {
  id: string;
  label: string;
  /** a short secondary line under the label (e.g. why an item is disabled, or its file type). */
  hint?: string;
  icon?: IconName;
  disabled?: boolean;
  /** an item with `href` renders as a real `<a target="_blank">` (never a `run`-only fake link --
   * TopBarActions.svelte's own "Docs"/"Feedback" items follow the same rule); one with `onSelect`
   * runs it and then closes the menu. */
  href?: string;
  onSelect?: () => void;
}
