// D2/P3 (Opus 5.5 eyes-on assessment, 2026-09-24, plans_todo/atlas-refs/): two broken select
// styles in the first panel every visitor sees, at BOTH desktop and phone widths.
//
// (a) `lib/ui/Select.svelte`'s `.select` box shrank to its label text inside a STRETCHED
//     `.select-wrap` -- Study area/Spatial units/Color palette ended around their text while the
//     chevron (positioned against the now-wide wrapper) floated alone at the field's far right
//     edge, disconnected from the box it is meant to sit inside.
// (b) the Layer picker is a separate native `<select>` (`lens/scores/LayersPanel.svelte`) whose
//     long option text was CLIPPED mid-word ("...category and primar") with no ellipsis.
//
// RED-FIRST: fails on the pre-fix tree -- (a) the chevron's left edge sits to the right of the
// select's own right edge; (b) the native select's computed style carries no ellipsis treatment.
import { expect, test, type Page } from "@playwright/test";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { bootFor, routeZones20 } from "./scores-hermetic";
import { routeBucket, routeSealFixture, routeSession, waitForHydration } from "./hermetic";

test.describe.configure({ mode: "serial" });

// the real-world case (Opus 5.5's screenshot): a long metric label clipped mid-word. v7's own
// fixture layer ("Overall score") is far too short to reproduce it -- this adds one long raw
// layer, the same "extend bootFor('v7') with one more layer" pattern e2e/layers.spec.ts's own
// M6 describe block already uses, rather than changing the shared fixture for every other spec.
const LONG_LABEL =
  "A deliberately long metric label proving the layer select never clips text without an " +
  "ellipsis: species category and primary producer composite score";

function bootWithLongLabel() {
  const boot = bootFor("v7") as { layers: unknown[] };
  return {
    ...boot,
    layers: [...boot.layers, { metric_key: "long", label: LONG_LABEL, category: "raw", order: 2 }],
  };
}

async function gotoLayers(page: Page, search = "&lyr=long") {
  await blockWasm(page);
  await routeBucket(page, "v7", bootWithLongLabel());
  await routeSession(page, null);
  await routeSealFixture(page);
  await routeZones20(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(`/?proj=mercator${search}`);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

/** the shared `Select.svelte` control (Study area / Spatial units / Color palette): the select
 * box's own right edge must be at or past the chevron's left edge -- i.e. the chevron sits
 * INSIDE the box, never floating past its end. */
async function assertSelectSpansChevron(page: Page, label: string) {
  const select = page.getByLabel(label, { exact: true });
  const wrap = page.locator(".select-wrap", { has: select });
  const chevron = wrap.locator(".select-chevron");
  const selectBox = await select.boundingBox();
  const chevronBox = await chevron.boundingBox();
  expect(selectBox, `${label}: select has no box`).not.toBeNull();
  expect(chevronBox, `${label}: chevron has no box`).not.toBeNull();
  expect(
    selectBox!.x + selectBox!.width,
    `${label}: select's right edge (${selectBox!.x + selectBox!.width}) is left of the ` +
      `chevron's own left edge (${chevronBox!.x}) -- the chevron floated outside the box`,
  ).toBeGreaterThanOrEqual(chevronBox!.x);
}

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test.describe(`D2/P3 at ${name}`, () => {
    test.use({ viewport });

    // P round deliverable 1: "Spatial units" dropped out of this loop -- it is no longer a
    // `Select.svelte` box (promoted to the panel's own top-of-panel `Segmented` toggle, D2/P3's own
    // fix does not apply to it any more). `e2e/layers.spec.ts`'s own P-round describe block covers
    // its replacement.
    //
    // R3 (Ben's Layers-pane redesign, 2026-09-25): "Study area" renamed "Zoom to region" (still the
    // SAME `Select.svelte`); "Color palette" is no longer a `Select.svelte` box at all -- it is now
    // the ramp-picker's own Popover trigger button (a gradient strip + name, R3-B2's sibling
    // deliverable), which has no chevron to span in the first place. The Layer picker joins this
    // loop instead: R3-B2 made it a real `Select.svelte` too (it used to be a bespoke native
    // `<select>` with no `.select-wrap`/chevron at all, covered separately below).
    test("Zoom to region / Layer: the box spans to the chevron, never past it", async ({
      page,
    }) => {
      await gotoLayers(page);
      for (const label of ["Zoom to region", "Layer"]) {
        await assertSelectSpansChevron(page, label);
      }
    });

    // D2 fix round 2 (CI: three-engine run 35971206753, [webkit] red): a native <select>'s own
    // CLOSED-box value text is UA-internal rendering CSS cannot reliably style on every engine --
    // measured directly on a real WebKit build (both locally and reproducing CI's linux runner):
    // the computed `overflow`/`text-overflow` values THEMSELVES differ between two WebKit builds
    // (`hidden`/`ellipsis` locally, `visible` on CI's runner), and even where the computed style
    // claims "ellipsis" is in effect, the control visually hard-clips mid-word with NO "…" glyph
    // either way -- confirmed by screenshot, not assumed. So `text-overflow` genuinely never
    // reaches a <select>'s internal text layout on WebKit, on any build: asserting a specific
    // computed value there would be asserting an accident of that build, not a real property.
    // Chromium (and Firefox, unaffected by this CI run) DO honor it, visually and in the
    // computed style, so the strict rule still holds -- and still gets the strict test -- there.
    // The portable half of the rule -- the full text is never SILENTLY lost, only visually
    // clipped where the platform allows nothing else -- is `title` (R3-B2: now `Select.svelte`'s
    // own default `title={selectedLabel}`, moved here from the old bespoke select's
    // `currentLayerLabel` when the Layer picker became this shared component), which every engine
    // supports via its native tooltip regardless of whether the visual ellipsis does; this is
    // exactly what the original eyes-on assessment's own "what right looks like" named alongside
    // the ellipsis ("...plus the full name as `title`").
    test("the Layer select never clips its rendered value without an ellipsis", async ({
      page,
      browserName,
    }) => {
      await gotoLayers(page);
      const layerSelect = page.getByLabel("Layer", { exact: true });
      await expect(layerSelect).toHaveValue("long");
      // every engine: the full, un-clipped label is discoverable via the native tooltip, so the
      // ellipsis (wherever the platform draws one) never means the text is gone, only hidden.
      await expect(layerSelect).toHaveAttribute("title", LONG_LABEL);

      if (browserName === "webkit") return; // no CSS-observable signal to assert here -- see above

      const style = await layerSelect.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          textOverflow: cs.textOverflow,
          overflow: cs.overflowX,
          whiteSpace: cs.whiteSpace,
        };
      });
      expect(style.textOverflow, "no text-overflow: ellipsis on the layer select").toBe("ellipsis");
      // Chromium computes a native <select>'s own `overflow: hidden` as "clip" (a UA-forced
      // behaviour on this form control, not something author CSS can select between) -- either
      // is non-"visible", which is all `text-overflow` requires to take effect.
      expect(
        ["hidden", "clip"],
        `the layer select can still overflow visibly (overflow-x: ${style.overflow})`,
      ).toContain(style.overflow);
      expect(style.whiteSpace, "the layer select's text can still wrap/clip mid-line").toBe(
        "nowrap",
      );
    });
  });
}
