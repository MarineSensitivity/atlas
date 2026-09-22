<script lang="ts">
  // atlas-4 step 3 — the welcome modal (parity doc §5.5 modal 2): shown on first paint unless
  // suppressed via localStorage ("Don't show this again") or `?tour=off`; "Take a Tour" is wired
  // to the announcer, not a real guided tour — driver.js was NOT added this step (see the atlas-4
  // report's "could not satisfy": a new dependency + its own lazy-chunk wiring was judged too much
  // risk for the remaining budget). `tour=off` also hides the tour invitation, since starting one
  // makes no sense when the URL itself says not to.
  import { onMount } from "svelte";
  import Modal from "../../lib/ui/Modal.svelte";
  import { announce } from "../../lib/ui/announcer";
  import type { Tour } from "../../lib/state/types";

  const STORAGE_KEY = "atlas.welcome.dontShowAgain";

  interface Props {
    tour: Tour;
  }

  let { tour }: Props = $props();

  let open = $state(false);
  let dontShowAgain = $state(false);

  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  onMount(() => {
    const suppressed = storage()?.getItem(STORAGE_KEY) === "1";
    open = !suppressed;
  });

  function close() {
    open = false;
    if (dontShowAgain) {
      try {
        storage()?.setItem(STORAGE_KEY, "1");
      } catch {
        /* private mode / storage disabled — chrome, not correctness */
      }
    }
  }

  function onTakeTour() {
    announce("Guided tour arrives in a later phase.");
  }
</script>

<Modal {open} title="Welcome to the Marine Sensitivity Atlas" onclose={close}>
  <p>
    Explore composite marine-sensitivity scores for U.S. federal waters, drawn from the published
    marine-atlas release — by Program Area, or by clicking any 0.05° cell.
  </p>
  <p>
    See also the <a href="?lens=species" target="_blank" rel="noopener">Species lens</a> and the project
    documentation.
  </p>
  <label class="dont-show">
    <input type="checkbox" bind:checked={dontShowAgain} />
    Don't show this again
  </label>
  <div class="actions">
    {#if tour !== "off"}
      <button type="button" class="tour-btn" onclick={onTakeTour}>Take a Tour</button>
    {/if}
    <button type="button" class="explore-btn" onclick={close}>Explore</button>
  </div>
</Modal>

<style>
  .dont-show {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0;
    font-size: var(--text-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .tour-btn,
  .explore-btn {
    height: var(--size-touch);
    padding: 0 var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  .explore-btn {
    background: var(--fill-accent);
    color: var(--text-on-accent);
    border-color: transparent;
  }

  .tour-btn:focus-visible,
  .explore-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
