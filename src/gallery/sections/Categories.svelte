<script lang="ts">
  // atlas-3 step 2b: categories.ts's table, rendered as swatches -- and the two primary-producer
  // spellings resolving to the SAME (non-grey) token, which is the whole point of this module
  // (parity scores app.md:826-830 / report pipeline spec.md:186-187).
  import { CATEGORIES, categoryFor } from "../../lib/ui/categories";

  const synonymDemo = ["primprod", "primary producer", "primary_producer", "PRIMARY PRODUCER"];
  const unknown = categoryFor("reptile");
</script>

<div class="col">
  <!-- atlas-8 fix: an unconstrained 4-column table (two of them holding unbreakable `<code>`
       tokens like `--cat-primprod`) overflowed the PAGE at 320 CSS px -- SC 1.4.10 (Reflow)
       explicitly exempts data tables from the no-2D-scroll rule, so the fix is a scroll container
       around just the table, not squeezing the table itself: the page never gets a horizontal
       scrollbar, and the table's own content never truncates or wraps mid-token.

       gallery axe ceilings fix: that containment never actually engaged until `.col`'s own
       `min-width: 0` (this round's fix, above) stopped the overflow being silently absorbed by
       `#gallery-main` instead -- so this div was never genuinely internally scrollable before, and
       axe's `scrollable-region-focusable` rule (serious: "Scrollable region must have keyboard
       access") never had anything to flag. Now that it IS the thing that scrolls, a plain
       read-only table gives it no focusable descendant of its own (unlike DataTable.svelte's
       `.scroll-region`, whose sortable/filterable grid always has one) -- `tabindex="0"` makes the
       region itself a keyboard stop (native arrow-key scroll once focused); `role="group"` (never
       `region`) + `aria-label` names that stop without nesting a second landmark inside the
       section's own (`Sheet.svelte`'s `.sheet-body` / `Panel.svelte`'s `.panel-body` fix, same
       idiom). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="cat-table-scroll" role="group" aria-label="Species categories table" tabindex="0">
    <table class="cat-table">
      <caption>The eight species categories (docs/design/spec.md "Data color")</caption>
      <thead>
        <tr>
          <th scope="col">Swatch</th>
          <th scope="col">Key</th>
          <th scope="col">Label</th>
          <th scope="col">Color token</th>
        </tr>
      </thead>
      <tbody>
        {#each CATEGORIES as c (c.key)}
          <tr>
            <td><span class="swatch" style={`background: var(${c.color})`}></span></td>
            <td><code>{c.key}</code></td>
            <td>{c.label}</td>
            <td><code>{c.color}</code></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <p class="label">
    Every spelling of "primary producer" resolves to the SAME non-grey token (the seeded fault: a
    grey fallback):
  </p>
  <div class="row">
    {#each synonymDemo as raw (raw)}
      {@const cat = categoryFor(raw)}
      <span class="chip">
        <span class="swatch swatch--sm" style={`background: var(${cat.color})`}></span>
        "{raw}" &rarr; <code>{cat.color}</code>
      </span>
    {/each}
  </div>

  <p class="label">An unrecognized category falls back to "no data", not a silent real category:</p>
  <div class="row">
    <span class="chip">
      <span class="swatch swatch--sm" style={`background: var(${unknown.color})`}></span>
      "reptile" &rarr; {unknown.label} (<code>{unknown.color}</code>)
    </span>
  </div>
</div>

<style>
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    /* gallery axe ceilings fix (390/320 CSS px): `.col` is itself a flex ITEM of
       `.gallery-stage` (App.svelte), and a flex item's default `min-width: auto` floors its
       shrink at its own min-content size -- which `.cat-table-scroll`'s unbreakable `<code>`
       tokens push well past the viewport. `max-width: 100%` on the scroll wrapper (below) cannot
       break that: percentages are indeterminate during intrinsic-size computation, so the
       wrapper's contribution reverts to the table's full, un-scrolled width. Without this, `.col`
       (and the "primary spelling" paragraph sharing its width) grew past the section's right
       edge; `#gallery-main`'s own `overflow-y: auto` computes `overflow-x: auto` too (the CSS
       Overflow spec's either-axis-non-visible rule), which silently absorbed the overflow by
       making the WHOLE gallery body sideways-scrollable instead of just the table -- the
       intended containment (`.cat-table-scroll` alone scrolls) never engaged, and part of the
       table + the paragraph was clipped, unreachable, with no per-section scrollbar (axe:
       color-contrast "incomplete" x6, elmPartiallyObscured, at 320 CSS px). `min-width: 0`
       overrides the default so `.col` actually shrinks to the section's width, and
       `.cat-table-scroll` becomes the one thing that scrolls, as already documented above. */
    min-width: 0;
  }

  .cat-table-scroll {
    max-width: 100%;
    overflow-x: auto;
  }

  .cat-table {
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .cat-table caption {
    text-align: left;
    margin-bottom: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .cat-table th,
  .cat-table td {
    padding: var(--space-1) var(--space-3) var(--space-1) 0;
    text-align: left;
    border-bottom: 1px solid var(--divider);
  }

  .swatch {
    display: inline-block;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-control);
    border: 1px solid var(--border-control);
  }

  .swatch--sm {
    width: 14px;
    height: 14px;
    vertical-align: -2px;
    margin-right: var(--space-1);
  }

  .label {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    font-size: var(--text-sm);
  }
</style>
