<script lang="ts">
  // atlas-3 step 2b: categories.ts's table, rendered as swatches -- and the two primary-producer
  // spellings resolving to the SAME (non-grey) token, which is the whole point of this module
  // (parity scores app.md:826-830 / report pipeline spec.md:186-187).
  import { CATEGORIES, categoryFor } from "../../lib/ui/categories";

  const synonymDemo = ["primprod", "primary producer", "primary_producer", "PRIMARY PRODUCER"];
  const unknown = categoryFor("reptile");
</script>

<div class="col">
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
