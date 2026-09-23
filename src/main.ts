// atlas-3 step 3: hydrates the static skeleton (index.html's inlined critical CSS + plain markup,
// which already paints the shell before this module even parses) with the real components. `#shell`
// starts with the STATIC skeleton as its children -- `replaceChildren()` clears them immediately
// before mount() inserts the real, hydrated shell in their place, so there is never a moment with
// both the placeholder and the real DOM present at once. Every geometry-relevant class the skeleton
// used (src/shell/shell.css) is the SAME file src/shell/Shell.svelte imports, so the swap does not
// move or resize anything the CLS gate (e2e/shell.cls.spec.ts) watches.
import { mount } from "svelte";
import Shell from "./shell/Shell.svelte";

const target = document.getElementById("shell");
if (target) {
  target.replaceChildren();
  mount(Shell, { target });
}

// fix list #14 (atlas-3 handover item (b)): the ONE signal index.html's own timed fallback script
// waits for -- set only once mount() has actually returned (never inside a try/catch that would
// swallow a real crash and still set it), so a bundle that 404s, fails to parse, or throws before
// this line runs leaves it absent, which is exactly the condition that script treats as failure.
document.documentElement.setAttribute("data-hydrated", "true");
