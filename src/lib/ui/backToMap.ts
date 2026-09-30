// R4-C: "← Map" on a full-stage surface. R4-B made a click on the ACTIVE spine entry collapse the
// panel (Shell.svelte's `onRailSelect`), so going back to the map is that same click -- pressed
// through the rail's own `data-control` anchor rather than a second collapse path or a Shell prop.
export function collapseToMap(root: ParentNode = document): boolean {
  const active = root.querySelector<HTMLButtonElement>(
    '[data-control^="rail-"][aria-current="true"]',
  );
  if (!active) return false;
  active.click();
  return true;
}
