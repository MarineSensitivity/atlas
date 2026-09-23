// atlas-8 fiddly bit: Panel.svelte used to nest TWO landmarks -- the outer
// `<section aria-labelledby={titleId}>` (named by the panel's own <h2>) directly containing an
// inner `<div role="region" aria-label="...">`. A source scan is the available proxy for "how
// many landmarks does this template establish" without a full a11y-tree render (the same
// technique tests/map/no-fitbounds.test.ts and friends already use for a static-source property).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PANEL_SVELTE = readFileSync(
  new URL("../../src/lib/ui/Panel.svelte", import.meta.url),
  "utf8",
);

/** every explicit `role="..."` in a template, plus implicit landmark elements this component
 * actually uses (`<section>`) -- a rough but sufficient count for "how many landmarks nest here",
 * since Panel.svelte's own children are opaque (`{@render children()}`) and out of scope: this
 * gate is about the wrapper Panel.svelte itself owns, not what a lens puts inside it. */
function landmarkCount(source: string): number {
  const sections = source.match(/<section\b/g)?.length ?? 0;
  const regionRoles = source.match(/role="region"/g)?.length ?? 0;
  return sections + regionRoles;
}

describe("Panel.svelte establishes exactly ONE landmark, not two nested", () => {
  it("the real component", () => {
    expect(landmarkCount(PANEL_SVELTE)).toBe(1);
  });

  it('the panel body is a plain div (no role="region"), still keyboard-reachable', () => {
    expect(PANEL_SVELTE).not.toMatch(/panel-body[\s\S]{0,120}role="region"/);
    // svelte-check's a11y rule needs the ignore comment kept, or a real regression (removing
    // tabindex entirely) would slip through unnoticed by this file.
    expect(PANEL_SVELTE).toMatch(/class="panel-body"[\s\S]{0,150}tabindex="0"/);
  });

  it("the outer <section> is still named by the title (aria-labelledby)", () => {
    expect(PANEL_SVELTE).toMatch(/<section[^>]*aria-labelledby={titleId}/);
  });
});

describe("the gate can fail (seeded fault)", () => {
  it('catches a SECOND nested role="region" reintroduced inside the section', () => {
    const faulted = PANEL_SVELTE.replace(
      /(<div\s+class="panel-body")/,
      '$1\n        role="region"\n        aria-label="details"',
    );
    expect(landmarkCount(faulted)).toBe(2);
  });
});
