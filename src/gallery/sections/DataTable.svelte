<script lang="ts">
  // atlas-3 step 2b: a small table (sort/filter easy to see) and a 10,000-row table (the
  // virtualization case -- only a bounded DOM window is ever rendered regardless of totalRows,
  // e2e/gallery.spec.ts asserts this directly against #dt-big).
  import DataTable from "../../lib/ui/DataTable.svelte";
  import type { DataTableColumn } from "../../lib/ui/dataTableCore";

  interface SpeciesRow {
    id: number;
    cat: string;
    scientific: string;
    common: string;
    erScore: number | null;
    avgSuit: number;
  }

  const small: SpeciesRow[] = [
    {
      id: 1,
      cat: "mammal",
      scientific: "Balaenoptera musculus",
      common: "Blue whale",
      erScore: 0.92,
      avgSuit: 0.41,
    },
    {
      id: 2,
      cat: "bird",
      scientific: "Phoebastria albatrus",
      common: "Short-tailed albatross",
      erScore: 0.88,
      avgSuit: 0.12,
    },
    {
      id: 3,
      cat: "fish",
      scientific: "Thunnus thynnus",
      common: "Atlantic bluefin tuna",
      erScore: null,
      avgSuit: 0.63,
    },
    {
      id: 4,
      cat: "turtle",
      scientific: "Dermochelys coriacea",
      common: "Leatherback turtle",
      erScore: 0.95,
      avgSuit: 0.29,
    },
    {
      id: 5,
      cat: "invertebrate",
      scientific: "Loligo pealeii",
      common: "Longfin squid",
      erScore: 0.1,
      avgSuit: 0.81,
    },
    {
      id: 6,
      cat: "coral",
      scientific: "Lophelia pertusa",
      common: "Deep-sea coral",
      erScore: 0.5,
      avgSuit: null as unknown as number,
    },
  ];

  const columns: DataTableColumn<SpeciesRow>[] = [
    { key: "cat", label: "Category", value: (r) => r.cat, sortable: true },
    { key: "scientific", label: "Scientific name", value: (r) => r.scientific, sortable: true },
    { key: "common", label: "Common name", value: (r) => r.common, sortable: true },
    {
      key: "erScore",
      label: "ER score",
      value: (r) => r.erScore,
      format: (r) => (r.erScore === null ? "No data" : `${Math.round(r.erScore * 100)}%`),
      sortable: true,
      numeric: true,
    },
    {
      key: "avgSuit",
      label: "Avg. suitability",
      value: (r) => r.avgSuit,
      format: (r) => (r.avgSuit === null ? "No data" : r.avgSuit.toFixed(2)),
      sortable: true,
      numeric: true,
    },
  ];

  function makeBigRows(n: number): SpeciesRow[] {
    const cats = ["bird", "coral", "fish", "invertebrate", "mammal", "other", "primprod", "turtle"];
    return Array.from({ length: n }, (_, i) => ({
      id: i,
      cat: cats[i % cats.length],
      scientific: `Species scientificus ${i}`,
      common: `Species ${i}`,
      erScore: i % 7 === 0 ? null : (i % 100) / 100,
      avgSuit: ((i * 37) % 100) / 100,
    }));
  }

  const big = makeBigRows(10_000);
  let lastExport = $state<string>("");

  function onExport(rows: SpeciesRow[]) {
    lastExport = `${rows.length.toLocaleString("en-US")} row(s) emitted to the export hook (no file written)`;
  }
</script>

<div class="col">
  <h3>Small table (sort a column, filter, arrow-key between cells)</h3>
  <DataTable {columns} rows={small} getRowId={(r) => r.id} height={260} {onExport} />
  <p class="note">{lastExport}</p>

  <h3 id="dt-big-label">10,000 rows (virtualized)</h3>
  <div id="dt-big">
    <DataTable {columns} rows={big} getRowId={(r) => r.id} height={320} />
  </div>
</div>

<style>
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    max-width: 720px;
  }

  h3 {
    font-family: var(--font-display);
    font-size: var(--text-md);
    margin: 0;
  }

  .note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    min-height: 1em;
  }
</style>
