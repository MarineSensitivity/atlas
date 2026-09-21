<script lang="ts">
  // atlas-3 spec.md §9 / plan D10: the ONE on-map seal placement -- a collapsible, OPAQUE card
  // (never glass, so the seal sits on a plain background as the guide requires), collapsed to its
  // header by default. The 897 KB MMA logo.svg is never copied into this repo; it loads lazily
  // from a configurable URL (see DEFAULT_SEAL_URL below and this step's report for the open
  // question of where that URL should actually point once the asset is published somewhere).
  import { agencyDisplayName, SEAL_MIN_PX, shouldShowSeal } from "./sealVisibility";
  import Icon from "./Icon.svelte";

  // Not yet a real, published URL: MarineSensitivity.github.io/branding/ is gitignored in that
  // repo today, so this 404s until the asset is published (either un-gitignore + publish it there,
  // or upload it beside the release data in the S3 bucket src/lib/release/dataBase.ts already
  // points at). VITE_SEAL_URL overrides this once a real location exists.
  const DEFAULT_SEAL_URL = "https://marinesensitivity.org/branding/mma-seal.svg";

  interface Props {
    /** unique among About instances on one page (drives element ids) */
    id?: string;
    /** the release/basemap attribution line, shown whether or not the seal renders */
    releaseNote: string;
    sealFlag?: string;
    agency?: string;
    sealUrl?: string;
    defaultExpanded?: boolean;
  }

  let {
    id = "about",
    releaseNote,
    sealFlag = import.meta.env.VITE_SEAL,
    agency = import.meta.env.VITE_AGENCY,
    sealUrl = import.meta.env.VITE_SEAL_URL || DEFAULT_SEAL_URL,
    defaultExpanded = false,
  }: Props = $props();

  // `defaultExpanded` is deliberately read only ONCE, as an "uncontrolled" initial value.
  // svelte-ignore state_referenced_locally
  let expanded = $state(defaultExpanded);
  let sealFailed = $state(false);
  const showSeal = $derived(shouldShowSeal(sealFlag, agency) && !sealFailed);
  const agencyName = $derived(agencyDisplayName(agency));
  const titleId = $derived(`${id}-title`);
  const bodyId = $derived(`${id}-body`);
</script>

<section class="about" aria-labelledby={titleId}>
  <div class="about-head">
    <Icon name="info" size={18} />
    <h2 id={titleId}>About this release</h2>
    <button
      type="button"
      class="tool"
      aria-expanded={expanded}
      aria-controls={bodyId}
      aria-label={expanded ? "Collapse the About card" : "Expand the About card"}
      onclick={() => (expanded = !expanded)}
    >
      <Icon name="chevronDown" size={16} class={expanded ? "about-chevron--open" : ""} />
    </button>
  </div>
  {#if expanded}
    <div class="about-body" id={bodyId}>
      {#if showSeal}
        <img
          class="seal"
          src={sealUrl}
          alt="Seal of the {agencyName}"
          width={SEAL_MIN_PX}
          height={SEAL_MIN_PX}
          loading="lazy"
          onerror={() => (sealFailed = true)}
        />
      {/if}
      <p>
        {#if agencyName}<strong>{agencyName}</strong>{/if}
        {releaseNote}
      </p>
    </div>
  {/if}
</section>

<style>
  .about {
    width: 372px;
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    box-shadow: var(--elev-2);
  }

  .about-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .about-head h2 {
    flex: 1;
    font-size: var(--text-sm);
    margin: 0;
  }

  .tool {
    display: inline-grid;
    place-items: center;
    width: var(--size-touch);
    height: var(--size-touch);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .tool:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  .tool:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .tool :global(.about-chevron--open) {
    transform: rotate(180deg);
  }

  .about-body {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  /* the seal at >= 72 px, unmodified, on a plain plate whose padding IS the clear space (a
     quarter of the seal's own height, guide p. 4) */
  .seal {
    flex: none;
    display: block;
    box-sizing: content-box;
    width: var(--size-seal-min);
    height: var(--size-seal-min);
    padding: 18px;
    background: var(--surface-seal-plate);
    border-radius: var(--radius-card);
  }

  .about-body p {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .about-body strong {
    display: block;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }
</style>
