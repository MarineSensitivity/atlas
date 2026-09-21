<script lang="ts">
  import About from "../../lib/ui/About.svelte";
</script>

<div class="row">
  <figure>
    <About
      id="about-demo-on"
      releaseNote="Marine Sensitivity Atlas · release v7 · scores and species from the published marine-atlas release. Basemap © OpenStreetMap contributors."
      sealFlag="1"
      agency="MMA"
      defaultExpanded
    />
    <figcaption>
      VITE_SEAL=1, VITE_AGENCY=MMA, expanded (the seal source 404s in review; see the step's report
      for where it should point once published)
    </figcaption>
  </figure>
  <figure>
    <About
      id="about-demo-off"
      releaseNote="Marine Sensitivity Atlas · release v7."
      sealFlag={undefined}
      agency="MMA"
      defaultExpanded
    />
    <figcaption>
      VITE_SEAL unset -- no seal, text only (the seeded fault: this must NEVER show a seal)
    </figcaption>
  </figure>
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-5);
    padding: var(--space-4);
  }

  figure {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    max-width: 372px;
  }

  figcaption {
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }
</style>
