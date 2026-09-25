<script lang="ts">
  // owner review item 7 (live 0.10.62): the species lens' "Table" rail tool's real body -- the
  // selected model's inputs, reshaped from the SAME `LayerBar` the species panel's own layer bar
  // already computes (`data/inputsTable.ts#inputsTableRows`, no new data source, no second fetch).
  // A plain semantic `<table>`, not `src/lib/ui/DataTable.svelte` (that component's virtualization/
  // sort/filter machinery is built for hundreds-to-thousands of rows; a model has a handful of
  // inputs, and a fixed-height virtualized grid would be the wrong tool for it).
  import type { LayerBar } from "./data/layerBar";
  import { inputsTableRows } from "./data/inputsTable";

  interface Props {
    bar: LayerBar | null;
    loading: boolean;
    cardError: boolean;
  }

  let { bar, loading, cardError }: Props = $props();
  const rows = $derived(inputsTableRows(bar));
</script>

<div class="inputs-tool" data-testid="species-inputs-table">
  {#if cardError}
    <p class="empty" role="alert">Couldn't load this species' model inputs.</p>
  {:else if loading}
    <p class="empty">Loading…</p>
  {:else if !bar || rows.length === 0}
    <!-- brief's own rule: "if a model has no inputs, say so plainly" -- never a blank table. -->
    <p class="empty">
      {bar ? "This model has no inputs." : "Select a species to see its model inputs."}
    </p>
  {:else}
    <table class="inputs-table">
      <caption class="visually-hidden">Model inputs for the selected species</caption>
      <thead>
        <tr>
          <th scope="col">Input</th>
          <th scope="col">Dataset</th>
          <th scope="col">Representation</th>
          <th scope="col">Availability</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.key)}
          <tr>
            <td>{r.input}</td>
            <td>{r.dataset}</td>
            <td>{r.representation}</td>
            <td>
              {#if r.available}
                Available
              {:else}
                <span class="unavailable" title={r.reason ?? undefined}>Not available</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .empty {
    color: var(--text-secondary);
  }

  .inputs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .inputs-table th,
  .inputs-table td {
    padding: var(--space-1) var(--space-2);
    text-align: left;
    border-bottom: 1px solid var(--border-control);
  }

  .inputs-table th {
    color: var(--text-secondary);
    font-weight: 600;
  }

  /* the SAME struck-through convention `LayerBarView.svelte`'s own unavailable pill uses (this
     file's own header: the SAME data, reshaped) -- a plain `<span title>`, never a disabled
     `<button>` (nothing here is clickable; this tool only lists what the panel already lets you
     pick). */
  .unavailable {
    color: var(--text-secondary);
    text-decoration: line-through;
  }
</style>
