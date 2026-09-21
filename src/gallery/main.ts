// entry for gallery.html (atlas-3 step 2, Deliverable 3): every src/lib/ui component, every
// state, both themes, phone and desktop widths. This is the review surface and the Playwright
// screenshot baseline (tests/e2e/gallery.spec.ts) -- it is not on index.html's or report.html's
// build graph, so nothing here counts against the static size budget (docs/design/spec.md §12).
import { mount } from "svelte";
import "../lib/brand/tokens.css";
import "../lib/brand/fonts.css";
import "../lib/ui/touch-targets.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (target) mount(App, { target });
