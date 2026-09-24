<script lang="ts" module>
  let nextId = 0;
  // wrapped in a function (rather than a bare `nextId++` in the instance script below) so the
  // increment's result is provably "used" within the function that performs it -- a bare top-level
  // increment in the instance script trips eslint's no-useless-assignment, since that rule does not
  // credit a later component instantiation as a future read of the module-scoped counter.
  function nextUid(): string {
    return `flower-${nextId++}`;
  }
</script>

<script lang="ts">
  // atlas-3 step 2b, spec.md §11: "every chart has a table equivalent and a text summary". The SVG
  // and the <table> below both render straight off the SAME `geometry`/`components` data, so they
  // cannot drift (the seeded fault: "the table equivalent of the flower showing different numbers
  // from the petals"). geometry/rules live in flowerGeometry.ts (computeFlowerGeometry),
  // unit-tested there.
  //
  // atlas-4 fix round 3 (owner, phone/dark/Scores/Flower, cell 3092526, 2026-09-24): three defects
  // in the SAME panel. (1) the figure was not centred in `.flower-panel` -- `.flower`'s own default
  // flex `align-items: stretch` fills up to `max-width` and then sits flush at the cross-axis
  // START the moment the panel is wider than that cap, rather than centering the capped box in the
  // leftover space (`margin: 0 auto` below fixes the figure itself; `.flower-body`'s own
  // `align-items: center` fixes the <svg> -- a default-`display: inline` replaced element that
  // never centered itself inside its own full-width wrapper). (2) tabbing to/tapping a petal drew
  // a SOLID RECTANGLE -- `outline` on an SVG `<path>` always paints the element's BOUNDING BOX, not
  // its actual annular-sector shape, no matter what color it is set to; replaced with a purpose-
  // drawn `stroke` highlight, which (unlike `outline`) follows the path's own geometry. (3) the
  // table (added atlas-4 fix round 2, "component | score") was toggle-hidden behind a "Show table"
  // button, so by default only the always-visible `.summary` PROSE sentence carried the numbers --
  // the toggle is gone; chart and table are both always shown, and `.summary` becomes the SCREEN-
  // READER-ONLY text alternative the table's own `<caption>`/`<th>` headers no longer need
  // duplicated visibly (a `<table>` with real headers already satisfies "every chart has a table
  // equivalent" on its own -- the sentence stays only for SC 1.1.1's separate "text summary").
  import { categoryFor } from "./categories";
  import { announce } from "./announcer";
  import { formatScore } from "../format";
  import {
    computeFlowerGeometrySafe,
    describeFlowerSummary,
    flowerViewBox,
    petalCentroid,
    petalLabelText,
    type FlowerComponentInput,
    type FlowerPetal,
  } from "./flowerGeometry";

  interface Props {
    /** flower_panel_title equivalent: "Cell 123", a zone name, or "Full study area (default)" */
    title: string;
    components: FlowerComponentInput[];
    /** labels the CALLER already dropped before handing `components` to this component (the
     * real-world case: `flower.ts`'s `dedupeFlowerComponents`, atlas-4 fix round 2's v8/v9
     * "primprod"/"primary producer" collision) -- announced the same way as a drop this
     * component detects itself, so the one real data quirk is not silently invisible to an
     * assistive-tech user just because the de-dup happened upstream. */
    droppedLabels?: string[];
    /** CSS px; the SVG viewBox is fixed (flowerViewBox()), so this only scales the drawing.
     * spec.md §10: the phone flower shrinks to 150. */
    size?: number;
  }

  let { title, components, droppedLabels = [], size = 220 }: Props = $props();

  const uid = nextUid();
  const summaryId = `${uid}-summary`;
  const tableId = `${uid}-table`;

  // `computeFlowerGeometrySafe` never throws: a same-category collision in `components` (a caller
  // that did not already de-duplicate its own data -- a belt-and-braces fallback; the real v8/v9
  // "primprod"/"primary producer" case is de-duplicated upstream by `flower.ts` and arrives here
  // via `droppedLabels` instead) degrades to "drop the duplicate, draw the rest" rather than
  // blanking the whole flower -- see flowerGeometry.ts.
  const safe = $derived(computeFlowerGeometrySafe(components));
  const geometry = $derived(safe.geometry);
  const roundedCenter = $derived(
    geometry.centerValue !== null ? Math.round(geometry.centerValue) : null,
  );

  // announce every duplicate-component drop -- the caller's (`droppedLabels`) and any this
  // component caught itself (`safe.droppedKeys`) -- exactly ONCE per distinct set (not on every
  // re-render while the same selection stays active); keyed by the joined, order-preserving list
  // so a genuinely different drop (a different selection) still announces again.
  let announcedDropKey = "";
  $effect(() => {
    const dropped = [...droppedLabels, ...safe.droppedKeys];
    if (dropped.length === 0) return;
    const dropKey = dropped.join("\u0000");
    if (dropKey === announcedDropKey) return;
    announcedDropKey = dropKey;
    announce(`duplicate component skipped: ${dropped.join(", ")}`);
  });

  // built from the SAME geometry the SVG draws (describeFlowerSummary), never re-derived from the
  // raw `components` prop here -- the seeded fault this closes: the summary's "N components" used
  // to count every input including ones with no score, disagreeing with how many petals the ring
  // actually drew.
  const summaryText = $derived(describeFlowerSummary(title, geometry));

  // --- the tap/hover/focus petal label (owner: "values of petal show on click (and for desktop on
  // hover)") ------------------------------------------------------------------------------------
  // `activeKey`: the petal a tap/click or keyboard focus selected -- persists until dismissed
  // (tapping the SAME petal again, or focus/click moving elsewhere); this is also the ONLY thing
  // the purpose-drawn selection stroke (`.petal.active` below) reacts to -- fix round 3's own bug
  // was specifically "the last-TAPPED petal", so the indicator stays scoped to a real
  // tap/click/keyboard selection, never to a mouse merely resting over a petal. `hoveredKey`: a
  // desktop-only, transient LABEL highlight (no stroke) that never needs a dismiss gesture (it
  // clears on its own when the pointer leaves). `activeKey` always wins over a stale hover for the
  // LABEL so a keyboard user's selection is never silently replaced by wherever the mouse happens
  // to be resting.
  let activeKey = $state<string | null>(null);
  let hoveredKey = $state<string | null>(null);
  // was THIS element already focused at the moment the current click's pointer went down --
  // captured in `onmousedown` (which always fires before `focus`/`click`) because `focus` does not
  // re-fire for an element that is already focused: without this, a second tap on an
  // already-active petal is indistinguishable from the first tap that just focused it (both see
  // `activeKey === p.key` by the time `onclick` runs).
  let wasFocusedBeforeClick = false;

  // "(hover: hover) and (pointer: fine)" -- the brief's own gate: a touch device (no true hover)
  // must never get a phantom label stuck on screen from the last thing a finger happened to pass
  // over.
  let supportsHover = $state(false);
  $effect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    supportsHover = mq.matches;
    const onChange = () => (supportsHover = mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  });

  const shownKey = $derived(activeKey ?? hoveredKey);
  const shownPetal = $derived<FlowerPetal | null>(
    geometry.petals.find((p) => p.key === shownKey) ?? null,
  );

  function selectPetal(p: FlowerPetal, e: MouseEvent) {
    if (wasFocusedBeforeClick && activeKey === p.key) {
      // second tap/click on the already-active petal: dismiss (also drop focus so no stray
      // highlight lingers on an element the user just closed).
      activeKey = null;
      (e.currentTarget as SVGElement).blur();
    } else {
      activeKey = p.key;
    }
  }
</script>

<figure class="flower" aria-describedby={summaryId}>
  <figcaption class="flower-title">{title}</figcaption>

  <div class="flower-body">
    <div class="flower-chart">
      <svg
        class="flower-svg"
        viewBox={flowerViewBox()}
        width={size}
        height={size}
        role="group"
        aria-label={`Composite mean ${roundedCenter !== null ? roundedCenter : "no data"}`}
      >
        <!-- role="group" (never "img") on the SVG above: an "img" role makes its whole subtree
             presentational, which is exactly what swallowed each petal's own name (axe
             aria-prohibited-attr: aria-label on a role-less <path> is prohibited in the first
             place, but even fixing that alone would still leave every petal unreachable as long as
             the ancestor kept role="img"). Each petal below gets its OWN role="img" (a single
             static shape with one accessible name) so its aria-label is valid AND individually
             exposed in the accessibility tree; the tap/hover/focus behavior added in fix round 3
             only ever reveals the SAME name+score this aria-label already carries, so role="img"
             (rather than a widget role) still describes what assistive tech is told. -->
        {#each geometry.petals as p (p.key)}
          <!-- data-cx/data-cy below: this petal's own on-screen (viewBox) centroid (petalCentroid --
               flowerGeometry.ts), so e2e/scores.flower.spec.ts can probe the exact pixel a petal's
               colored annular band covers via `SVGGraphicsElement.getScreenCTM()` rather than
               parsing `d` or trusting a computed-style read that cannot tell "defined" from
               "covered by the hub" apart (the gap the reported defect slipped through). -->
          {@const c = petalCentroid(p, 100, 100)}
          <!-- a <path> has no native interactive role, so svelte-check's a11y rule does not
               recognize tabindex+role="img"+aria-label (nor the click/hover handlers fix round 3
               adds to reveal the SAME info visually) as the correct pattern here -- there is no
               more accurate native element or role to reach for. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <path
            d={p.path}
            class="petal"
            class:active={p.key === activeKey}
            style={`fill: var(${p.category.color})`}
            tabindex="0"
            role="img"
            aria-label={petalLabelText(p)}
            data-cx={c.x}
            data-cy={c.y}
            onmousedown={(e) => {
              wasFocusedBeforeClick = document.activeElement === e.currentTarget;
            }}
            onclick={(e) => selectPetal(p, e)}
            onfocus={() => (activeKey = p.key)}
            onblur={() => {
              if (activeKey === p.key) activeKey = null;
            }}
            onmouseenter={() => {
              if (supportsHover) hoveredKey = p.key;
            }}
            onmouseleave={() => {
              if (hoveredKey === p.key) hoveredKey = null;
            }}
          >
            <title>{petalLabelText(p)}</title>
          </path>
        {/each}
        <circle cx="100" cy="100" r={geometry.innerRadius} class="hub" />
        <text x="100" y="100" text-anchor="middle" dy="0.35em" class="hub-text">
          {roundedCenter !== null ? roundedCenter : "—"}
        </text>
      </svg>

      {#if shownPetal}
        <!-- purely visual (the SAME text already reaches assistive tech via the petal's own
             aria-label on focus -- see the role="img" comment above) -- never double-announced. -->
        <div class="petal-label" aria-hidden="true">{petalLabelText(shownPetal)}</div>
      {/if}
    </div>

    <table class="flower-table" id={tableId}>
      <caption class="sr-only">Component scores for {title}</caption>
      <thead>
        <tr>
          <th scope="col"><span class="sr-only">Color</span></th>
          <th scope="col">Component</th>
          <th scope="col">Score</th>
        </tr>
      </thead>
      <tbody>
        {#each safe.keptComponents as c (c.key)}
          <tr>
            <td class="swatch-cell">
              <span class="swatch" style={`background: var(${categoryFor(c.key).color})`}></span>
            </td>
            <td>{categoryFor(c.key).label}</td>
            <td class="num">{c.score === null ? "No data" : formatScore(c.score)}</td>
          </tr>
        {/each}
        <tr class="mean-row">
          <td class="swatch-cell"></td>
          <th scope="row">Mean</th>
          <td class="num">{roundedCenter !== null ? roundedCenter : "No data"}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- SC 1.1.1's "text summary" alongside the chart's own table equivalent -- the table above
       (real <table>, real <th> headers) already IS an accessible equivalent, so this sentence is
       screen-reader-only rather than a second, visible copy of the same numbers (the duplicate
       "Cell ID: … (x:, y:)" header the owner reported: the figcaption above already states it
       once). -->
  <p class="summary sr-only" id={summaryId}>{summaryText}</p>
</figure>

<style>
  .flower {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    /* owner (phone, 390px): "Flower plot should be centered" -- `width: 100%` gives `margin: 0
       auto` a DEFINITE box to centre (never a shrink-to-fit one, which could grow as wide as the
       unwrapped summary sentence and overflow a narrow panel) rather than the default flex
       `align-items: stretch`, which fills up to `max-width` and then sits flush at the cross-axis
       start once the panel is wider than that cap. */
    width: 100%;
    margin: 0 auto;
    max-width: 320px;
  }

  .flower-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-display);
  }

  .flower-body {
    display: flex;
    flex-direction: column;
    /* the other half of the centering fix: a bare <svg> is a `display: inline` replaced element
       by default, so without this it sits flush at the inline-start (left) edge of this
       full-width wrapper -- exactly the "empty space on the right" the owner saw. */
    align-items: center;
    gap: var(--space-2);
  }

  .flower-chart {
    position: relative;
    /* shrink-wraps the <svg>'s own rendered box so `.petal-label`'s 50%/50% below lines up with
       the hub regardless of the `size` prop. */
    display: inline-flex;
  }

  .flower-svg {
    max-width: 100%;
    height: auto;
  }

  /* full opacity: scripts/contrast.mjs measures each --cat-* token AS COMMITTED in tokens.css --
     compositing it at 0.85 here over --surface-panel-basis after the fact would have shipped a
     color the gate never actually checked. Ship the measured color. */
  .petal {
    stroke: var(--surface-panel);
    stroke-width: 1;
    cursor: pointer;
    /* NEVER the UA/default outline: `outline` on an SVG `<path>` always paints the element's
       BOUNDING BOX, not its actual annular-sector shape -- the "solid blue rectangle" the owner
       saw around the last-tapped petal. Unconditional (not just on :focus-visible) so no browser
       state can reintroduce it. The purpose-drawn indicator below (a thicker STROKE, which DOES
       follow the path's own geometry) replaces it. */
    outline: none;
  }

  .petal.active,
  .petal:focus-visible {
    stroke: var(--focus-ring);
    stroke-width: 3;
  }

  .petal-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    max-width: 90%;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    border: 1px solid var(--border-control);
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
    pointer-events: none;
  }

  .hub {
    fill: var(--surface-raised);
    stroke: var(--border-control);
    stroke-width: 1;
  }

  .hub-text {
    fill: var(--text-primary);
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 700;
  }

  .flower-table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .flower-table th,
  .flower-table td {
    padding: var(--space-1) var(--space-2);
    text-align: left;
    border-bottom: 1px solid var(--divider);
  }

  .flower-table .swatch-cell {
    width: 1em;
    padding-right: 0;
  }

  .swatch {
    display: inline-block;
    width: 0.75em;
    height: 0.75em;
    border-radius: 2px;
  }

  .flower-table .num {
    text-align: right;
  }

  .flower-table .mean-row {
    font-weight: 700;
  }

  .summary {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  /* visually hidden but still in the accessibility tree. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
