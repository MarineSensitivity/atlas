<script lang="ts">
  // atlas-6 step 4, Deliverable 5: composite / flower / components / species table for a custom
  // (drawn/entered) place, by the published zone method (master plan D7/D7b) -- the same SQL twins
  // a Program Area's own page runs, over this place's cell set instead of a zone's. `Flower`/
  // `DataTable` are shared src/lib/ui/ components (not the scores lens's own), so this renders
  // fully within src/places/** without touching src/lens/scores/**.
  import { untrack } from "svelte";
  import Flower from "../lib/ui/Flower.svelte";
  import DataTable from "../lib/ui/DataTable.svelte";
  import { announce } from "../lib/ui/announcer";
  import type { GeomPlace } from "../lib/geo/placeCodec";
  import type { AreaGeometry } from "../lib/geo/types";
  import type { DataEngineContext } from "./dataEngine";
  import type { ComponentScore, SpeciesRow } from "../lib/analysis/queries";
  import {
    cellModelEnabled,
    computeScoreResults,
    computeSpeciesResults,
    speciesTilePlan,
    type ScoreResults,
  } from "./results";
  import { estimateFetchPlan, formatMb, needsConfirmation, type FetchPlan } from "./fetchPlan";

  interface Props {
    place: GeomPlace;
    boot: unknown;
    ver: string | null;
    dataEngine: (() => Promise<DataEngineContext>) | undefined;
  }

  let { place, boot, ver, dataEngine }: Props = $props();

  let scoreResults = $state<ScoreResults | null>(null);
  let scoreError = $state<string | null>(null);
  let loadingScores = $state(false);

  let fetchPlan = $state<FetchPlan | null>(null);
  let awaitingConfirm = $state(false);
  let speciesRows = $state<SpeciesRow[] | null>(null);
  let speciesProgress = $state<{ done: number; total: number } | null>(null);
  let speciesError = $state<string | null>(null);
  let loadingSpecies = $state(false);

  const speciesAvailable = $derived(cellModelEnabled(boot));

  // usability B1: these results belong to ONE place. On 0.10.21 the effect below read `place` only
  // AFTER an `await`, so it never tracked it: selecting (or uploading) another place kept the
  // previous place's composite under the new name. `placeKey` is the geometry itself -- `places` is
  // re-derived from `#pl=` whenever `sel` changes (a pan writes `map=`), which hands this panel a NEW
  // object for the SAME place that must not re-run anything, and a rename changes nothing a result
  // depends on -- and `run` stamps every analysis, so a place
  // switched or removed mid-analysis drops its late result instead of landing it on the row that
  // replaced it.
  const placeKey = $derived(JSON.stringify(place.geometry));
  let run = 0;

  async function loadScores(geometry: AreaGeometry, token: number) {
    if (!dataEngine) {
      scoreError = "No release is resolved yet.";
      return;
    }
    loadingScores = true;
    scoreError = null;
    try {
      const ctx = await dataEngine();
      const result = await computeScoreResults(ctx, boot, geometry);
      if (token === run) scoreResults = result;
    } catch (err) {
      if (token === run)
        scoreError = err instanceof Error ? err.message : "Couldn't compute scores for this place.";
    } finally {
      if (token === run) loadingScores = false;
    }
  }

  async function preparePlan() {
    if (!dataEngine || !ver) return;
    const token = run;
    const geometry = place.geometry;
    const ctx = await dataEngine();
    const { urls } = speciesTilePlan(ctx, ver, geometry);
    if (token !== run) return;
    if (!urls.length) {
      speciesRows = [];
      return;
    }
    const plan = await estimateFetchPlan(urls);
    if (token !== run) return;
    fetchPlan = plan;
    if (needsConfirmation(plan)) {
      awaitingConfirm = true;
    } else {
      await runSpecies();
    }
  }

  async function runSpecies() {
    if (!dataEngine) return;
    const token = run;
    const geometry = place.geometry;
    awaitingConfirm = false;
    loadingSpecies = true;
    speciesError = null;
    try {
      const ctx = await dataEngine();
      const result = await computeSpeciesResults(ctx, geometry, (done, total) => {
        if (token === run) speciesProgress = { done, total };
      });
      if (token !== run) return;
      speciesRows = result.rows;
      announce(`Species table loaded, ${result.rows.length} rows.`);
    } catch (err) {
      if (token === run)
        speciesError =
          err instanceof Error ? err.message : "Couldn't compute species for this place.";
    } finally {
      if (token === run) loadingSpecies = false;
    }
  }

  $effect(() => {
    void placeKey; // a different geometry is the one thing (besides the release) that re-runs this
    const geometry = untrack(() => place.geometry);
    const token = ++run;
    scoreResults = null;
    scoreError = null;
    speciesRows = null;
    fetchPlan = null;
    awaitingConfirm = false;
    speciesProgress = null;
    loadingSpecies = false;
    speciesError = null;
    void loadScores(geometry, token);
  });

  const flowerComponents = $derived(
    (scoreResults?.components ?? []).map((c) => ({ key: c.component, score: c.score })),
  );

  const componentColumns = [
    { key: "component", label: "Component", value: (r: ComponentScore) => r.component },
    {
      key: "score",
      label: "Score",
      value: (r: ComponentScore) => r.score,
      format: (r: ComponentScore) => r.score.toFixed(1),
      numeric: true,
      sortable: true,
    },
    {
      key: "coverage",
      label: "Coverage",
      value: (r: ComponentScore) => r.coverage,
      format: (r: ComponentScore) => `${(r.coverage * 100).toFixed(1)}%`,
      numeric: true,
      sortable: true,
    },
    {
      key: "mean_where_present",
      label: "Mean where present",
      value: (r: ComponentScore) => r.mean_where_present,
      format: (r: ComponentScore) => r.mean_where_present.toFixed(1),
      numeric: true,
      sortable: true,
    },
  ];

  const speciesColumns = [
    {
      key: "sp_common",
      label: "Common name",
      value: (r: SpeciesRow) => r.sp_common ?? r.sp_scientific,
    },
    { key: "sp_scientific", label: "Scientific name", value: (r: SpeciesRow) => r.sp_scientific },
    { key: "sp_cat", label: "Category", value: (r: SpeciesRow) => r.sp_cat },
    {
      key: "avg_suit",
      label: "Avg. suitability",
      value: (r: SpeciesRow) => r.avg_suit,
      format: (r: SpeciesRow) => r.avg_suit.toFixed(1),
      numeric: true,
      sortable: true,
    },
    {
      key: "area_km2",
      label: "Area km²",
      value: (r: SpeciesRow) => r.area_km2,
      format: (r: SpeciesRow) => r.area_km2.toLocaleString("en-US", { maximumFractionDigits: 0 }),
      numeric: true,
      sortable: true,
    },
  ];
</script>

<section class="results" aria-label="Results for {place.name}">
  {#if loadingScores}
    <p class="status">Computing scores…</p>
  {:else if scoreError}
    <p class="status status--error">{scoreError}</p>
  {:else if scoreResults}
    <p class="coverage-note">
      {scoreResults.coverage.coveragePct.toFixed(1)}% of this place is inside the US study area ({scoreResults.coverage.nCellsStudyArea.toLocaleString(
        "en-US",
      )} of
      {scoreResults.coverage.nCellsTotal.toLocaleString("en-US")} cells).
    </p>
    {#if scoreResults.coverage.nCellsStudyArea === 0}
      <p class="status status--error">
        This place is outside US waters here: no scores can be computed.
      </p>
    {:else}
      <div class="composite-row">
        <Flower title={place.name} components={flowerComponents} size={160} />
        <p class="composite-figure">
          <strong>{scoreResults.composite.toFixed(1)}</strong> composite
        </p>
      </div>
      <DataTable
        label="Components"
        columns={componentColumns}
        rows={scoreResults.components}
        getRowId={(r) => r.metric_key}
        height={200}
      />
    {/if}
  {/if}

  {#if speciesAvailable}
    <div class="species-section">
      <h3>Species</h3>
      {#if speciesRows}
        <DataTable
          label="Species table"
          columns={speciesColumns}
          rows={speciesRows}
          getRowId={(r) => r.mdl_key}
          height={260}
        />
      {:else if loadingSpecies}
        <p class="status">
          Loading species{speciesProgress
            ? ` — batch ${speciesProgress.done} of ${speciesProgress.total}`
            : "…"}
        </p>
      {:else if awaitingConfirm && fetchPlan}
        <div class="fetch-plan" role="group" aria-label="Species fetch plan">
          <p>
            Loading species needs {fetchPlan.tileCount} tile{fetchPlan.tileCount === 1 ? "" : "s"},
            {fetchPlan.measured ? "" : "about "}{formatMb(fetchPlan.bytes)}. Continue?
          </p>
          <button type="button" onclick={runSpecies}>Load species</button>
        </div>
      {:else if speciesError}
        <p class="status status--error">{speciesError}</p>
      {:else}
        <button type="button" onclick={preparePlan} disabled={!dataEngine}>Load species</button>
      {/if}
    </div>
  {:else}
    <p class="status">Species aren't available for this release.</p>
  {/if}
</section>

<style>
  .results {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border-top: 1px solid var(--divider);
    padding-top: var(--space-3);
  }

  .status {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  .status--error {
    color: var(--text-danger);
  }

  .coverage-note {
    font-size: var(--text-sm);
    margin: 0;
  }

  .composite-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .composite-figure {
    font-size: var(--text-lg);
    margin: 0;
  }

  .species-section h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-md);
  }

  .fetch-plan {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .fetch-plan button,
  .species-section > button {
    align-self: flex-start;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-accent);
    color: var(--text-on-accent);
    cursor: pointer;
  }
</style>
