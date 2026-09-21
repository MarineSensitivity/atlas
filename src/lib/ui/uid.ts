// atlas-3 step 4 fix round 1 (SC 4.1.2): several instances of the same component sharing the same
// human-readable label (two HexButtons both named "Layers" in the gallery; two About cards that
// both default to id="about") must never share a DOM id -- an aria-describedby/aria-labelledby/
// aria-controls reference then resolves to WHICHEVER same-named node happens to come first in the
// document, not necessarily THIS instance's own (the exact bug: the enabled Flower button's
// aria-describedby resolved to the inactive rail's "Scores only" tooltip). A monotonic
// module-scoped counter guarantees uniqueness regardless of how many instances share a label --
// the same pattern Flower.svelte and Treemap.svelte already use for their own ids, pulled out here
// once so every other component with this need (HexButton, Pill, Modal, Accordion, Popover,
// About, Select) does not re-invent it slightly differently each time.
let nextId = 0;

/** a new id guaranteed unique among every call in this document's lifetime, e.g. "hexbtn-tip-3". */
export function uid(prefix: string): string {
  return `${prefix}-${nextId++}`;
}
