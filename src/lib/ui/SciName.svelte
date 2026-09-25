<script lang="ts">
  // UI-13 (Opus 5.5 eyes-on review, round 3): a scientific binomial printed italic in some places
  // (the species card, the species popup, the report tables) and upright in others (the Scores
  // Species table, the species search results, the legend card/chip titles, the report's summary
  // lines) -- "Dermochelys coriacea" reading as plain text beside genuinely italic instances on
  // the SAME screen. One component, so every caller renders the SAME way -- never a second,
  // independently-styled `.sci` class (`SpeciesTitle.svelte`'s own `.sci` rule is the pattern this
  // mirrors, kept there unchanged since that file is round-3's copy-slice's own territory; this is
  // the shared `src/lib/ui/` version for every OTHER caller to adopt).
  interface Props {
    /** the scientific name text itself, e.g. "Dermochelys coriacea" — never pre-wrapped in markup. */
    name: string;
  }

  let { name }: Props = $props();
</script>

<i class="sci">{name}</i>

<style>
  .sci {
    font-style: italic;
  }
</style>
