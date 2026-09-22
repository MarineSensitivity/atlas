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
  // from the petals"). The table is always in the DOM (visually hidden via `.sr-only` when the
  // chart is showing), so `aria-describedby` always resolves to real content regardless of the
  // toggle -- geometry/rules live in flowerGeometry.ts (computeFlowerGeometry), unit-tested there.
  import { categoryFor } from "./categories";
  import { announce } from "./announcer";
  import {
    computeFlowerGeometrySafe,
    describeFlowerSummary,
    type FlowerComponentInput,
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
    /** CSS px; the SVG viewBox is fixed at 0 0 200 200, so this only scales the drawing.
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

  let showTable = $state(false);

  // built from the SAME geometry the SVG draws (describeFlowerSummary), never re-derived from the
  // raw `components` prop here -- the seeded fault this closes: the summary's "N components" used
  // to count every input including ones with no score, disagreeing with how many petals the ring
  // actually drew.
  const summaryText = $derived(describeFlowerSummary(title, geometry));
</script>

<figure class="flower" aria-describedby={summaryId}>
  <figcaption class="flower-title">{title}</figcaption>

  <button
    type="button"
    class="toggle"
    aria-pressed={showTable}
    onclick={() => (showTable = !showTable)}
  >
    {showTable ? "Show chart" : "Show table"}
  </button>

  <div class="flower-body">
    <svg
      class="flower-svg"
      class:sr-only={showTable}
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role="group"
      aria-label={`Composite mean ${roundedCenter !== null ? roundedCenter : "no data"}`}
      aria-hidden={showTable ? "true" : undefined}
    >
      <!-- role="group" (never "img") on the SVG above: an "img" role makes its whole subtree
           presentational, which is exactly what swallowed each petal's own name (axe
           aria-prohibited-attr: aria-label on a role-less <path> is prohibited in the first
           place, but even fixing that alone would still leave every petal unreachable as long as
           the ancestor kept role="img"). Each petal below gets its OWN role="img" (a single
           static shape with one name, not a widget) so its aria-label is valid AND individually
           exposed in the accessibility tree. -->
      {#each geometry.petals as p (p.key)}
        <!-- a <path> has no native interactive role, so svelte-check's a11y rule does not
             recognize tabindex+role="img"+aria-label as the correct pattern here -- there is no
             more accurate native element or role to reach for. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <path
          d={p.path}
          class="petal"
          style={`fill: var(${p.category.color})`}
          tabindex={showTable ? -1 : 0}
          role="img"
          aria-label={`${p.category.label}: ${p.score}`}
        >
          <title>{`${p.category.label}: ${p.score}`}</title>
        </path>
      {/each}
      <circle cx="100" cy="100" r="24" class="hub" />
      <text x="100" y="100" text-anchor="middle" dy="0.35em" class="hub-text">
        {roundedCenter !== null ? roundedCenter : "—"}
      </text>
    </svg>

    <table class="flower-table" class:sr-only={!showTable} id={tableId}>
      <caption>Component scores for {title}</caption>
      <thead>
        <tr>
          <th scope="col">Component</th>
          <th scope="col">Score</th>
        </tr>
      </thead>
      <tbody>
        {#each safe.keptComponents as c (c.key)}
          <tr>
            <td>{categoryFor(c.key).label}</td>
            <td class="num">{c.score === null ? "No data" : c.score}</td>
          </tr>
        {/each}
        <tr class="mean-row">
          <th scope="row">Mean</th>
          <td class="num">{roundedCenter !== null ? roundedCenter : "No data"}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <p class="summary" id={summaryId}>{summaryText}</p>
</figure>

<style>
  .flower {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    max-width: 320px;
  }

  .flower-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    letter-spacing: var(--tracking-display);
  }

  .toggle {
    align-self: flex-start;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .toggle:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .toggle[aria-pressed="true"] {
    background: var(--fill-accent);
    color: var(--text-on-accent);
    border-color: transparent;
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
  }

  .petal:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
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

  .flower-table caption {
    text-align: left;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    margin-bottom: var(--space-2);
  }

  .flower-table th,
  .flower-table td {
    padding: var(--space-1) var(--space-2);
    text-align: left;
    border-bottom: 1px solid var(--divider);
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

  /* visually hidden but still in the accessibility tree -- the toggle only changes what is
     PRESENTED, not what an assistive-tech user can reach (spec.md §11: table equivalent always
     available; the seeded fault this guards is the table drifting from the petals if only one of
     the two were ever rendered). */
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
