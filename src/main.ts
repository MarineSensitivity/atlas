import { mount } from "svelte";
import VersionBadge from "./lib/ui/VersionBadge.svelte";

// progressive enhancement only: the shell (topbar, tool rail, panel skeleton) is already static
// HTML + inlined CSS and paints before this module even runs (atlas-0 Deliverable 2). This mounts
// the one dynamic bit — the resolved version / preview badge — into its placeholder slot; nothing
// here replaces or re-renders the static shell around it.
const target = document.getElementById("version-badge");
if (target) mount(VersionBadge, { target });
