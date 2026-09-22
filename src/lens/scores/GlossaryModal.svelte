<script lang="ts">
  // atlas-4 step 2/3 — the species table's column glossary (parity doc §5.5 modal 3 / app.R:2604-2628),
  // including the er_score rule verbatim.
  import Modal from "../../lib/ui/Modal.svelte";

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  const COLUMNS: Array<{ term: string; def: string }> = [
    {
      term: "cat",
      def: "The species category (bird, coral, fish, invertebrate, mammal, other, primary producer, turtle).",
    },
    {
      term: "taxon",
      def: "The taxon's authority and id (BOTW or WoRMS), linked to that authority's own record.",
    },
    { term: "scientific", def: "The scientific name." },
    { term: "common", def: "The common name, when published." },
    {
      term: "er_code",
      def: "The extinction-risk code (e.g. EN, VU, NT, LC, DD) from its governing list (IUCN, or NMFS/FWS where MMPA/MBTA applies).",
    },
    { term: "er_score", def: "The extinction-risk weight, as a percent of the rule below." },
    {
      term: "model",
      def: "The distribution model id, linked to that species in the Species lens.",
    },
    { term: "is_mmpa", def: "Protected under the Marine Mammal Protection Act." },
    { term: "is_mbta", def: "Protected under the Migratory Bird Treaty Act." },
    { term: "area_km2", def: "The area (km²) of the selection this species' model covers." },
    { term: "avg_suit", def: "The average modeled habitat suitability over the selection." },
    {
      term: "pct_cat",
      def: "This row's share of its category's total suitability x extinction-risk x area.",
    },
  ];

  const ER_RULE: Array<[string, string]> = [
    ["NMFS/FWS: EN", "100"],
    ["NMFS/FWS: TN", "50"],
    ["IUCN: CR", "50"],
    ["IUCN: EN", "25"],
    ["IUCN: VU", "5"],
    ["IUCN: NT", "2"],
    ["IUCN: LC / DD", "1"],
    ["MMPA", "20"],
    ["MBTA", "10"],
  ];
</script>

<Modal {open} title="Species table columns" {onclose}>
  <dl class="glossary">
    {#each COLUMNS as c (c.term)}
      <dt>{c.term}</dt>
      <dd>{c.def}</dd>
    {/each}
  </dl>
  <h3>The extinction-risk rule</h3>
  <table class="er-rule">
    <thead>
      <tr><th scope="col">Category</th><th scope="col">Weight</th></tr>
    </thead>
    <tbody>
      {#each ER_RULE as [label, weight] (label)}
        <tr><td>{label}</td><td class="num">{weight}</td></tr>
      {/each}
    </tbody>
  </table>
</Modal>

<style>
  .glossary {
    margin: 0 0 var(--space-4);
  }

  .glossary dt {
    font-weight: 700;
    margin-top: var(--space-2);
  }

  .glossary dd {
    margin: 0 0 var(--space-1) 0;
    color: var(--text-secondary);
  }

  h3 {
    font-size: var(--text-md);
    margin: var(--space-2) 0;
  }

  .er-rule {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--text-sm);
  }

  .er-rule th,
  .er-rule td {
    padding: var(--space-1) var(--space-2);
    text-align: left;
    border-bottom: 1px solid var(--divider);
  }

  .er-rule .num {
    text-align: right;
  }
</style>
